---
type: adr
title: "ADR-049: type and global memory live in a shared event-log store beside the per-project logs"
description: Type memory is DESIGN's compounding asset, but the store is keyed per-project (per-target-repo event-log path, D3), so a lesson learned in project A can never reach project B — there is nowhere durable to promote to. Give type- and global-layer memory a home that outlives any one project's log: a second, shared JSONL event store at an env-configured path (CORELLIA_SHARED_LOG, default out/_shared/memory.jsonl). Project memory stays in the per-project log. Layer is decided at the promote edge and routes the memory-written event to the right store; spawner retrieval unions the per-project store with the shared store, filtering the type layer by the child's goal-type namespace, with provenance and layer labels intact.
tags: [adr, memory, layers, promote-memory, event-log, compounding-asset]
timestamp: 2026-07-07T12:00:00-05:00
---

# ADR-049: type and global memory live in a shared event-log store beside the per-project logs

**Status:** Accepted · **Date:** 2026-07-07 · **Stretch:** no · **Contract:** yes
**Relates to:** ADR-019 (project memory as knowledge artifacts), the D3 fix
(per-target-repo event-log path, `defaultEventsPath`), DESIGN "Memory: layered
project × type × global" and "Where state lives — the three-way split"

## Context

DESIGN names three memory layers — project / type / global — and calls type
memory **"the compounding asset — the layer where the factory gets better over
time."** In code the `MemoryPointer.layer` union exists, but the compounding
never happens: the single exercised write path
(`promoteChildReports`, the parent's integrate edge) hardcodes
`layer:'project'`, retrieval ignores both scope and layer, and — the load-bearing
constraint — **the store is keyed per-project.** The D3 fix gave each target repo
its own event log (`out/<repo-basename>/events.jsonl`, `defaultEventsPath`), so a
lesson learned while working on project A is written into A's log and is
physically absent from B's. Memory is a projection of the event log
(`projectMemory`); if type memory is projected from the *per-project* log, it
dies with the project exactly like project memory does.

DESIGN already anticipates this in "Where state lives": memory is
**"an independent store (neither the factory repo nor any product repo), as a
projection of the event log."** The per-project log satisfies "not the product
repo" but not "independent" — it is the product's own log. Type and global memory
need a home that outlives any single project's log. Deciding that home is the
subject of this ADR (the issue,
[type-global-memory-layers](../issues/type-global-memory-layers.md), flags it as
"part of this work and worth a short ADR").

## Decision

Give type- and global-layer memory a **shared event-log store** that sits beside
the per-project logs and outlives any one of them. Concretely, v1:

1. **A second JSONL event store** at an env-configured path,
   `CORELLIA_SHARED_LOG`, defaulting to `<cwd>/out/_shared/memory.jsonl` — a
   sibling of the per-repo `out/<repo>/events.jsonl` logs, not inside any one of
   them. It holds only the `memory-written` / `memory-reinforced` events for the
   **type** and **global** layers. Project-layer memory stays in the per-project
   store exactly as today. The shared store is the same `EventStore` /
   `JsonlEventStore` type the per-project store already uses — no new substrate,
   no new interface. (`DATABASE_URL` mode is untouched by v1; the shared store is
   JSONL-only for now — see Tradeoffs.)

2. **Layer is a routing decision at the promote edge.** `promoteChildReports`
   already sees each child goal and its lessons. A pure classifier,
   `chooseMemoryLayer(lesson)`, maps each lesson to `project | type | global`
   from an **explicit generality signal** carried on the lesson text (a leading
   `[type]` / `[global]` tag the promote-memory harness prepends when its
   generality eval fires; untagged ⇒ `project`). The chosen layer is stamped on
   the pointer; a `type`-layer pointer additionally carries a `namespace` — the
   producing goal-type name — so type wisdom is scoped to the operation it
   describes. The `memory-written` event then lands in the **shared** store for
   `type`/`global` and the **per-project** store for `project`.

3. **Retrieval unions the layers relevant to the child.** The spawner-side
   MemoryView projects **both** stores and unions the result: the per-project
   store contributes the project layer; the shared store contributes the type
   layer filtered to the child's goal-type namespace, plus global unconditionally.
   Provenance (`provisional | trusted`) and `layer` travel on every returned
   pointer, so a type/global memory is attributed to its layer at read time, not
   silently flattened into project facts.

Global is conservative by construction: it is written only on the **explicit**
`[global]` grounds, never inferred, so an over-eager promotion lands at worst in
the type namespace, not org-wide.

## Alternatives Considered

### (A) A relational/graph store or a dedicated memory DB for all three layers

**Rejected for v1.** DESIGN explicitly defers the projection *implementation*
("whether the memory read-model is graph-shaped, a wiki, or a keyed table is
deferred until relationship queries earn the complexity; the event-log contract
is fixed, the projection is swappable"). A second JSONL log reuses the existing
`JsonlEventStore`, `projectMemory`, and event contract wholesale; it earns the
"independent store" property with zero new substrate. When relationship queries
or multi-writer concurrency earn it, the shared store swaps to Postgres behind
the same `EventStore` interface without touching the routing or the union.

### (B) One shared log for *everything*, per-project logs folded in

**Rejected.** The D3 fix exists precisely so concurrent runs against different
repos do not clobber a shared log, and so a project's operational history dies
with the project. Project memory is instance state that *should* die with the
project (DESIGN's table); only the compounding layers (type/global) want the
durable independent home. Keeping project memory in the per-project log preserves
the D3 guarantee and the "dies with the project" lifetime, and confines the new
write surface to exactly the two layers that need it.

### (C) A namespace/tenant column inside a single store instead of a second store

**Rejected for the JSONL substrate.** With one JSONL file per target repo there
is no shared file to add a column to — the *file* is the per-project boundary. A
tenant column only helps a single-table substrate (Postgres), and even there the
layer is already carried on `pointer.layer`; the missing thing is a store that is
not deleted with the project, which a column does not provide. The second-store
decision is substrate-agnostic: on Postgres, "the shared store" is simply a
second `DATABASE_URL`-less table or a shared connection, added later without
re-deciding the routing.

### (D) Carry the layer decision as an LLM eval inside the engine at the promote edge

**Rejected.** The recursive operation is pure; state and judgment live at the
edges, not inside the engine's deterministic assembly. Running a generality
*judge* synchronously inside `promoteChildReports` would put a model call on the
hot integrate path and couple the engine to a brain. Instead the generality
decision is made where it belongs — in the `promote-memory` harness (a `judge`/
`evolve`-shaped act with its own eval, per GOAL-TYPES) — and communicated to the
engine as a **structured, deterministic signal** on the lesson (the `[type]` /
`[global]` tag). The engine only *routes* on that signal; it never *judges*. This
keeps the "deterministic before judge" and "engine is pure" disciplines intact
and leaves the full generality eval to the type that owns it.

## Consequences for the Build

- **`src/contract/goal.ts`**: `MemoryPointer` gains an optional `namespace?:
  string` — the goal-type a type-layer memory belongs to. Additive; absent on
  project/global pointers.
- **`src/contract/memory.ts`**: `MemoryView.query` gains an optional third
  argument `{ goalType?: string }` so retrieval can filter the type layer by the
  child's namespace. Additive; absent ⇒ no type-layer namespace match (project +
  global only), preserving every existing caller.
- **`src/engine/memory-layer.ts`** (new): `chooseMemoryLayer(lesson)` and the
  tag-stripping helper — the pure promote-edge classifier.
- **`src/engine/split-report.ts`**: `promoteChildReports` takes an optional
  `sharedStore` and routes each `memory-written` to the shared store for
  `type`/`global`, the per-project store for `project`, stamping layer + namespace.
- **`src/eventlog/projections.ts`**: `projectMemory` filters by layer + namespace
  in `query`; a new `unionMemoryViews` composes the per-project and shared views.
- **`src/daemon/config.ts`**: `buildSharedStore()` + `defaultSharedLogPath()`,
  mirroring `buildStore` / `defaultEventsPath`.
- **`src/daemon/live-engine.ts`**: open the shared store alongside the
  per-project store and build the unioned MemoryView; thread the shared store to
  the engine's promote edge.
- **No event-shape change, no parser change** — the `layer` (and now `namespace`)
  ride inside the existing `memory-written` pointer, which the parser already
  accepts. No new goal type; `promote-memory` keeps its contract and gains a real
  home to write to.

## Tradeoffs & Risks

- **Two stores to open and close.** One extra handle threaded through the live
  wiring. Bounded: the shared store is built by the same factory as the
  per-project store and closed alongside it.
- **JSONL shared log is single-writer-append.** Concurrent trees across repos now
  append type/global memory to one file. JSONL append is line-atomic and the
  write volume (promotions only, not every event) is low, so v1 accepts this; the
  Postgres swap (Alternative A) removes it when concurrency earns the move.
- **`DATABASE_URL` mode does not yet route memory to a shared table.** v1 scopes
  the shared store to the JSONL path; under Postgres the shared store falls back
  to the same JSONL default so the compounding still works. Wiring a shared PG
  table is a clean follow-on behind the same `buildSharedStore` seam.
- **The generality tag is trusted input from the promote-memory harness.** A
  mislabeled lesson routes to the wrong layer. Mitigated: global requires the
  explicit `[global]` tag (never inferred), the union still provenance-labels
  every pointer, and the existing decay/eviction and contradiction-check
  machinery apply to type/global memory exactly as to project memory.
