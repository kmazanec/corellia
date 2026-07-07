---
type: reference
title: Deploying and operating the factory in the cloud
description: Ops runbook for running the Corellia daemon on a remote host — GHCR image delivery, one-command SSH deploy, state placement and backup/restore, host secrets provisioning, restart/upgrade/rollback, target-repo landing, and observability.
tags: [reference, deploy, ops, runbook, ghcr, ci, docker, compose, lifecycle, backup, rollback]
timestamp: 2026-07-06T00:00:00-05:00
---

# Deploying and operating the factory in the cloud

This runbook covers running the Corellia daemon as a long-lived service on a
**remote host** — the whole path from a merged commit to a running, restartable,
upgradeable, rollback-able daemon with its state persisted and its secrets
provisioned. See ADR-045 for the design and its alternatives.

For the **local** build → up → smoke → down loop, see
[`container.md`](container.md) — this document assumes it and does not repeat it.

## The path at a glance

```
commit ─► CI (build-image.yml) ─► GHCR image ─► scripts/deploy.sh ─► remote host
          npm test + buildx        ghcr.io/         SSH: pull tag,      daemon + postgres
          push to GHCR             <owner>/corellia  recreate, verify    from compose.deploy.yaml
```

Delivery produces a **known-good artifact** (a pinned GHCR image tag). The remote
host never builds from source — it pulls that artifact and runs it.

## 1. Delivery — CI builds and pushes to GHCR

`.github/workflows/build-image.yml` runs on every push/PR:

- **`test` job** — `npm ci && npm test` (lint + typecheck + vitest). This is the
  repo's CI; it gates the image build.
- **`build-push` job** — builds the Dockerfile `runtime` target with buildx and
  GitHub Actions layer caching, then pushes to
  `ghcr.io/<owner>/corellia`. Tags:
  - `latest` — main only.
  - `sha-<short>` — every push (the **pinnable, immutable** ref to deploy).
  - semver (`1.2.3`, `1.2`) — on `v*` tags.

  Pushes happen only off `main` and version tags; pull-request builds validate
  but never publish. Auth is the workflow's own `GITHUB_TOKEN` with
  `packages: write` — no PAT to manage.

Confirm an image landed:

```bash
# On any machine logged in to GHCR:
docker pull ghcr.io/<owner>/corellia:sha-<short>
```

**Deploy pinned `sha-<short>` or a semver tag, not `latest`** — a pinned tag is
what makes rollback (§5) meaningful.

## 2. First-time host setup

A target host needs only Docker (Engine + compose v2) and an SSH login. It needs
**no source checkout and never builds an image.**

1. **Create the deploy dir** (default `/opt/corellia`; override with `DEPLOY_DIR`):

   ```bash
   ssh user@host 'sudo mkdir -p /opt/corellia && sudo chown "$USER" /opt/corellia'
   ```

2. **Provision the host `.env`** — see §4. Secrets live only on the host.

3. **Land the target repo** — see §6.

The compose file (`compose.deploy.yaml`) is copied by the deploy script; you do
not place it by hand.

## 3. Deploy / upgrade — one command

From a checkout of this repo (the script only needs `compose.deploy.yaml` and
your SSH access):

```bash
DEPLOY_HOST=user@host scripts/deploy.sh sha-<short>
```

`scripts/deploy.sh`:

1. Copies `compose.deploy.yaml` to `DEPLOY_DIR` on the host (idempotent).
2. Confirms the host `.env` exists (refuses to run without it — secrets never
   travel from your machine).
