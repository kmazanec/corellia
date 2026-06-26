---
type: issue
title: "Comprehension over-splits a modest region into fragile sub-dives; one blocks and cascade-starves the implement leaves"
description: A deep-dive of `tests/` split into 4 sub-dives where 1 would do; one sub-dive blocked on a coverage nit, failing the parent dive, which then hard-blocked the implement leaves that depended on it before they ever ran.
tags: [engine, comprehend, over-split, dependency-cascade, partial-delivery]
timestamp: 2026-06-26
status: fixed
kind: bug
severity: high
---

# Comprehension over-splits a modest region into fragile sub-dives; one blocks and cascade-starves the implement leaves

> **Fixed by [ADR-037](../adrs/ADR-037-degraded-dependency-not-cascade-block.md)
> (the cascade half), pending live re-proof.** The cascade at `engine.ts` now gates
> on the dependency's *artifact*, not on the mere presence of a blocker: a
> dependency that blocked but produced a usable partial (`dive-tests`'s merged
> `RegionFacts`) no longer hard-blocks its dependents — the implement leaves proceed
> on the partial knowledge, and the blocker is carried forward as a finding + a
> `dependency-degraded` event. The **over-split** angle (angle 1 below) is *not*
> fixed here — it is deferred as a separate comprehension-scoping tuning, because
> ADR-037 makes the over-split non-fatal rather than preventing it. Re-prove by
> re-commissioning slice C; if a live run shows the over-split is still wasteful
> (even though no longer fatal), file the scoping tuning then. Covered by
> `tests/engine/engine.test.ts` (the ADR-037 degraded/fatal cascade cases).

## Problem
Two compounding behaviours turn a small comprehension nit into a whole-tree block:

1. **Comprehension over-splits a modest region.** A `deep-dive-region` of `tests/`
   split into FOUR sub-dives (`unit`, `integration`, `fixtures/conftest`,
   `test-data`) where one dive of the small region would have sufficed. More
   sub-dives = more places to fail and more fragile dependency edges.

2. **A single blocked sub-dive hard-blocks every dependent, all-or-nothing.** One
   sub-dive blocked on a coverage nit ("Deep-dive covers only tests/integration, not
   the full tests directory as requested"). That failed the parent `dive-tests`,
   and because the two implement leaves (`impl-steps`, `impl-wire`) depended on
   `dive-tests`, the cascade at `engine.ts:3343-3356` ("if any dependency failed or
   blocked, this child is blocked too") blocked them **before they executed a single
   step** — only `emitted` block events, zero step runs. The actual implementation
   work never even started.

The result: a run that was otherwise healthy (ADR-036 held — the dive that ran
stayed bounded at 74K tokens and converged) produced 0 writes purely because a
comprehension coverage nit on a sibling cascade-starved the builders.

## Evidence
Build run #9 (`live-self-76943fcd`, $0.48), slice C (the ADR-034 engine integration
steps). Root split into `dive-src-engine` (✓ ran, bounded, emitted), `dive-tests`
(split into 4 sub-dives, one blocked), `impl-steps` + `impl-wire` (implement leaves,
`emitted` block events only — never ran). Blockers: *"Deep-dive covers only
tests/integration, not the full tests directory as requested"* → *"Blocked because a
dependency failed: …"* (×N) → *"judge-acceptance did not pass: No implementation
files were produced."* The cascade code: `src/engine/engine.ts:3343-3356`. The
over-split is a comprehension decomposition choice at decide time. Related:
[partial-delivery-on-blocked-dependency](partial-delivery-on-blocked-dependency.md)
(the all-or-nothing half) and the comprehension-scoping work (ADR-029).

## Proposed direction
(Rough, not committed — two angles, the first is the surgical root-cause fix.)

1. **Don't over-split a modest region.** Bound when a `deep-dive-region` sub-splits:
   a small region (few files / under the wall-clock split signal) should be ONE
   dive, not four. Reuse the size signal from
   [comprehension-region-wallclock-exhaustion](comprehension-region-wallclock-exhaustion.md)
   (`repoShapeHint` / `treeChangedWithinScope`-style region sizing) to suppress a
   split the region doesn't warrant. Fewer dives → fewer fragile edges.

2. **Degraded delivery on a blocked dependency** (the bigger, riskier change, shared
   with the partial-delivery issue): a dependent whose dependency BLOCKED should not
   always be hard-blocked — distinguish "the dependency produced usable partial
   knowledge" from "it produced nothing," and/or let the root collect the green
   subtree and report the blocked parts instead of an all-or-nothing root block. The
   dependency-blocking semantics are partially CORRECT (a builder that truly needs a
   failed comprehension should not run blind), so this needs care, not a blanket
   removal of the cascade.

A comprehension coverage nit ("you mapped only part of the directory") should also
arguably be a non-gating finding for a dependency relationship, not a hard block —
partial knowledge is still knowledge.

## Acceptance hint
A deliver-intent whose plan includes comprehension over a small region does not
over-split it into many fragile sub-dives; and a single blocked/partial comprehension
sub-dive does not cascade-block the implement leaves before they run — either the
over-split is prevented, or the builders proceed on the usable partial knowledge (or
the green subtree is collected and the blocked part reported). Slice C (the ADR-034
engine integration steps) reaches its implement leaves and they execute.
