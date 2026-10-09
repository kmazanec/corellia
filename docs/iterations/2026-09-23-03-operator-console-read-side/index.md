---
type: iteration
title: "Iteration 25 — Operator console, read side: control plane API + live SPA over the event log"
description: First slice of the operator console. Two ADRs set the stack (ADR-050, a console workspace boundary that keeps the factory zero-dep) and the deploy shape (ADR-051, one control plane and many single-job workers over shared Postgres). The goal tree became a shared data projection; a Hono + Drizzle control plane serves jobs, trees, events, and goal detail over REST + resumable SSE; a React SPA in the Plate aesthetic shows the ledger, live tree, trace, and inspector.
tags: [iteration, ui, operator-console, control-plane, read-model, sse, hono, drizzle, react, bootstrap]
timestamp: 2026-09-23
status: landed; live proof pending
---

# Iteration 25 — Operator console, read side

## Source

[operator-console-ui](../../issues/operator-console-ui.md) (high). Built by hand
in a cloud session with no model access. Every piece here reads the event log,
so it can be built and proved without a live run. That is why this slice came
first, as the issue's build order (a)→(d) asks.

## Decisions

- [ADR-050](../../adrs/ADR-050-operator-console-stack.md): the console lives in
  `console/*` npm workspaces. They may import the factory, and the factory never
  imports them, so ADR-001 holds for `src/`. Server: Hono + `@hono/zod-openapi`
  + Drizzle. Web: React + Vite + TanStack Router/Query, Tailwind v4 re-themed
  with the Plate tokens (default palette cleared), `react-aria-components` for
  behaviour only.
- [ADR-051](../../adrs/ADR-051-control-plane-worker-split.md): a stateless
  control plane plus N single-job workers, joined by a WorkerLink contract over
  shared Postgres. Operator scope: one worker runs one whole job at a time, and
  budget is per job. This iteration is its Phase 1.

## What landed

- **`src/eventlog/goal-tree.ts`**: `projectGoalTree`, the goal tree as data. A
  goal's state follows its *latest* lifecycle event. The listener parks at the
  root and re-runs the same goal id after an answer, so fixed-priority state
  rules would show an answered job as failed. `renderTree` is a thin ASCII view
  over it. The CLI, server, and browser share this one projection.
- **`console/server`** (control plane, read side):
  - `EventSource` is a `seq` cursor over the log, with Postgres (Drizzle),
    JSONL, and memory implementations.
  - `JobIndex` groups events into jobs by root goal (derived from
    `goal.parentId`; nothing changes in the factory's write path).
  - `ReadModel` syncs and publishes.
  - API: `GET /api/jobs`, `/jobs/{id}`, `/jobs/{id}/events?after=`,
    `/jobs/{id}/goals/{goalId}`, `/api/openapi.json`, `/api/health`.
  - SSE: `/api/stream` (job summaries) and `/api/jobs/{id}/stream` (replay from
    `Last-Event-ID`, a `caught-up` marker, then live).
  - Bearer auth on `FRONT_DOOR_TOKEN`.
- **`console/web`** (SPA):
  - A token gate.
  - The job ledger with a tally strip.
  - The job view: an S-expression goal tree on a paper plate, folded live in
    the browser from the SSE event stream; a trace that follows new events; a
    span-style inspector (spec, spend, tokens, scope, the goal's own events),
    selected via `?goal=`.
  - A parked-brief notice.
  - Fetch-based SSE with reconnect and resume.
- **Dev without a model:** `sampleRun` builds realistic event sequences;
  `npm run console:simulate` writes concurrent synthetic jobs into a JSONL log
  in real time.
- **Dockerfile:** the factory image installs and typechecks the factory only
  (`npm ci --workspaces=false`). The console is a separate deployable.

## Proof

- Unit and API tests: `tests/eventlog/goal-tree.test.ts`,
  `console/server/test/{job-index,api,event-sources}.test.ts`, and
  `console/web/test/sse.test.ts`. They cover interleaved concurrent jobs,
  lifecycle state, cursor paging, the auth refusal, the OpenAPI document, SSE
  replay→caught-up→live, and dashboard summary streaming.
- The Postgres round trip: events the factory's `PgEventStore` wrote are read
  back identically through the Drizzle source. This ran against a local
  Postgres 16.
- The UI was driven in headless Chromium against the simulator: token gate,
  ledger, live running tree, parked job, and a 390px phone width.

## Stuck point / remaining

- **Live proof pending:** point the console at a real `live:self` or daemon run
  on shared Postgres and watch a real tree fan out.
- **ADR-051 Phase 2:** the `jobs` table and Postgres WorkerLink. Then
  commissioning and answering from the UI (issue requirements 1–2), `job_id` /
  `worker_id` stamped at write, and `NOTIFY` on append.
- **Not yet built:** the artifact browser (req. 7), the repo registry (req. 8),
  and goal-type stats panels (req. 9, beyond spend).
- **Deploy:** a `control-plane` compose service (ADR-051 Consequences).
