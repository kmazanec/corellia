---
type: issue
title: Type and global memory layers are never written — the compounding asset doesn't compound
description: Every memory writer hardcodes layer:'project' and retrieval ignores scope, so cross-project type wisdom (DESIGN's compounding asset) never accumulates.
tags: [engine, memory, layers, promote-memory]
timestamp: 2026-07-07
status: open
kind: future-work
severity: medium
---

# Type and global memory layers are never written — the compounding asset doesn't compound

## Problem
DESIGN.md's memory model is three layers — project / type / global — with type
memory named "the compounding asset — the layer where the factory gets better
over time." In code the layer union exists, but every write path hardcodes
`layer:'project'` and retrieval doesn't scope by layer. A `critique-code` lesson
learned in one repo is invisible to the next repo; ten projects teach the factory
nothing durable. The `promote-memory` type's whole point — eval-gated promotion
with the "general, true, non-harmful beyond this project?" question — is
unreachable because there is nowhere general to promote *to*.

## Evidence
- capability-scout sweep (2026-07-07): "type/global in the union but no writer
  produces them (all hardcode layer:'project'); retrieval ignores scope."
- DESIGN.md "Memory: layered project × type × global, spawner-mediated".

## Proposed direction
Make layer a real routing decision at the promote edge: `promote-memory` decides
project vs type (vs global) from its existing generality eval, writes the chosen
layer, and spawner retrieval unions the layers relevant to the child (project of
the repo at hand + the goal-type's namespace + global), with provenance labels
intact. Note the store is keyed per-project today (per-project event-log path) —
type/global memory needs a home that outlives one project's log; deciding that
home (a shared store path/DB beside the per-project logs) is part of this work
and worth a short ADR.

## Acceptance hint
A lesson promoted with type-level generality in project A is retrieved and
injected (provenance-labeled) for a same-type goal in project B, shown in a test
across two stores/logs — and nothing about project-layer behavior regresses.

---

> **Fixed (2026-07-07, ADR-049, branch `issue/memory-layers`; pending live
> proof).** Type and global memory now have a home that outlives any one
> project's log, so the compounding asset finally compounds.
>
> **Store home (the ADR-049 decision).** A second JSONL event store — the shared
> store — sits beside the per-project logs at an env-configured path
> (`CORELLIA_SHARED_LOG`, default `out/_shared/memory.jsonl`), holding only the
> `memory-written` / `memory-reinforced` events for the **type** and **global**
> layers. Project memory stays in the per-project log exactly as before, so the D3
> per-target-repo topology and the "dies with the project" lifetime are preserved.
> Reusing the existing `JsonlEventStore` + `projectMemory` + event contract earns
> DESIGN's "independent store … as a projection of the event log" with zero new
> substrate; the Postgres swap is a clean follow-on behind the same
> `buildSharedStore` seam (alternatives A–D recorded in the ADR).
>
> **Layer routing at the promote edge.** `promoteChildReports` (the exercised
> write path) now routes each lesson through `chooseMemoryLayer` (new,
> `src/engine/memory-layer.ts`): an explicit `[type]` / `[global]` tag on the
> lesson — prepended by the `promote-memory` harness when its generality eval
> fires — selects the layer; untagged stays `project` (the pre-ADR-049 default, so
> project behavior is unchanged). A `type` pointer is namespaced to the producing
> goal-type. `type`/`global` writes land in the shared store, `project` writes in
> the per-project store; reinforcement is written to both stores (each projection
> folds only reinforcements for a memory it wrote). The engine only *routes* on the
> tag — it never runs the generality *judge* on the hot path (kept pure,
> deterministic-before-judge).
>
> **Retrieval union.** `projectMemory.query` now filters by layer + namespace
> (project/global always eligible; a `type` pointer eligible only for a query
> naming its namespace), and `unionMemoryViews` composes the per-project and
> shared views behind the single `MemoryView` the engine consumes. `buildLiveEngine`
> opens the shared store alongside the per-project store and builds the unioned
> view; the spawner passes the child's goal-type into the query so the type
> namespace is unioned in. Provenance and `layer` travel on every returned pointer.
>
> **Deviation from the sketch above:** the generality decision is communicated to
> the engine as a **structured tag on the lesson**, not by wiring an LLM eval into
> `promoteChildReports` — the full generality/contradiction eval stays in the
> `promote-memory` harness that owns it (GOAL-TYPES), which keeps the recursive
> operation pure. `global` is conservative: explicit tag only, never inferred.
>
> **Contract deltas (minimal, additive):** `MemoryPointer.namespace?` (the
> goal-type a type memory is scoped to); `MemoryView.query`'s optional third arg
> `{ goalType? }` (an omitted ctx retrieves project + global only, so every
> existing caller is unchanged); `EngineOptions.sharedStore?`. No event-shape
> change, no parser change, no new goal type.
>
> Mechanism in `src/engine/memory-layer.ts` (classifier), `split-report.ts`
> (promote-edge routing), `eventlog/projections.ts` (`layerEligible` filter +
> `unionMemoryViews`), `daemon/config.ts` (`buildSharedStore` /
> `defaultSharedLogPath`), `daemon/live-engine.ts` (open shared store + unioned
> view), threaded through `options.ts` → `engine.ts` → `recursive-runner.ts` →
> `split-runner.ts` → `split-round.ts`; retrieval namespace passed at
> `split-children.ts`. Proven at the seam: `tests/engine/memory-layer.test.ts`
> (classifier), `tests/engine/split-report.test.ts` (a `[type]` lesson promoted
> against store A is namespaced into the SHARED store and retrieved+unioned for a
> same-type goal reading store B; a different goal-type does not see it; untagged
> stays project), `tests/eventlog/projections.test.ts` (layer/namespace filtering
> + union with labels intact). A live run promoting a real type lesson in one repo
> and consuming it in another is the confirming proof.