3. Pulls the pinned image ref `ghcr.io/<owner>/corellia:<tag>` on the host.
4. Recreates the stack with `docker compose up -d`. Compose sends **SIGTERM** to
   the old daemon, which **preserves every in-flight worktree before exiting**
   (ADR-026 preserve-don't-await) — a deploy never abandons in-flight work.
5. Verifies `GET /status` returns **200**, using the bearer token read from the
   host-side `.env` (never printed or transmitted from your machine). Retries for
   ~60 s to let the fresh container and Postgres come up.

The GHCR owner is parsed from `git remote get-url origin`; override with
`CORELLIA_OWNER`. The host must be logged in to GHCR if the image is private
(`docker login ghcr.io`).

## 4. Secrets provisioning on the host (ADR-012)

**No secret is ever baked into the image or committed.** The daemon and Postgres
read everything from a host-side `.env` via compose `env_file:`. Provision it
out-of-band:

```bash
# Build the host .env from the template, fill in real values locally, then ship
# it over SSH into the deploy dir (never into the repo, never into the image).
cp .env.example /tmp/corellia.env
$EDITOR /tmp/corellia.env          # fill FRONT_DOOR_TOKEN, OPENROUTER_API_KEY,
                                   # GITHUB_TOKEN, DATABASE_URL, POSTGRES_*, etc.
scp /tmp/corellia.env user@host:/opt/corellia/.env
ssh user@host 'chmod 600 /opt/corellia/.env'
rm /tmp/corellia.env               # don't leave a plaintext copy lying around
```

Required for a real remote run (see `.env.example` for the full annotated set):

- `FRONT_DOOR_TOKEN` — bearer token for every webhook request (daemon exits 1 if
  unset). Generate: `openssl rand -hex 32`.
- `OPENROUTER_API_KEY` — enables the live engine; without it the daemon runs but
  rejects commissions (null engine).
- `DATABASE_URL` — **must** point at host `postgres` (the compose service name),
  e.g. `postgres://postgres:<pw>@postgres:5432/postgres`.
- `POSTGRES_USER` / `POSTGRES_PASSWORD` — the password **must** match `DATABASE_URL`.
- `GITHUB_TOKEN` — git auth for the target repo (clone/push/PR).
- `TARGET_REPO_PATH` — host path to the mounted target repo (§6).
- `HOST_PORT` (optional), `STANDING_BUDGET_JSON` + `STANDING_SPEND_CEILING_USD`
  (optional, ADR-027).

To **rotate** a secret: edit the host `.env`, then re-run `scripts/deploy.sh`
(or `docker compose -f compose.deploy.yaml up -d` on the host) to recreate the
containers with the new value.

## 5. State placement, backup & restore

The factory's durable memory is the **event log**, plus the git **worktrees** the
engine creates in the target repo. Both must survive container replacement.

### Event log

Two substrates, selected by `buildStore()` (`src/daemon/config.ts`):

- **Postgres (recommended for a deployed factory)** — set `DATABASE_URL`. State
  lives in the named Docker volume **`corellia-pgdata`**, which persists across
  `docker compose down` (but is wiped by `down -v`). This is the default in
  `compose.deploy.yaml`.
- **JSONL** — no `DATABASE_URL`; the log is a file at `CORELLIA_EVENTS_PATH`
  (default `out/events.jsonl` inside the container). For persistence you must
  mount a host path to that location. Postgres is preferred remotely because the
  volume story is cleaner and the store is concurrency-safe.

Losing this is data loss — it is the factory's memory.

**Backup (Postgres volume):**

```bash
ssh user@host 'cd /opt/corellia && docker compose -f compose.deploy.yaml exec -T postgres \
  pg_dump -U "$POSTGRES_USER" postgres' > corellia-$(date +%Y%m%d-%H%M%S).sql
```

**Restore:**

```bash
cat corellia-<stamp>.sql | ssh user@host 'cd /opt/corellia && \
  docker compose -f compose.deploy.yaml exec -T postgres psql -U "$POSTGRES_USER" postgres'
```

Schema is idempotent (`CREATE TABLE IF NOT EXISTS`) so a restore onto a fresh
volume just works; the daemon re-projects all read-models from the log on boot.

**Backup (JSONL):** copy the mounted file, e.g.
`scp user@host:/opt/corellia/out/events.jsonl ./`.

### Worktrees

The engine creates worktrees under `.corellia/worktrees/` **inside the mounted
target repo** (`TARGET_REPO_PATH` → `/workspace`). Because the target repo is a
host bind-mount (§6), those worktrees live on the host and survive container
replacement automatically. Preserved-on-SIGTERM trees (ADR-026) are left on disk
there for inspection after a deploy.

## 6. How the target repo lands on a remote host

Locally you mount a checkout. On a remote host there is none, so **clone on the
host** into a named path and mount it:

```bash
ssh user@host 'git clone https://$GITHUB_TOKEN@github.com/<owner>/<target-repo>.git \
  /opt/corellia/target-repo'
```

Set `TARGET_REPO_PATH=/opt/corellia/target-repo` in the host `.env`;
`compose.deploy.yaml` mounts it at `/workspace`. `GITHUB_TOKEN` in the `.env`
authorizes the container's own clone/fetch/push against the same remote. The
clone persists on the host across redeploys (it is not in any Docker volume), so
its worktrees and history are durable.

## 7. Restart, upgrade & rollback

- **Crash restart** — `restart: unless-stopped` in compose brings the daemon back
  automatically; it re-projects state from the event log on boot.
- **Upgrade** — `scripts/deploy.sh <new-tag>`: graceful SIGTERM drain → pull →
  recreate → verify (§3).
- **Rollback** — deploy a previous tag with the same drain-and-recreate flow:

  ```bash
  DEPLOY_HOST=user@host scripts/deploy.sh --rollback sha-<previous-short>
  ```

  Because tags are immutable and the event log is append-only and forward-
  compatible, rolling the image back does not roll back state — the older daemon
  reads the same log. (This is why you deploy pinned tags, not `latest`.)

## 8. Observability & health

- **Is it alive?** — `GET /status` (bearer-gated) is the source of truth and
  backs the compose healthcheck:

  ```bash
  ssh user@host 'cd /opt/corellia && set -a && . ./.env && set +a && \
    curl -s -o /dev/null -w "%{http_code}\n" \
    -H "authorization: Bearer $FRONT_DOOR_TOKEN" \
    "http://127.0.0.1:${HOST_PORT:-8080}/status"'
  # → 200
  ```

  `docker compose -f compose.deploy.yaml ps` reports the same check as `healthy`.

- **What is it doing?** — daemon logs:

  ```bash
  ssh user@host 'cd /opt/corellia && docker compose -f compose.deploy.yaml logs -f daemon'
  ```

- **What did it decide?** — tail the event log (the append-only record of every
  run):

  ```bash
  # Postgres substrate:
  ssh user@host 'cd /opt/corellia && docker compose -f compose.deploy.yaml exec -T postgres \
    psql -U "$POSTGRES_USER" -c "SELECT at, goal_id, type FROM corellia_events ORDER BY id DESC LIMIT 20"'
  ```

- **Watch a run graphically (dev/self-host)** — the `observe` compose profile
  bundles a Jaeger all-in-one so a run renders as a trace waterfall with zero
  external backend. It is a profile, so default deploys stay two containers.

  ```bash
  CORELLIA_OTLP_ENDPOINT=http://jaeger:4318 docker compose --profile observe up
  # then open the trace UI:  http://localhost:16686
  ```

  The profile lives in `compose.yaml`, **not** in `compose.deploy.yaml`: a
  production host should not run an unauthenticated all-in-one UI. For a durable
  backend on a real host, set `CORELLIA_OTLP_ENDPOINT` (via `.env`) to Honeycomb,
  Grafana Tempo, or an OTel collector — see docs/observability.md.

- **Get pushed the moments that matter** — set `CORELLIA_NOTIFY_WEBHOOK` (via
  `.env`) to a webhook URL and the daemon POSTs a compact JSON payload when a tree
  blocks on a decision brief, parks, resumes, opens a PR, or reaches a terminal
  outcome (done/failed/partial) — so an operator is not polling `GET /status`.
  Optional `CORELLIA_NOTIFY_HEADERS` (a JSON object) carries webhook auth. Payload
  schema and the curated event set are in docs/observability.md.

Pluggable external tracing is tracked separately
([observability-pluggable-tracing](issues/observability-pluggable-tracing.md));
this covers the basic "is it alive, what is it doing" path.
