---
type: adr
title: "ADR-051: one control plane, many single-job workers, joined by a WorkerLink contract over a shared Postgres"
description: Today the daemon is one process holding the job queue, parked intents, and budget reservations in memory, with its HTTP front door inside it — so exactly one factory runs at a time. Split it. A stateless control plane (the console server) owns jobs, answers, the repo registry, and the read-model, and runs no model. Workers are the engine without an HTTP server; each claims one job at a time, runs the whole job, and writes events. Workers reach shared state only through a WorkerLink contract (claim, append, heartbeat, park, finish); v1 implements it directly on Postgres (SKIP LOCKED leases, LISTEN/NOTIFY for liveness) and a later adapter implements it over the control plane's HTTP API. Budget stays per job. Parked jobs resume on the worker that holds their worktree.
tags: [adr, architecture, control-plane, worker, jobs, queue, postgres, operator-console, deploy, parallelism]
timestamp: 2026-09-23T12:30:00-05:00
---

# ADR-051: one control plane, many single-job workers

**Status:** Accepted (phased; Phases 1–2 built, see Rollout and As built) · **Date:** 2026-09-23 · **Stretch:** no · **Contract:** yes (WorkerLink)
**Relates to:** ADR-003 (event log is the source of truth), ADR-004 (Postgres
substrate), ADR-016 (one worktree per tree), ADR-017/033 (per-tree dollar
ceiling, budget is a non-steering safeguard), ADR-026 (hosted front door),
ADR-045 (deploy path), ADR-050 (console stack)

## Context

The factory should run many jobs at once: several worker processes on one
multi-core box, or workers spread over separate cloud instances, all watched
from one console. Today it cannot:

- **The queue is process memory.** The Listener keeps `waitQueue`, `parked`, and
  `reservations` in in-process collections (`src/listener/listener.ts`). A second
  daemon cannot share work, and a restart drops the queue.
- **Events carry no job or worker identity.** `corellia_events` is
  `(id, at, goal_id, type, payload)`.
- **Worktrees are local disk** (ADR-016), so a parked job's state lives on one
  machine.
- **The front door is inside the engine process** (ADR-026), so serving the UI
  and running jobs scale together or not at all.

Operator scope for this decision (2026-09-23): a worker runs **one job at a
time** and runs **all of it**. Pieces of one job are not spread across workers.
Budget is **per job**, not a pool shared across workers.

## Decision

### Roles

- **Control plane.** The console server (ADR-050). It owns the `jobs` table,
  operator answers, the repo registry, and the read-model over the event log,
  and serves the REST + SSE API and optionally the SPA. It runs no model and
  holds no state outside Postgres, so it can run as any number of replicas.
- **Worker.** The factory engine without an HTTP server. One process claims one
  job, runs the whole goal tree in its own worktree, appends events, then claims
  the next. Parallelism means more worker processes (per core on one box, or per
  instance). A worker with a multi-slot mode is a later choice, not v1.
- **Postgres.** The only shared state: the event log (source of truth, ADR-003),
  the `jobs` table, and leases.

### The WorkerLink contract (factory-side, `src/contract/`)

Workers touch shared state only through one interface:

- `claim(workerId)`: take the next claimable job or `null`.
- `events(jobId)`: an `EventStore` that stamps `job_id` / `worker_id` on append.
- `heartbeat(jobId)`: extend the lease.
- `park(jobId, brief)`: record the brief; release the worker, keep affinity.
- `finish(jobId, outcome)`: emitted / blocked / partial.

v1 implements it **directly on Postgres**: claim is
`SELECT … FOR UPDATE SKIP LOCKED` plus a lease row with an expiry; a job whose
lease lapses (worker died) becomes claimable again. A later **HTTP adapter**
implements the same interface against the control plane's API, so remote workers
hold only a worker token instead of database credentials. Swapping adapters
does not touch the engine.

### Liveness

Appending an event issues `NOTIFY corellia_events` with `(id, job_id)`. Control
plane replicas `LISTEN` and push new events to browsers over SSE. The event
table's `bigserial id` is the stream cursor (`Last-Event-ID`), so a dropped
browser resumes without gaps.

### Budget

Each job row carries its own envelope. The worker's engine enforces it exactly
as today (per-tree ceiling, ADR-017/033). There is no cross-worker budget pool.

### Parked jobs

