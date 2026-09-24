---
type: issue
title: "Deploy the fleet: control plane and N workers as compose services"
description: The control plane and queue workers run from npm scripts, but the published-image deploy (ADR-045) still ships only the single-process daemon; add a control-plane image (server plus built SPA) and a worker service with replicas so a host runs the ADR-051 shape.
tags: [deploy, compose, operator-console, worker, adr-045, adr-051]
timestamp: 2026-09-23
status: fixed-pending-live-proof
kind: future-work
severity: medium
---

# Deploy the fleet: control plane and N workers as compose services

## Problem

ADR-051 splits the factory into a control plane and single-job workers, and
both run locally (`npm run console:server`, `npm run worker`). The deploy path
(ADR-045: GHCR image + `compose.deploy.yaml`) still builds and runs only the
daemon, so a host cannot run the fleet shape without hand-wiring processes.

## Evidence

- `Dockerfile` installs and typechecks the factory only
  (`npm ci --workspaces=false`); there is no image for `console/`.
- `compose.yaml` / `compose.deploy.yaml` define `postgres` and `daemon` only.
- Iteration 26 was built in a session without Docker, so no image was built
  or run.

## Proposed direction

A `console/Dockerfile` that builds the SPA and runs the control plane (serving
`console/web/dist`); a `worker` service on the existing factory image with
command `npx tsx src/daemon/worker.ts` and `deploy.replicas` from an env var;
both on the shared `postgres`. Keep the daemon service as the one-box
default, with the fleet behind a compose profile until it is proved live.

## Acceptance hint

`docker compose --profile fleet up` on a clean host brings up Postgres, the
control plane on its port, and two workers; a job commissioned in the browser
runs on a worker and appears live in the console.

## Resolution

**2026-09-24 — fixed-pending-live-proof** (iteration 27). `console/Dockerfile`
builds the control plane image (server plus built SPA, production dependencies
only); a `fleet` profile in `compose.yaml` and `compose.deploy.yaml` adds
`control-plane` and `worker` (the factory image entered at
`src/daemon/worker.ts`, `CORELLIA_WORKERS` replicas); CI publishes
`ghcr.io/<owner>/corellia-console` beside the factory image; and
`scripts/deploy.sh --fleet` pins, pulls, recreates, and verifies both.
Proved in a sandbox with Docker, on simulated engines: the stack came up from
the repo's compose files, a job commissioned in the browser parked, took an
answer, and finished; workers scaled to three and drained on
`compose stop` (job recorded interrupted); `deploy.sh --fleet` ran through local
ssh/scp shims against `compose.deploy.yaml`; and a job parked before a worker
recreate resumed on a new worker after the answer.

Remaining live proof: a real host deploy from published GHCR images with the
live engine — which also exercises what the sandbox could not: the factory
image's `apt-get install git` (its network policy denies deb.debian.org),
Postgres 18 (Docker Hub rate-limited; a relay to Postgres 16 stood in), and
concurrent worker git worktrees on one shared checkout.
