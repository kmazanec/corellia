---
type: reference
title: Container runbook (F-66)
description: Operator runbook for building and running the containerized Corellia front-door daemon image and compose stack.
tags: [reference, container, runbook, daemon, deployment]
timestamp: 2026-06-12T03:41:19-05:00
---

# Container runbook (F-66)

Container-ready packaging for the Corellia front-door daemon. Per ADR-026 this
iteration ships a runnable image + compose stack; **actual cloud deployment is
deliberately deferred**. This runbook covers the operator loop: **build → up →
smoke → down**.

## What's in the box

- **`Dockerfile`** — multi-stage on `node:22-slim`. The builder stage runs
  `npm ci` + `npm run typecheck`; the runtime stage adds `git` (the engine
  creates git worktrees), runs as a **non-root** user (`corellia`, uid 1001),
  and starts the daemon.
- **The image runs `tsx`, not a compiled `dist/`.** The project has no
  `build`/`tsc`-emit script in `package.json` (`typecheck` is `tsc --noEmit`),
  so there is no `dist/` to run. The ENTRYPOINT is
  `node node_modules/.bin/tsx src/daemon/daemon.ts` — the same invocation
  documented in `src/daemon/daemon.ts`. If a future iteration adds a `build`
  step, switch the ENTRYPOINT to `node dist/src/daemon/daemon.js`.
- **`compose.yaml`** — `daemon` + `postgres` services, a named data volume
  (`corellia-pgdata`), and a daemon healthcheck on `GET /status`.

## Prerequisites (manual setup)

1. **Docker** (Desktop or Engine) running locally.
2. **`.env`** at the project root. Copy `.env.example` → `.env` and populate the
   `CONTAINER DEPLOYMENT (F-66)` section:
   - `FRONT_DOOR_TOKEN` — bearer token for every webhook request (required;
     daemon exits 1 if unset). Generate one: `openssl rand -hex 32`.
   - `DATABASE_URL` — **must** point at host `postgres` (the compose service
     name), e.g. `postgres://postgres:<pw>@postgres:5432/postgres`.
   - `POSTGRES_USER` / `POSTGRES_PASSWORD` — the password **must** match the one
     embedded in `DATABASE_URL`.
   - `GITHUB_TOKEN` — for git operations against the target repo.
   - `TARGET_REPO_PATH` — absolute host path to the repo the factory operates
     on (mounted at `/workspace`).
   - `HOST_PORT` (optional) — host port mapped to the container's 8080.
   - `STANDING_BUDGET_JSON` + `STANDING_SPEND_CEILING_USD` (optional) — the
     improvement-loop envelope (ADR-027).

   `.env` is **gitignored** — never commit real secrets. compose injects it via
   `env_file:`; no secret is ever written into `compose.yaml` or baked into the
   image (ADR-012).

## Target-repo toolchain constraint (v1 — read this)

Scripts declared in the **target repo's** `package.json` are executed **inside
this container**. The image ships **Node + npm only**. Therefore in v1 **the
target repo must be a Node/TypeScript project.** A target repo that needs
Python, Ruby, Go, or any other runtime will fail when its declared scripts run,
because that runtime is not present in the image. For other stacks you must
extend the image (or mount a suitably-tooled one) before the smoke run will
pass. This is a documented limitation, not a silent failure.

## Build

```bash
docker compose build
# or build + start in one step: docker compose up --build
```

A CI-safe build lint (not wired into CI) is available:

```bash
docker build --check .
docker build --target builder -t corellia-builder-check .   # runs typecheck
```

## Up

```bash
docker compose up -d
docker compose ps          # both services should be healthy
docker compose logs -f daemon
```

On cold boot the daemon selects the Postgres substrate (because `DATABASE_URL`
is set) and runs `store.ensureSchema()`, which executes the Pg store's
`CREATE TABLE IF NOT EXISTS corellia_events ...` migration
(`src/substrate/pg-event-store.ts`). The `postgres` service's `pg_isready`
healthcheck gates the daemon's `depends_on`, so migration never races an
unready database.

Verify the front door is answering (HTTP 200):

```bash
curl -s -o /dev/null -w '%{http_code}\n' \
  -H "Authorization: Bearer $FRONT_DOOR_TOKEN" \
  http://localhost:${HOST_PORT:-8080}/status
# → 200
```

The daemon's own healthcheck performs this same `GET /status` bearer-token
check and is what `docker compose ps` reports as `healthy`.

## Smoke

With the stack up and `.env` populated with **real** tokens:

```bash
npx tsx scripts/smoke-container.ts
```

The smoke script commissions a trivial `write-prd` goal via `POST /intents`,
polls `GET /status` until the intent leaves the running/queued set, and prints
the report and cost line. It is **operator-run, not CI**. See
`scripts/smoke-container.ts` for the env it reads (`FRONT_DOOR_TOKEN`,
`SMOKE_BASE_URL`, etc.).

> Note: the shipped daemon wires a **null engine** (see `daemon.ts`) that
> rejects every run, so commissioned intents do not converge to a real report
> until a live engine is wired (F-67). Against the shipped image the smoke
> script proves the **webhook + admission + status** surface end-to-end; a real
> report requires the live-engine entrypoint.

## Down

```bash
docker compose down            # stop + remove containers, keep the volume
docker compose down -v         # also remove corellia-pgdata (wipes events)
```

## What is and isn't CI-gated

- **CI-gated:** the normal `npm test` chain (`npm run lint && vitest run`) and
  `npm run typecheck` — these test the **source**, not the image. The smoke
  script is TypeScript and is covered by `tsc --noEmit`.
- **NOT CI-gated (operator-verified):** `docker build`, `docker compose up`, and
  `scripts/smoke-container.ts`. The vitest suite is **never run inside the
  container** — the runtime stage installs no devDependencies for test
  execution (it carries `tsx` only as the runner).
