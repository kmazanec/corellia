---
type: issue
title: "Pluggable observability: an EventSink fan-out (LangSmith-first) + a `corellia logs` CLI"
description: Fan the event log out to external tracing backends via a thin EventSink interface (LangSmith first, OTLP/generic as follow-ons), and add a `corellia logs --follow` CLI for local ergonomics — both reading the existing event log without changing it as the source of truth.
tags: [observability, eventlog, daemon, cli, tracing, langsmith, otel, dx]
timestamp: 2026-06-25
status: open
kind: idea
severity: medium
---

# Pluggable observability: an EventSink fan-out (LangSmith-first) + a `corellia logs` CLI

## Problem
Corellia's observability today is the **event log itself** (ADR-003): every
decision, tool call, verdict, block, and spend is an append-only `FactoryEvent`
(`src/eventlog/`, ~38 event types). The read-side is good for *post-hoc* analysis
— `scripts/trace.ts` replays a finished JSONL log, and `projections.ts` folds it
into `renderTree` / `costSummary` / `traceStats`. Two gaps:

1. **No way to plug the log into a real tracing backend.** Operators running the
   deployed daemon can't send factory activity to LangSmith, Grafana/Tempo,
   Datadog, Honeycomb, etc. The daemon's `GET /status` is coarse (intent states
   only — running/queued/parked, ADR-026/027) and poll-based; it is not a trace.
2. **No live local view.** During a run there is no streaming window — to watch a
   `live:self` run you must `tail -f out/events.jsonl` and parse JSONL by hand
   (exactly what gets done during bootstrap debugging). `scripts/trace.ts` only
   reads a *finished* log; it has no `--follow`.

This matters more as runs get longer and more autonomous: the factory's whole
value is that it runs unattended, but you currently can't *see* it running except
by tailing a file.

## Evidence
- The single seam that makes this clean: **`EventStore.append(e)` is the one
  choke point** every event flows through (`src/contract/events.ts:121`;
  implemented by `JsonlEventStore`, `PgEventStore`, `InMemoryEventStore`). Every
  event carries `{ type, at, goalId, ... }`.
- The goal tree **is already a trace tree**: `goal-received` opens a node,
  `child-spawned` nests children, `tool-call` / `decided` / `judge-verdict` are
  steps, `emitted` / `blocked` close it. This maps almost 1:1 onto LangSmith's
  nested-run model and onto OTel spans.
- Store selection is already env-driven (`src/daemon/config.ts`: `DATABASE_URL` →
  PG, else `JsonlEventStore` at `CORELLIA_EVENTS_PATH`) — the natural place to also
  wire optional sinks.
- Surfaced while debugging the ADR-034/035 build runs (2026-06-25): every progress
  check meant hand-parsing `out/build-okfN-events.jsonl`. See [docs/log.md](../log.md).

## Proposed direction

Two parts, both **reading the event log without changing it as the source of
truth** (ADR-003 holds; the log stays the factory's memory, ADR-019). Core stays
dependency-free (ADR-001) — vendor SDKs live only in optional, separately-wired
adapter modules.

### Part 1 — EventSink fan-out (export to backends)

Add a thin sink interface that the store fans out to *after* a successful append:

```ts
interface EventSink {
  emit(event: FactoryEvent): void;   // best-effort, never throws into the store
  flush?(): Promise<void>;
}
```

- The store calls each registered sink's `emit` after persisting. A sink failure
  is caught and dropped (or logged) — observability must never break the factory's
  durability. Storage (JSONL/PG) is unchanged; sinks are additive.
- Sinks are wired at the **daemon** (`src/daemon/config.ts` / `daemon.ts`) from
  env, not in core. Today's behavior is the implicit `JsonlSink`.
- **LangSmith first** (the primary adapter): map the goal tree to LangSmith's
  run/trace model — each goal → a run (type derived from kind: `chain` for a
  composite, `llm` for a decide/produce/judge, `tool` for a leaf's tool calls),
  child goals → child runs, `usage` → token counts, `judge-verdict` findings →
  run metadata, `blocked` → error status. Gated behind `LANGSMITH_API_KEY`.
- **OTLP / generic as the documented follow-on:** a second adapter mapping
  `FactoryEvent` → OTel spans (goal = span, child-spawned = child span,
  tool/decide/verdict = span events, `usage` → metrics, block → span status). One
  OTLP adapter reaches Grafana/Tempo, Datadog, Honeycomb, etc. — the vendor-neutral
  lingua franca.

The two adapters should derive from the **same event→span mapping** so they don't
drift; consider a small neutral "trace projection" (`projections.ts`-style) that
turns the event stream into abstract spans, with each adapter rendering those into
its wire format.

### Part 2 — `corellia logs` local CLI (developer ergonomics)

Graduate `scripts/trace.ts` into a real `corellia logs` subcommand:

- `corellia logs [path]` — the current replay (tree + per-goal trace + cost).
- `corellia logs --follow` / `-f` — **the missing live tail**: stream new events
  as they're appended (poll/`fs.watch` the JSONL; for PG, poll by id), rendering
  the goal tree and per-goal lines incrementally. This is the everyday "watch a
  run" win.
- `--goal <substr>`, `--type <evt>` filters; `--cost` summary; color.
- Reads the same store the daemon writes (respects `CORELLIA_EVENTS_PATH` /
  `DATABASE_URL`), so it works for both `live:*` runs and the deployed daemon.

**Follow-on (not this issue):** a richer interactive **TUI** — a live goal-tree
that updates in place, drill-into-goal, a cost meter, block alerts. Captured here
so it isn't lost; build it separately once `corellia logs --follow` proves the
shape.

## Acceptance hint
- A daemon run with `LANGSMITH_API_KEY` set produces a LangSmith trace whose
  run tree matches the factory's goal tree (goals as nested runs, tool/decide/judge
  steps, token costs), with no vendor SDK imported by `src/` core (only the
  optional adapter module).
- The event log + storage behavior are unchanged; a sink that throws does not break
  a run (the factory still persists and converges).
- `corellia logs --follow` streams a `live:self` run's events live, rendering the
  goal tree + per-goal trace incrementally, honoring `CORELLIA_EVENTS_PATH`.
- The OTLP adapter is specified (event→span mapping) even if implemented as a
  follow-on, so the EventSink interface is proven generic against ≥2 backends.
