---
type: issue
title: "Operator console — a first-party web UI as the human entrypoint into the factory"
description: Build Corellia's operator console — a co-equal commission-and-observe web app (live job tree fanout, log stream, artifact browser, repo registry, tracing-style debugger) backed by a new read-model/API layer over the event log.
tags: [ui, operator-console, observability, read-model, daemon, eventlog, harness, front-door]
timestamp: 2026-06-26
status: open
kind: future-work
severity: high
---

# Operator console — a first-party web UI as the human entrypoint into the factory

> **Scope note.** This is a deliberately heavy issue: it carries a micro-PRD
> (numbered, behavioral requirements) and a micro-architecture (decisions framed
> as tensions, not yet committed). It is still *one captured intent, unplanned and
> undone* — when it is built it becomes an iteration (and likely several ADRs) and
> this file is deleted. The PRD/architecture form here is to make it
> *commission-ready*, not to pre-commit the design. Premises below are rejectable.

## Problem

Corellia today has **no human-facing surface**. The factory's entrypoints are a
CLI (`live:*` scripts, `commission:run`) and a three-route webhook daemon
(`src/daemon/http-server.ts`, ADR-026): `POST /intents`, `POST /intents/:id/answer`,
`GET /status`. To watch a run you `tail -f out/events.jsonl` and parse JSONL by
hand; to see the goal-tree fanout you run `scripts/trace.ts` over a *finished* log;
to know what a run produced you read worktrees and git. The `GET /status` route is
coarse — intent states only (`running`/`queued`/`parked`, `FrontDoorStatus` at
`src/contract/brief.ts:63`) and poll-based. None of this is a human entrypoint.

The factory's whole value proposition is that it runs **unattended and
autonomously**. But "unattended" without a window to look through means an operator
is flying blind: they cannot *see* it running, *steer* a parked intent without
crafting a curl, *understand* why a job blocked, or *find* what a finished job
produced without spelunking the filesystem. As runs get longer, more concurrent,
and more recursive (the goal tree fans out per ADR-029/031), this gap widens from
an inconvenience into the thing that blocks day-to-day operation of the factory.

This is the **human entrypoint** the bootstrap phase has been deferring. It is
distinct from [`observability-pluggable-tracing`](observability-pluggable-tracing.md)
(that issue fans the event log *out* to external backends — LangSmith/OTLP — and
adds a `corellia logs --follow` CLI; it is a sink + CLI, not a UI) and from
[`deploy-the-factory-end-to-end`](deploy-the-factory-end-to-end.md) (which gets the
daemon *running* in the cloud; this issue is what an operator points a browser at
once it is). Those are complements, not duplicates — see *Relationship to existing
work* below.

## Evidence

- **The entrypoint surface is webhook-only.** `src/daemon/http-server.ts` exposes
  exactly three JSON routes behind a bearer token (ADR-026 header comment). There
  is no HTML, no stream, no asset serving — nothing a browser can use as an app.
- **`GET /status` is coarse and poll-based.** `FrontDoorStatus`
  (`src/contract/brief.ts:63`) is intent-id lists by state plus parked briefs. It
  carries no per-job tree, no live progress, no cost, no artifact list — it cannot
  back a console as-is.
- **The read-side projections already exist but are CLI/post-hoc only.**
  `src/eventlog/projections.ts` folds the log into `renderTree` (the goal-tree
  fanout, `:501`), `costSummary` (`:263`), `traceStats` (`:101`), and
  `projectKnowledge` (artifact freshness, `:404`). These are exactly the views a
  console needs — but today they are consumed by `scripts/trace.ts` over a
  *finished* JSONL file, not served live.
- **The event log is already a trace tree.** 40 `FactoryEvent` types
  (`src/contract/events.ts`); `goal-received` opens a node, `child-spawned` nests,
  `tool-call`/`decided`/`judge-verdict` are steps, `emitted`/`blocked` close it.
  This maps almost 1:1 onto a tracing-platform UI (think LangSmith's nested runs).
- **The one clean seam for liveness:** `EventStore.append(e)` is the single choke
  point every event flows through (noted in the observability issue). A live
  read-model can subscribe there without changing the log as source of truth
  (ADR-003).
- **Surfaced repeatedly during bootstrap** (`docs/log.md`, ADR-034/035 build runs):
  every progress check during a `live:self` run meant hand-parsing
  `out/*-events.jsonl`. The absence of a UI is felt on essentially every run.

## Proposed direction

> Rough, deliberately loose. A real build runs a planning pass (iteration +
> ADRs). What follows is micro-PRD + micro-architecture *form* to make this
> commission-ready, with the key tensions called out so the builder can decide
> them rather than inherit a guess.

### Product intent (the micro-PRD)

A **co-equal full operator console**: commissioning and observation are both
first-class from v1. The console is the single place a human looks at, talks to,
and steers the factory. Requirements, behavioral and numbered:

1. **Commission a job.** Author/submit a new intent (the human→factory front door)
   from the UI — not by crafting a webhook call. Plausibly wraps the existing
   `commission` flow / `POST /intents`.
2. **Answer a parked intent.** When a job parks on a brief (ADR-026), the operator
   sees the question and answers it in the UI (wraps `POST /intents/:id/answer`).
3. **See all jobs at a glance.** A dashboard of running / queued / parked /
   finished jobs with state, cost-so-far, and age — a richer `FrontDoorStatus`.
4. **Watch a job's tree fanout, live.** The recursive goal tree (`renderTree`'s
   data, rendered as an interactive tree, not ASCII) updating as children spawn
   and close.
