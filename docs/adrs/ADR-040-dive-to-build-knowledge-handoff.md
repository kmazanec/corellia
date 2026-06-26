---
type: adr
title: "ADR-040: the dive→build knowledge handoff — a dependency dive's RegionFacts are injected into the dependent builder"
description: A deep-dive-region comprehends a region and persists RegionFacts, but the spawner only injected memory-store pointers — never the dive's facts — so a dependent build leaf re-read 147 files the dive had already understood. Add a knowledge.factsForRegions read seam and inject a dependency dive's anchored facts into the dependent's memories at spawn, making DESIGN.md's "findings injected by the spawner like any other memory" real.
tags: [adr, engine, knowledge, comprehend, build, memory, spawner, verify-on-read, region-facts]
timestamp: 2026-06-26T16:00:00-05:00
---

# ADR-040: the dive→build knowledge handoff

**Status:** Accepted · **Date:** 2026-06-26 · **Stretch:** no · **Contract:** yes
**Supersedes:** none · **Relates to:** ADR-019 (knowledge artifacts), ADR-021 (coverage gate), ADR-029 (comprehension recursion)

## Context

DESIGN.md is explicit about how comprehension reaches the builder that needs it:

> "a leaf that will change a region deep-dives *that region only*, as a dependency,
> before changing it — **findings injected by the spawner like any other memory**."

The implementation built the *first* half — the split gate spawns a `deep-dive-region`
as a dependency of a builder whose scope it covers (ADR-021), and the dive persists a
`RegionFacts` artifact (the anchored claims about the region) via the knowledge path.
But it never built the *second* half — the injection.

Build run `live-self-4793fc14` (slice C) made this concrete and expensive. The root
decomposed cleanly; all five coverage dives ran and persisted `RegionFacts` for
exactly the regions the builders would touch (`src/engine`, `tests/engine`,
`docs/issues`, `docs/log.md`, `docs/iterations`). Then the `implement` build leaf
(`impl-steps`) ran with **zero injected memories** and **re-read 147 files** — the very
regions the dives had just comprehended — across 34 steps, never converging to a write.
The dive-as-dependency pattern exists precisely to prevent that re-reading; it was
sequencing the dive before the build but throwing the dive's findings away.

The cause is a missing read seam, not a storage gap. Both the memory and knowledge
read-models project the *same* append-only event log. The full `RegionFacts` (with
`facts: DiveFact[]`) is materialized in `projectKnowledge(...).diveFacts`, keyed by
`${repoRoot}::${region}`. But:

- The spawner injects child memories via `this.memory.query(child.title, child.scope)`
  — the **memory** projection, which folds only `memory-written`/`memory-reinforced`
  events and never visits a dive's `knowledge-facts-written`.
- The only engine-facing knowledge retrieval, `this.knowledge.query(repoRoot)`, returns
  `KnowledgeForCoverage`, which strips each dive to existence-only
  `CoverageRegionFact = {repoRoot, region, generatedAtSha}` — enough for the coverage
  gate ("do we have a dive for this region?"), but it drops the facts the builder needs.

So a dive's findings were recoverable in the projection but reachable by no
`knowledge.*` method the spawner held. The handoff was a no-op.

## Decision

Add the missing read seam and wire it into spawn-time injection.

1. **`knowledge.factsForRegions(repoRoot, scope)`** — a new method on the engine's
   knowledge wiring that returns the **full** `RegionFacts[]` for every dived region
   overlapping `scope` (not the existence-only `CoverageRegionFact`). It reads the same
   `projectKnowledge(...).diveFacts` the coverage projection reads, without stripping
   the facts, filtered by repo + scope overlap. Pure additive read — no new event, no
   projection change, no storage change.

2. **Inject a dependency dive's facts at spawn.** In `runRound`, alongside the existing
   `memory.query`, the spawner pulls `factsForRegions(repoRoot, child.scope)` and adapts
   each anchored fact into a `MemoryPointer` — **pointers, not bodies**: the `claim` plus
   its `path:line` anchors, never file contents. These merge into the child's
   `memories`, so a builder starts WITH the comprehension a dependency dive produced.

3. **Freshness gates provenance (verify-on-read, ADR-019).** A dive ran at
   `generatedAtSha`; the builder runs against HEAD. A fact whose dive SHA matches HEAD
   is injected as `trusted` (a fact to rely on); a drifted one as `provisional` (a
   suggestion to weigh). The provenance label is the verify-on-read gate at the
   injection edge — the builder is told how much to trust each fact, never handed a
   stale fact as settled truth.

