---
type: iteration
title: "Iteration 26 — Job queue and single-job workers: commission and answer from the console (ADR-051 Phase 2)"
description: The Postgres job queue and WorkerLink contract, a queue worker process that runs one whole job at a time through its own Listener, job/worker stamping and NOTIFY on the event log, control-plane commands (commission, answer, cancel) and fleet views, and the console UI to commission jobs, answer parked ones, and watch the fleet.
tags: [iteration, operator-console, control-plane, worker, jobs, queue, postgres, drizzle, adr-051, bootstrap]
timestamp: 2026-09-23
status: landed; live proof pending
---

# Iteration 26 — Job queue and single-job workers

## Source

[operator-console-ui](../../issues/operator-console-ui.md) requirements 1–2
(commission and answer from the UI), which needed
[ADR-051](../../adrs/ADR-051-control-plane-worker-split.md) Phase 2. Built by
hand in a cloud session with no model access; every piece runs against the
simulated engine or in-memory stores, so none of it needed a live run.

Operator scope for this phase (2026-09-23): each worker takes one job and runs
all of it; budget is per job; there is no budget shared across workers.

## What landed

- **Contract** `src/contract/jobs.ts`: `JobRecord`, `WorkerRecord`,
  `WorkerLink` (register, claim, heartbeat, park, finish, sweep) and
  `JobQueue` (enqueue, answer, cancel, list, workers).
- **Queue implementations**, all held to one contract suite
  (`tests/substrate/job-queue-contract.ts`, 9 cases):
  - `MemoryJobQueue` — the reference, both sides.
  - `PgWorkerLink` (factory, raw `pg`) — owns the DDL (`ensureJobSchema`),
    claims under an advisory lock with a scope-overlap check against running
    jobs on the same repo, leases with a claim cap, park affinity, sweeps.
  - `PgJobQueue` (control plane, Drizzle) — commission, answer, cancel.
  - A race test: eight workers claiming at once never both hold overlapping
    scopes.
- **Event log**: `PgEventStore` gains `job_id` / `worker_id` columns stamped
  from `setContext`, and notifies `corellia_events` on every append.
- **Worker** `src/daemon/worker.ts` + `worker-loop.ts`: registers, sweeps,
  claims, runs the job through its own `Listener` (new `resume` and
  `handOffParked`), heartbeats, parks or finishes; on SIGTERM preserves the
  worktree and records the job `interrupted`. `npm run worker`.
- **Engine selection** moved to `src/daemon/engine-selection.ts` and shared by
  the daemon and the worker; `CORELLIA_ENGINE=simulated` selects
  `src/dev/simulated-engine.ts`, which plays `src/dev/sample-run.ts` into the
  log (and parks on request) with no model.
- **Control plane**: the read-model joins queue rows with the log (`JobView`:
  row decides lifecycle, log decides the run); `POST /api/jobs`,
  `/jobs/{id}/answer`, `/jobs/{id}/cancel`; `GET /api/workers`, `/api/repos`;
  streams carry `job` and `fleet` messages; `LISTEN` on both channels
  triggers syncs; uniform `400 {error}` validation bodies.
- **Console UI**: a commission dialog (repo from the fleet, description,
  constraints, scope, ceiling, intent, simulated outcome), an answer form on
  parked jobs, cancel for queued jobs, the "answer sent, resuming on worker"
  and stop-reason notices, a Fleet panel, and queue states in the ledger.

## Proof

- Contract suite on memory and on Postgres (`PgWorkerLink` + Drizzle
  `PgJobQueue`), the claim race, stamping and NOTIFY tests, worker-loop tests
  (done, park → answer → resume, failed, thrown, bounce, interrupted, loop),
  command/fleet API tests.
- `console/server/test/fleet-e2e.test.ts`: on Postgres, commission over HTTP →
  worker parks → answer over HTTP → same worker resumes → done, with every
  event stamped to the job and worker. Postgres suites run in their own
  schemas, so they are safe in parallel.
- Real processes: control plane + two simulated workers on one repo, driven
  in headless Chromium. Three jobs: two ran in parallel, the third queued;
  the parked job released its worker and resumed on it after the answer from
  the UI; the workers deregistered on SIGTERM.

## Stuck point / remaining

- **Live proof pending:** workers on the live engine against a real repo.
- **Deploy:** [fleet-compose-deploy](../../issues/fleet-compose-deploy.md).
- **Improvement loop:** [improvement-loop-on-the-queue](../../issues/improvement-loop-on-the-queue.md).
- **Console:** artifact browser (req. 7), goal-type stats (req. 9).