A parked job keeps **affinity** to the worker whose disk holds its worktree. An
answer re-queues it for that worker only. Pushing the branch on park so any
worker can resume is a later option; nothing in v1 prevents it.

## Rollout

- **Phase 1 (read side, no factory write-path change).** The control plane reads
  `corellia_events` through Drizzle and derives each event's job from the goal
  tree (`child-spawned` edges; a job is a root goal). It serves the read API and
  SSE (polling by id cursor where `NOTIFY` is not yet emitted). The existing
  daemon keeps running jobs; anything writing to the shared Postgres appears in
  the console.
- **Phase 2 (jobs + workers).** The `jobs` table and the Postgres WorkerLink. The
  daemon's Listener queue and parked map move into `jobs`; the daemon becomes a
  worker; commissioning and answering go through the control plane. Events are
  stamped with `job_id` / `worker_id` at write, and `NOTIFY` fires on append.
- **Phase 3 (remote workers).** The HTTP WorkerLink adapter, worker tokens, and
  optionally push-on-park resume.

## As built (Phase 2, iteration 26)

Where the build settled points the Decision left open, or departed from it:

- **The factory owns all DDL.** `corellia_jobs` and `corellia_workers` are
  created by `ensureJobSchema` (`src/substrate/pg-worker-link.ts`), like the
  event table. Workers and the control plane both call it at start; the
  control plane mirrors the tables in Drizzle and never writes DDL.
- **Two implementations of each side, one contract.** `src/contract/jobs.ts`
  defines `WorkerLink` (worker side) and `JobQueue` (control-plane side).
  `MemoryJobQueue` implements both as the reference; `PgWorkerLink` (raw `pg`,
  factory, ADR-001) and the control plane's Drizzle `PgJobQueue` implement one
  side each. All are held to one shared contract suite
  (`tests/substrate/job-queue-contract.ts`), and the Postgres pairing also to
  a concurrent-claim race test.
- **Claims are serialised by a transaction-scoped advisory lock**, so the
  scope-overlap check against running jobs and the claim are atomic across
  workers. A lapsed lease makes a job claimable again up to 3 claims, then it
  fails (`lease lost after N claims`).
- **The worker reuses the Listener.** Each worker runs its one job through its
  own `Listener`, which stays the single brief authority for the run
  (ADR-008). Two additions make that work: `Listener.resume(input, question,
  answer)` resumes a park the listener never saw, and `handOffParked(id)`
  gives a park to the queue, so the listener's own TTL sweep never bounces it.
  Workers sweep expired parks from the queue instead.
- **Shutdown records `interrupted`**, rather than letting the lease lapse: the
  worker preserves the worktree (ADR-026 preserve-don't-await) and a re-run on
  another machine would start from nothing, so the operator decides.
- **Event stamping is a store context.** `PgEventStore.setContext` stamps
  `job_id` / `worker_id` while a worker holds a job; every append notifies
  `corellia_events`. Job-row changes notify `corellia_jobs`.
- **The single-process daemon stays** as the one-box mode (webhook front door,
  in-memory queue); the worker is a separate entrypoint (`npm run worker`).
  The console shows daemon runs from the log alone.
- **Not yet on the queue:** the improvement loop (ADR-027). Workers run
  without a standing envelope, so a failed job's blockers are still routed
  (`blocker-routed` events) but no improvement tree is admitted. See issue
  [improvement-loop-on-the-queue](../issues/improvement-loop-on-the-queue.md).

## Tradeoffs

- Postgres doubles as queue and bus. At the expected scale (tens of workers,
  not thousands) SKIP LOCKED and LISTEN/NOTIFY are proven. A dedicated queue can
  replace the adapter later without touching the engine.
- Deriving job membership in Phase 1 costs a fold over the goal tree. Phase 2
  stamps it at write and the derivation stays as the fallback for old logs.
- JSONL mode stays for local single-process runs and the CLIs. The console reads
  Postgres; a JSONL file can be loaded for development and tests only.

## Consequences

- The Listener's in-process admission (dollar reservations across concurrent
  intents) becomes unnecessary for a single-job worker and is retired in Phase 2.
- `FRONT_DOOR_TOKEN` authenticates operators to the control plane; workers get a
  separate credential when the HTTP adapter lands.
- Deploy (ADR-045) gains a `control-plane` service and N `worker` replicas in
  compose; a single-box deploy can still run one of each.