This makes DESIGN.md's sentence literally true: dive findings flow through the same
`Goal.memories` channel as `memory.query` results, mediated by the spawner, with the
child still never touching a store.

## Alternatives Considered

### (A) Give the build leaf a read-ceiling like the explore-then-emit leaves (ADR-039)

**Rejected — it treats the symptom.** The build leaf read 147 files because it was
*denied the comprehension already produced for it*, not because it lacks a read bound.
A ceiling would force it to stop reading and guess, producing a worse artifact. Build
leaves legitimately read-write-reread (ADR-039 deliberately excludes them from the
explore-then-emit ceiling for exactly this reason); the fix is to give them the
knowledge, not to cap their reading. Once a builder starts with the dive's facts, the
read-loop disappears at the source.

### (B) Have the build leaf call the in-child retrieval tools to fetch dive facts

**Rejected.** The retrieval ToolImpls surface `KnowledgeArtifact`s, not `diveFacts`, and
making a builder *pull* its dependency's findings mid-step re-introduces the round-trips
the spawner-mediated injection exists to avoid (DESIGN.md "read — inject, don't look
up"). The design is emphatic that the spawner injects and the child receives; the child
does not query the store. Injection at spawn honors that; a pull tool would not.

### (C) Unify the memory and knowledge stores

**Rejected as unnecessary.** They are already two projections over one event log; the
split is a read-model concern, not two stores. Unifying them would be a large change to
solve a problem a one-method read seam solves. Keep the two projections; merge only at
the injection edge.

### (D) Inject the full RegionFacts JSON as the memory body

**Rejected.** DESIGN.md's memory contract is pointers, not bodies — "what to recall and
where to look, not the full body." Each `DiveFact` becomes one pointer (claim +
`path:line`), which is exactly a pointer. Dumping the JSON would bloat the builder's
context (the very cost we are reducing) and violate the memory contract.

## Rationale

The dive-as-dependency pattern's entire value is that comprehension is paid once, where
work lands, and reused — "context cost is paid per touched region, never per goal
re-learning the repo" (DESIGN.md). Without the injection, the factory paid for the
comprehension twice (the dive AND the builder re-reading) and the second pass didn't
even converge. The seam closes the loop the design always described. It is also the
correct fix for the build-leaf read-loop: the loop is a *consequence* of the missing
handoff, so fixing the handoff removes the loop without bounding legitimate reading.

## Tradeoffs & Risks

- **A stale dive injected as `provisional` could mislead a builder.** Mitigated: the
  provenance label tells the builder to weigh, not obey, a drifted fact; and the
  builder still has its own tools to verify against HEAD. A `trusted` fact requires a
  SHA match. (A future refinement could run `diveAnchorCheck` semantics against HEAD to
  re-validate a drifted fact before injection, mirroring `knowledge.validate`.)
- **More memory pointers in a builder's context.** Bounded: pointers are claim +
  anchors, an order of magnitude smaller than the file bodies they replace; the net is
  far less context than the re-reading they prevent.
- **`factsForRegions` re-projects the log per spawn.** Acceptable and matches the
  existing `query`/`validate` pattern (both re-project); the spawn path already awaits
  `memory.query`. If it ever costs, the projection can be cached per round.
- **Optional wiring.** When `factsForRegions` is absent (tests that don't exercise it),
  no facts are injected — behavior as before this ADR; no test churn.

## Consequences for the Build

- **`src/engine/engine.ts`**: add `factsForRegions?` to the `knowledge` wiring
  interface; add `diveFactsAsMemories(repoRoot, scope, headSha)` (RegionFacts →
  MemoryPointer[] with freshness-gated provenance); call it in `runRound` and merge
  into each child's `memories`.
- **`src/engine/assembly.ts`**: implement `factsForRegions` in `assembleKnowledgeWiring`
  (read `projectKnowledge(...).diveFacts`, scope-filter, return full RegionFacts) +
  a `regionOverlapsScope` helper.
- **No new event, no projection change, no storage change.** The full facts already
  land in `knowledge-facts-written` and materialize in `projectKnowledge`.
- **Tests**: `assembly.test.ts` (factsForRegions returns full facts for an overlapping
  scope, empty for unrelated); `convergence-eyes.test.ts` (end-to-end: the code leaf
  receives the dive's `RegionFacts` as injected memory).