5. **Stream a job's live log.** A real-time event/log stream for a running job —
   the "watch it run unattended" view — replacing `tail -f`.
6. **Debug a job like a tracing platform.** Drill into any node: its decisions,
   tool calls, judge verdicts, spend, scope, and why it blocked — a span-detail
   inspector. This is the tracing-platform-style debugger.
7. **Browse artifacts of finished jobs.** View what a job produced — emitted
   artifacts, knowledge artifacts with freshness (`projectKnowledge`), PRs opened,
   commits — without touching the filesystem.
8. **See connected git repos.** A registry of the repos/worktrees the factory is
   wired to, with their state.
9. **Cost & usage visibility.** Per-job and aggregate spend (`costSummary`) and
   goal-type stats (`traceStats`) surfaced as panels.

**Liveness is a v1 requirement, not a follow-on** (req. 4–5): the tree and log
update in real time as events append, not on a refresh button. Static post-hoc
viewing of finished runs is a strict subset and comes for free.

**Explicit non-goals (v1):** multi-tenant auth / RBAC (single-operator app per
ADR-026 stays the assumption); editing the event log through the UI (read-only
over the log — the log is the source of truth, ADR-003); replacing the CLI
entrypoints (they remain; the UI is additive).

### Architecture tensions (the micro-architecture — decide these, don't inherit them)

- **Read-path spine — settled direction: a new read-model / API layer.** Rather
  than fattening the daemon's `GET /status`, stand up a dedicated query/API layer
  that maintains its own projections/cache over the event log (subscribing at the
  `EventStore.append` seam) and serves the console. *Tension to resolve in
  planning:* does this read-model live **inside the daemon process** (one
  deployable, shares the store handle) or as a **separate service** (independent
  scaling/restart, but now two processes over one log)? The log stays the single
  source of truth either way (ADR-003) — the read-model is a derived, rebuildable
  cache, never a second system of record.

- **Liveness transport.** SSE vs WebSocket vs long-poll for req. 4–5. SSE is the
  lighter fit (server→client, one-directional, survives the existing `node:http`
  stack with zero deps — matching the daemon's "zero runtime deps beyond pg"
  posture). WebSocket buys bidirectional but adds a dep and handshake surface.
  Decide against the v1 need (mostly server→client) before reaching for the
  heavier option.

- **Frontend stack & where it's served.** A real app (tree views, live streams,
  drill-down) wants a component framework — but the repo today is a zero-UI,
  near-zero-dep TypeScript factory. Tension: adopt a framework (React/Svelte/etc.)
  and a build step, vs. keep it minimal. And: does the daemon serve the built
  assets (one deployable, matches ADR-026's hosted-app framing) or is the UI a
  separately-deployed static app hitting the API? Weigh against
  [`deploy-the-factory-end-to-end`](deploy-the-factory-end-to-end.md) so the UI's
  deploy story folds into the daemon's, not beside it.

- **Reuse the projections, don't reinvent them.** `renderTree`, `costSummary`,
  `traceStats`, `projectKnowledge` already compute the exact views the console
  needs. The read-model should expose *their data* (structured, not the ASCII
  render) over the API — refactoring the projections to emit data + a thin
  renderer if needed, so the CLI and UI share one projection core.

- **Auth.** Reuse the daemon's bearer-token model (ADR-026) for the API; the UI
  carries the token. No new auth system in v1 (non-goal above).

- **Constitution & OKF fit.** This is a large new subsystem — it must pass the
  constitution lint (`src/library/constitution.ts`) and OKF doc conformance
  (ADR-035). It will almost certainly mint several ADRs (read-model spine,
  liveness transport, frontend/serve decision). Build it the factory way:
  ideally **commission it through Corellia's own front door** once it can carry a
  job this size; if the factory stalls on it during bootstrap, hand-build on
  `main` per the CLAUDE.md bootstrap loop and re-prove through `live:self`.

### Rough build shape (loose — a planning pass owns the real decomposition)

A natural slicing, dependency-ordered: **(a)** read-model + data-shaped
projections + API over the event log → **(b)** live transport at the
`EventStore.append` seam → **(c)** the frontend shell + dashboard (req. 3, 8–9) →
**(d)** the job detail / tree / log-stream / debugger views (req. 4–6) → **(e)**
commission + answer flows (req. 1–2) → **(f)** artifact browser (req. 7). Each is a
vertical slice; (a) and (b) are the spine everything else reads from.

## Acceptance hint

A single operator can, from a browser pointed at the running daemon and
authenticating with the front-door token:

1. **Commission a new job** and watch it appear in the dashboard as `running`.
2. **Watch that job's goal tree fan out live** — children appear and close in real
   time as the run progresses, without a manual refresh.
3. **Stream the job's log live** and **drill into any tree node** to see its
   decisions, tool calls, verdicts, spend, and (if blocked) why.
4. **Answer the job if it parks**, from the UI, and see it resume.
5. **After it finishes, browse its artifacts** (emitted + knowledge artifacts with
   freshness, PRs/commits) and its final cost — **without touching the filesystem
   or tailing a JSONL file**.

The disqualifier: if seeing a run still requires `tail -f out/events.jsonl` or
`scripts/trace.ts`, the console has not replaced the blind-flying it exists to end.
