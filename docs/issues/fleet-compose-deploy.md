---
type: issue
title: "Deploy the fleet: control plane and N workers as compose services"
description: The control plane and queue workers run from npm scripts, but the published-image deploy (ADR-045) still ships only the single-process daemon; add a control-plane image (server plus built SPA) and a worker service with replicas so a host runs the ADR-051 shape.
tags: [deploy, compose, operator-console, worker, adr-045, adr-051]
timestamp: 2026-09-23
status: open
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
