# Build plan — 04-eyes

**Status:** Awaiting approval · **Iteration goal:** After this iteration,
pointed at an existing repo the factory maps what it needs (JIT, as split
dependencies), splits sensibly against fresh knowledge, and a leaf consults
`impact()` through the broker before touching code — proven scripted on
fixtures, live on corellia itself, and read-only on one real foreign repo.
· **Iteration slug:** `04-eyes`

Planned by the orchestrator directly (no workflow), per the operator's
direction. Gate-brief decisions locked 2026-06-11: **ADR-019** (knowledge
artifacts event-projected, SHA-anchored freshness), **ADR-020** (hybrid
impact graph: deterministic scanner = facts, dives = semantics), **ADR-021**
(coverage as a per-kind policy table), four categories
(`architecture`/`stack`/`conventions`/`test-scaffold`), done-when includes a
foreign-repo mapping run.

## Blockers

None.

## Frozen contracts (implemented first, one barrier commit on `build/04-eyes`)

| Contract | Source of truth | Frozen signature (file) | Consumers |
|---|---|---|---|
| `KnowledgeArtifact` / `KnowledgeCategory` (all seven in the union; four shipped) / `DiveFact` (anchored claims) | ADR-019, GOAL-TYPES § learn | NEW `src/contract/knowledge.ts`, re-exported from index | F-41 (projection), F-44 (producers), F-45 (gate), F-46 |
| `FactoryEvent` additive members: `knowledge-written {artifact}`, `knowledge-checked {repoRoot, category, sha, outcome: fresh\|stale-validated\|invalid}` | ADR-019, ADR-003 | EXTEND `src/contract/events.ts`; exhaustive switches gain arms at the barrier | F-41, F-44, F-45, F-46 |
| `GRANT_TOOL_MAP` additive entries: `find_symbol`/`find_exemplar`/`conventions_for`/`stack_versions`/`impact` → `['retrieval.api','fs.read']` (either grant suffices) | ADR-020, ADR-014, ADR-013 | EXTEND `src/contract/tool.ts` (const only — no shape change) | F-43, F-46, broker tests |
| Scanner surface: `scanImports(root, opts?) => ImportGraph {edges: {from,to}[], scannedAtSha}`; `impact(graph, files) => {files, testFiles}` | ADR-020 | Engine-side frozen surface in `src/library/imports.ts` — NOT `src/contract/` | F-42 (implements), F-43/F-45/F-46 (consume) |
| Knowledge write helpers: `writeKnowledge(store, artifact)`, `recordKnowledgeCheck(store, …)` | ADR-019 | Library-side frozen surface in `src/library/knowledge.ts` (or colocated with the projection — barrier picks one home) | F-41 (implements), F-44/F-45 (consume) |
| Coverage surface: `coverageCheck(goal, knowledge, graph) => {ok, missing}` + the ADR-021 policy table | ADR-021 | Library-side frozen surface in `src/library/coverage.ts` | F-45 (implements), F-46 (wires) |

**Barrier compiles green** (iteration-03 lesson, standing rule): the barrier
commit includes the mechanical propagation — exhaustive-switch arms for the
two new event members repo-wide, the `GRANT_TOOL_MAP` extension, and empty-
but-typed module stubs ONLY where a frozen surface must exist for parallel
builders to import (prefer no stubs: every consumer listed above can build
against types + its own test doubles).

## Features & build order

F-41..F-45 are behaviorally independent at the barrier; F-46 wires their
implementations (honest hard deps). `src/engine/engine.ts` is touched by
F-45 and F-46 only — serial chain **F-45 → F-46** on the trunk; F-41, F-42,
F-43, F-44 fan out concurrently in their own worktrees and fold back by
cherry-pick before F-45 starts… **correction (reconciliation self-review):**
F-45 consumes only frozen surfaces, so it can build on the trunk **in
parallel with** the worktree features; fold-backs land before F-46.

| Feature | Spec | Stack | After (scheduling) |
|---|---|---|---|
| F-41 knowledge store + projection | [01-knowledge-store.md](01-knowledge-store.md) | typescript | *(barrier)* — worktree |
| F-42 import scanner + impact() | [02-import-scanner.md](02-import-scanner.md) | typescript | *(barrier)* — worktree |
| F-43 retrieval tools | [03-retrieval-tools.md](03-retrieval-tools.md) | typescript | *(barrier)* — worktree |
| F-44 learn types | [04-learn-types.md](04-learn-types.md) | typescript | *(barrier)* — worktree |
| F-45 coverage gate + JIT spawn | [05-coverage-gate.md](05-coverage-gate.md) | typescript | *(barrier)* — trunk (engine.ts) |
| F-46 assembly + convergence | [06-assembly-eyes.md](06-assembly-eyes.md) | typescript | F-41..F-45 *(hard — wires implementations)* |

File-overlap notes: `starter-types.ts` (F-44 only), `projections.ts` (F-41
only), `broker.test.ts` extended by F-43 (worktree) — no two features share
a source file; `engine.ts` is F-45-then-F-46 by the chain.

## Standing decisions carried from iteration 03

Engine is the sole budget debitor · adapter purity (incidents on envelopes)
· builders never touch `docs/` or run live scripts · process-clean code AND
test labels · per-feature opus judge with prescriptions at fold-back, sonnet
fixers, scripted convergence before any live call · live runs are
operator/orchestrator-run only.

## Reconciliation self-review (the five-point check applied to this plan)

1. *Cross-feature contradictions:* none found — each frozen surface has
   exactly one implementing feature; consumers build on types/doubles.
2. *Decision propagation:* gate-brief answers are in ADR-019/020/021 and
   restated in the specs' reading briefs.
3. *Orphaned work:* the iteration-03 orphan class is pre-closed — F-46
   explicitly owns registration/wiring of everything; no feature defers to
   "someone else" without F-46 naming it.
4. *Barrier compiles standalone:* yes — additive types/events/const only;
   no Brain or check-shape changes this iteration.
5. *Assembly ownership:* F-46, with honest hard deps and the convergence +
   live scripts.

Known soft spot, named: AC-16's checkpoint verify-on-read (F-45 chunk 3)
is the most likely seam to need an engine-internal judgment call about
*which* consumed artifacts a checkpoint re-reads — the builder must surface
that as a deviation, not improvise broadly.

## How this builds

Same process as iteration 03: barrier (opus) → fan-out (sonnet builders;
F-45 on trunk concurrently) → per-feature opus judges + sonnet repair rung →
fold-back by cherry-pick → F-46 (opus) → final judge → process-clean sweep →
scripted convergence → live:eyes on corellia + the operator-named foreign
repo → PR. The factory never self-merges.
