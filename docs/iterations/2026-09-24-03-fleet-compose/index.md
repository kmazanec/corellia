---
type: iteration
title: "Iteration 27 — The fleet in containers: control plane image, fleet compose profile, fleet deploys"
description: Packages ADR-051's shape for hosts. A control plane image (console/Dockerfile), a `fleet` compose profile (control plane plus worker replicas) in both compose files, CI publishing the console image, and scripts/deploy.sh --fleet. Proving it in Docker surfaced two real bugs, both fixed — a parked job's worker affinity outlived the worker (a redeploy stranded it), and the containerized daemon never pointed at the mounted target repo.
tags: [iteration, deploy, compose, docker, operator-console, worker, ci, adr-045, adr-051]
timestamp: 2026-09-24
status: landed; live proof pending
---

# Iteration 27 — The fleet in containers

## Source

[fleet-compose-deploy](../../issues/fleet-compose-deploy.md), filed when
[iteration 26](../2026-09-23-04-job-queue-and-workers/index.md) built the job
queue and workers without Docker. This session had Docker, so the fleet was
built and run for real, on simulated engines.

## What landed

- **`console/Dockerfile`** — build from the repo root; typechecks the server
  (`console/server/tsconfig.build.json`, src only) and builds the SPA, then a
  runtime of the server's production dependencies only (`tsx` is now a server
  dependency) plus `console/web/dist`: 392 MB.
- **`fleet` compose profile** in `compose.yaml` (builds `corellia:local`,
  `corellia-console:local`) and `compose.deploy.yaml` (published images):
  `control-plane` (healthcheck on `/api/health`, `CONSOLE_HOST_PORT`) and
  `worker` (factory image, entrypoint `src/daemon/worker.ts`,
  `CORELLIA_WORKERS` replicas, `CORELLIA_REPO_ROOT=/workspace`, 30 s stop
  grace). The daemon stays the default; non-fleet deploys are unchanged.
- **CI** — `build-push` is a matrix over both images, with per-image cache.
- **`scripts/deploy.sh --fleet`** (or `DEPLOY_PROFILE=fleet`) — pins the console
  image to the same tag, pulls and recreates the fleet services, and verifies
  the control plane's `/api/health` as well as the daemon's `/status`.
- **Docs** — deploy.md §9, container.md "The fleet locally", `.env.example`,
  README.

## Bugs found by running it

- **Stranded parks on redeploy.** A worker's id is `<container hostname>-<pid>`,
  which changes when compose recreates the container, and a parked job's
  affinity pinned it to the old id forever. Affinity now binds only while its
  worker is registered and seen within the lease; the contract suite gained the
  case (memory and Postgres), and the scenario was re-run in Docker: parked on
  one worker, workers force-recreated, answered, resumed and finished on a new
  worker.
- **The containerized daemon ignored its mounted repo.** Neither compose file
  set `CORELLIA_REPO_ROOT`, so the daemon used `/app` (not a git repo) instead
  of `/workspace`; with an API key the live engine refuses a non-git root and
  the daemon falls back to the null engine. Both daemon services now set it.
- Smaller: the worker treats empty env values as unset (compose passes
  `${VAR:-}` as ""), and the image's server typecheck no longer reaches the
  root test suite it does not ship.

## Proof (sandbox, Docker 29, Compose 5)

Images were built from sandbox variants that differ only in trusting the
session's TLS-intercepting proxy CA and skipping `apt-get install git`
(deb.debian.org is denied by the session's network policy; git is used only by
the live engine). Docker Hub rate-limited `postgres:18`, so a scratch override
replaced the `postgres` service with a TCP relay to a host Postgres 16. With
that:

- `docker compose --profile fleet up` brought the control plane up healthy and
  two workers registered; the browser drove commission → parallel runs with one
  job queued → park → answer → done.
- `--scale worker=3` added a third; `compose stop worker` reached the workers
  through tsx within half a second, the running job was recorded
  `interrupted`, and all workers deregistered.
- `scripts/deploy.sh --fleet sha-proof` ran through local ssh/scp shims against
  `compose.deploy.yaml` with images tagged as CI publishes them: both health
  checks passed and a commissioned job finished.
- The redeploy-affinity scenario above.

## Remaining

The live proof named in the issue's Resolution: a real host, published images,
the live engine.
