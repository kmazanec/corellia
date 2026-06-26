---
type: issue
title: "Deploy the factory end-to-end: package, ship to a registry, and run it in isolation anywhere"
description: F-66 gave the daemon an image + local compose, but there is no complete deployment path — no .dockerignore, no run scripts, no CI→registry build, no published-image deploy to a remote host, and no story for the operational lifecycle (state persistence, secrets provisioning, restart/upgrade/rollback, observability) needed to actually run the factory in the cloud.
tags: [harness, daemon, deploy, docker, ci, ghcr, ops, lifecycle, dx]
timestamp: 2026-06-26
status: open
kind: future-work
severity: medium
---

# Deploy the factory end-to-end: package, ship to a registry, and run it in isolation anywhere

## Problem
The factory must be **deployable as a running service** — in isolation, locally
for development and on a remote host in the cloud, anywhere Docker is available.
That is more than "the image builds": it is the whole path from a commit to a
running, restartable, upgradeable daemon with its state persisted and its
secrets provisioned.

F-66 already delivered the *image* and a *local* run story (see Evidence), but
the deployment path is incomplete across two layers:

### Layer 1 — packaging & delivery (the artifact gets to the host)
1. **No `.dockerignore`.** The Dockerfile copies specific paths today, so the
   context isn't catastrophic, but it's unscoped — `.git/`, `node_modules/`,
   `out/`, `media/` (there is a `media/video.zip`), `docs/`, and `.env` all ship
   to the daemon. It's slow and a footgun the moment a `COPY . .` lands.
2. **No simple build/start/stop scripts.** Operating the container means
   remembering the exact invocations and the `-f` shadowing rule (`compose.yaml`
   prod daemon vs. `docker-compose.yml` dev Postgres; Compose v2 prefers
   `compose.yaml`). Nothing in `package.json` or a `scripts/` shim wraps build /
   up / down / logs.
3. **No CI build → registry push.** There is no `.github/workflows/` at all; the
   image is only ever built locally (`compose.yaml` has `build:`, not `image:`).
   CI should build on push/tag and push a tagged image to **GHCR**
   (`ghcr.io/<owner>/corellia`) so any host pulls a known-good artifact instead
   of rebuilding.
4. **No published-image deploy path.** Nothing takes the published image to a
   remote Docker host. Target is Keith's pre-existing **Hetzner VPS**, but the
   path should stay host-agnostic: a published-image compose overlay (`image:`
   instead of `build:`) + a one-command deploy (pull + `compose up -d` over SSH,
   or a `docker context`), so the factory runs anywhere Docker is.

### Layer 2 — the operational lifecycle (it keeps running in the cloud)
A deployed factory is a long-lived, stateful, secret-bearing service. Running it
in isolation on a remote host raises concerns the local story never had to:
5. **State persistence & backup.** The factory's durable memory is the event log
   — either the Postgres `corellia-pgdata` volume *or* a JSONL file at
   `CORELLIA_EVENTS_PATH` (`buildStore()` in `src/daemon/config.ts`) — plus the
   git worktrees the engine creates inside the mounted target repo. A remote
   deploy must pin where that state lives on the host, survive container
   replacement, and have a backup/restore answer. This is the factory's memory;
   losing it on a redeploy is data loss.
6. **Secrets provisioning on the host.** F-66 established the discipline (every
   secret via `env_file`, never baked into the image — ADR-012). Deployment must
   answer *how the host-side `.env` gets there and stays current* without
   committing secrets or transmitting them in the image: `FRONT_DOOR_TOKEN`,
   `OPENROUTER_API_KEY`, `GITHUB_TOKEN`, `DATABASE_URL`, the standing-envelope
   vars.
7. **Restart / upgrade / rollback.** The daemon preserves in-flight worktrees on
   SIGTERM (ADR-026, `onSigterm()` in `daemon.ts`) and `restart: unless-stopped`
   handles crashes — but a *deploy* is a deliberate image swap. The path needs a
   graceful-drain → pull-new-tag → recreate sequence that respects preservation,
   plus the ability to roll back to a previous tag (an argument for pinned,
   versioned GHCR tags rather than only `latest`).
8. **Target-repo mount on a remote host.** Locally the operator mounts
   `TARGET_REPO_PATH` into `/workspace`. On a remote host there is no local
   checkout to mount; the deploy story must say how the target repo arrives on
   the host (clone-on-host volume, named volume, or per-commission checkout) and
   how `GITHUB_TOKEN` authorizes it.
