---
type: reference
title: "Observability: the EventSink fan-out and the event → span mapping"
description: The `corellia logs` CLI (replay + `--follow` live tail), the `EventSink` fan-out seam that exports the event log to external tracing backends, and the neutral event→span mapping the LangSmith and OTLP adapters derive from.
tags: [observability, eventlog, cli, tracing, langsmith, otel, sink]
timestamp: 2026-07-06
---

# Observability: the EventSink fan-out and the event → span mapping

Corellia's observability is the **event log itself** (ADR-003): every decision,
tool call, verdict, block, and spend is an append-only `FactoryEvent`. This note
covers the two seams that let that log be *watched* and *exported* without
changing it as the source of truth:

1. `corellia logs` — the local viewer (replay + `--follow` live tail).
2. The `EventSink` fan-out — the seam that ships the log to an external tracing
   backend (LangSmith, OTLP/Tempo/Datadog/Honeycomb).

The core stays dependency-free (ADR-001): the seam and the one reference sink
live in the eventlog layer; vendor SDKs live only in optional adapter modules
that a future change registers in `src/daemon/config.ts`.

## The `corellia logs` CLI

The `corellia` binary is a tiny subcommand dispatcher (`scripts/corellia.ts`).
Its first subcommand is `logs`, which reads the same store the daemon writes
(JSONL at `CORELLIA_EVENTS_PATH`, or Postgres via `DATABASE_URL`).

```
npm run logs -- [path] [--follow|-f] [--tree] [--cost] [--goal <substr>] [--type <evt>]
# or directly:
npx tsx scripts/corellia.ts logs [path] ...
```

- **Replay (default):** read a finished log and print the goal tree + per-goal
  detail, optionally a `--cost` summary. This is the graduated form of
  `scripts/trace.ts`; both share `src/eventlog/render.ts`.
- **`--follow` / `-f`:** the live tail. Streams new events as compact one-liners
  (`HH:MM:SS  <goal>  <detail>`) as they are appended, with a goal-tree snapshot
  reprinted when a new goal appears (enable with `--tree`). JSONL only — with
  `DATABASE_URL` set, follow declines honestly (Postgres polling by id is a
  possible follow-on).
- **Filters:** `--goal <substr>` narrows to a goal subtree; `--type <evt>` shows
  only that event type (the tree projection still sees every event so the
  snapshot stays complete).

### How `--follow` works

`src/eventlog/tail.ts` tracks a byte offset into the JSONL file and reads only
the bytes appended since the last read. New bytes are detected by `fs.watch`
where the platform delivers change events, with a polling interval (default
250 ms) as an always-correct fallback. A trailing **partial line** — a
half-written append at the tail — is held as a carry and prepended to the next
read, so an event split across two reads is reassembled rather than dropped.
Both the watch path and the poll path funnel through the same offset-advancing
read, and reads are serialized, so a spurious or missed watch event changes only
latency, never correctness. A file that shrinks (rotation/truncation) resets the
offset to 0.

## The `EventSink` fan-out seam

```ts
interface EventSink {
  emit(event: FactoryEvent): void;   // best-effort, must never throw into the store
  flush?(): Promise<void>;
}
```

- **Placement.** `EventSink` lives in `src/contract/events.ts` beside
  `EventStore`. `SinkFanoutStore` (`src/eventlog/sink-fanout-store.ts`) is a thin
  store *decorator*: it delegates `append` to the inner store, then — only after
  a durable append — calls each sink's `emit` inside a `try/catch`. A sink that
  throws is caught and dropped; **observability can never break the factory's
  durability.** `list` delegates unchanged.
- **Wiring.** `buildStore()` (`src/daemon/config.ts`) registers sinks from env
  and wraps the concrete store only when at least one sink is present (zero
  overhead and zero behavior change when none are). Today's implicit behavior —
  just persist to JSONL/PG — is the empty sink list.
- **Reference sink.** `StdoutSink` (`src/eventlog/stdout-sink.ts`) writes each
  event as one NDJSON line. Enable with `CORELLIA_SINK_STDOUT=1`. It proves the
  seam end-to-end with no dependency; the vendor adapters below replace the line
  writer with an SDK call and follow the exact same shape.

## The neutral event → span mapping

The goal tree already *is* a trace tree. Both the LangSmith and OTLP adapters
derive from this one mapping so they cannot drift; an adapter is mechanical once
this table is fixed.

| FactoryEvent | Span / run role | Notes |
| --- | --- | --- |
| `goal-received` | **opens a span/run** for `goalId` | Root goal → root trace; child goal → child span. Run type from `goal.kind`: `make` → `chain`, `judge`/`decide`/`produce` → `llm`, a leaf's tool phase → `tool`. Name = `goal.title`. |
| `child-spawned` | **child span** nested under the parent | `childId` is the child's span id; `dependsOn` → span links. |
| `decided` | span **event** on the goal's span | `decision.kind`; `usage` → token counts on the span (see `usage`). |
| `tool-call` | span **event** (or short child `tool` span) | Attributes: `tool`, `outcome` (`ran`/`refused`), `reason`, bounded `args`. |
| `step` | span **event** | `index`, `outputKind`; `usage` → tokens. |
| `script-ran` / `capture-ran` | span **event** | `command`/`captureName`, `exitStatus`/`ok`, `durationMs`. |
| `deterministic-checked` / `judge-verdict` | span **event**; `pass=false` → sets **error status** | `judgeType`, `tier`, gating findings → attributes / run metadata. |
| `repair-applied` / `tier-escalated` | span **event** | Repair prescriptions; tier `from`→`to`. |
| `produced` / any `usage` | **token metrics** on the span | `promptTokens`, `completionTokens`, `cachedPromptTokens`, `costUsd`. |
| `ceiling-reached` / `budget-exhausted` | span **event**, warning | Spend/limit or exhausted dimension. |
| `blocked` | **closes the span with error status** | `brief.question`, `resolution` → status detail. |
| `emitted` | **closes the span** | ok if `report.blockers` is empty, else error status carrying the blockers. |
| `knowledge-*`, `pattern-*`, `worktree-*`, `pr-opened`, `branch-pushed`, `round-*` | span **events** with the event's salient fields as attributes | Non-load-bearing for the tree shape; carried as timeline events. |

Span timing: `at` (wall-clock ms) is the event time; a span's start is its
`goal-received.at` and its end is the `emitted`/`blocked` `at` for that `goalId`.

### LangSmith adapter (primary follow-on, gated on `LANGSMITH_API_KEY`)

Each goal → a LangSmith run (type per the table); child goals → child runs;
`usage` → the run's token counts; `judge-verdict` findings → run metadata;
`blocked` / non-empty `emitted.blockers` → error status. A `SinkFanoutStore`
sink buffers per-`goalId` and posts the run tree via the LangSmith SDK; `flush`
drains it at shutdown. No `src/` core import — the SDK lives only in the adapter
module registered in `buildStore()`.

### OTLP / generic adapter (vendor-neutral follow-on)

`goal-received` → span, `child-spawned` → child span, `tool-call`/`decided`/
`judge-verdict` → span events, `usage` → span/metric attributes, `blocked` /
blocking `emitted` → span status = error. One OTLP exporter reaches Grafana/
Tempo, Datadog, and Honeycomb — the lingua franca that proves the `EventSink`
interface is generic against ≥2 backends.