9. **Observability & health in production.** `GET /status` (bearer-gated) backs
   the compose healthcheck; production needs the operator path to *see* the
   running factory — at minimum tailing the daemon's logs and the event log on
   the host. (Pluggable external tracing is its own issue —
   [observability-pluggable-tracing](observability-pluggable-tracing.md) — but
   the basic "is it alive, what is it doing" path is part of deploying.)

## Evidence
F-66 (the container-build iteration) already shipped these files in the repo
root:
- `Dockerfile` — multi-stage (`builder` typechecks, `runtime` runs via `tsx`),
  non-root `corellia` user, `git` installed for worktree ops, `EXPOSE 8080`,
  `ENTRYPOINT [... tsx, src/daemon/daemon.ts]`. Documents the v1 constraint that
  target repos run *inside* this image (Node/TS targets only in v1).
- `compose.yaml` — prod `daemon` + `postgres`, `restart: unless-stopped`,
  healthchecks (daemon hits `GET /status` with the bearer token), secrets via
  `env_file: .env`, `${HOST_PORT}`/`${TARGET_REPO_PATH}` overrides, named
  `corellia-pgdata` volume.
- `docker-compose.yml` — dev-only Postgres helper on host port `54329`.
- `.env.example` — a thorough operator guide for the container deployment block.

Lifecycle facts that shape Layer 2:
- State substrate: `buildStore()` (`src/daemon/config.ts`) → `PgEventStore` when
  `DATABASE_URL` is set, else `JsonlEventStore` at `CORELLIA_EVENTS_PATH`
  (default `out/events.jsonl`).
- Graceful shutdown: `onSigterm()` (`src/daemon/daemon.ts:193`) preserves every
  in-flight worktree before exit (ADR-026 preserve-don't-await).

Gaps confirmed by inspection: `ls .dockerignore .github/workflows/` → absent;
`package.json` `scripts` has no docker/build/start/stop targets; `compose.yaml`
uses `build:` (no `image:`/registry reference); no documented host-side
state/backup or deploy procedure.

This is **distinct from** [`deployment-to-live-url`](deployment-to-live-url.md):
that issue is about the factory gaining a `deploy` *goal family* to ship the
**apps it builds** to a live URL. This issue is about deploying and operating
**the factory itself** — its own daemon, image, registry, host, and lifecycle.

## Proposed direction
Rough, not a committed plan — and likely more than one iteration (packaging
first, then the operational lifecycle):
- **Packaging:** add a root `.dockerignore`; add simple operator scripts
  (`package.json` targets `docker:build|up|down|logs` and/or a `scripts/`
  wrapper) that encode the correct `-f` selection.
- **Delivery:** a GitHub Actions workflow that builds the `runtime` target on
  push/tag and pushes to **GHCR** with `latest` + `sha-<short>` + semver-on-tag,
  using the repo `GITHUB_TOKEN` and layer caching.
- **Deploy:** a published-image compose overlay (`image: ghcr.io/...`, switchable
  via `${CORELLIA_IMAGE}`) + a host-agnostic one-command deploy (SSH
  `docker context` or a thin `scripts/deploy.sh`) that pulls the pinned tag and
  recreates the stack, draining SIGTERM-style.
- **Lifecycle:** document (and where useful script) host-side state placement +
  backup/restore for the Postgres volume / JSONL log + worktrees; a secrets
  provisioning procedure for the host `.env`; rollback to a prior GHCR tag; how
  the target repo lands on a remote host; and the basic "tail logs / hit
  `/status`" operability path.

## Acceptance hint
- `.dockerignore` exists; the build context excludes `.git`/`node_modules`/
  `media`/`.env`.
- One documented command builds the image; one documented command brings the
  factory (daemon + Postgres) up locally and tears it down — without the operator
  needing the `-f` shadowing rule.
- A CI run on push/tag builds and pushes a tagged image to
  `ghcr.io/<owner>/corellia` (visible in the registry).
- From a clean remote Docker host (e.g. the Hetzner VPS) with only a populated
  `.env`, one documented command pulls the published image and brings the daemon
  up; `GET /status` returns 200 — no source checkout or local image build on that
  host.
- The factory's state (event log / Postgres volume + worktrees) survives a
  container replacement / redeploy on that host, with a documented backup/restore,
  and a redeploy can roll back to a previous image tag.
