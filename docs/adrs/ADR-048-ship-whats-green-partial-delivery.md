---
type: adr
title: "ADR-048: a mixed green/blocked tree ships its green subtree instead of an all-or-nothing block"
description: When some children succeed and others genuinely block producing nothing, the root today preserves the whole worktree as an all-or-nothing block — the operator hand-fishes the good modules out. Add a ship-what's-green partial-delivery election at root collection: when real green work was delivered AND the only blockers are child-module blocks (the root's own acceptance/integration judges passed), collect the green subtree, emit a partial-delivered event, and fold the blocked-module enumeration into the collect commit body. A root-level acceptance failure still gates; an all-blocked tree preserves exactly as before. Completes the downstream half of partial-delivery-on-blocked-dependency that ADR-037 left open.
tags: [adr, engine, partial-delivery, collect, ship-whats-green, completes-adr-037]
timestamp: 2026-07-06T19:30:00-05:00
---

# ADR-048: a mixed green/blocked tree ships its green subtree instead of an all-or-nothing block

**Status:** Accepted · **Date:** 2026-07-06 · **Stretch:** no · **Contract:** yes
**Completes:** ADR-037 (the downstream half it left open) · **Relates to:** ADR-016
(worktree collect/preserve), ADR-026 (preserve blocked work as salvage), the
hollow-emit gate (gate on the real worktree diff, not a proxy)

## Context

[ADR-037](ADR-037-degraded-dependency-not-cascade-block.md) fixed the **upstream**
half of
[partial-delivery-on-blocked-dependency](../issues/partial-delivery-on-blocked-dependency.md):
a dependency that blocked but produced a usable partial no longer cascade-blocks
its dependents. It explicitly deferred the **downstream** half (its Alternative C):
when children *genuinely* block producing nothing, the root still has no
"collect the green subtree and open a PR for it" mode.

Concretely, the all-or-nothing gate is in `finalizeSandboxedRun`
(`src/engine/sandbox-finalization.ts`): `report.blockers.length > 0` →
`preserveTree`, full stop. Because `buildSplitRoundReport` aggregates *every*
child's blockers into the root report, a single blocked-with-nothing module makes
the root report carry a blocker, and the whole worktree is preserved — even when
three of five modules are perfect and their files are sitting in the worktree.
The tiutni Run-1 evidence is exactly this: filler failed, root blocked, and the
operator hand-fished the good modules out of the preserved worktree.

The recovery primitive already exists — `preserveTree` keeps the branch and its
round commits — so nothing is *lost*. What is missing is *electing to collect the
verified portion* rather than treating any blocked child as all-or-nothing.

## Decision

At root collection, when a blocked tree also carries **real green work**, elect a
**ship-what's-green partial delivery**: collect the green subtree (the PR path
proceeds — the branch carries the committed green work) and surface the blocked
remainder, rather than preserve the whole tree.

The election is a conservative, honest gate (`decidePartialDeliveryFor` in
`src/engine/partial-delivery.ts`). It ships the green subtree **only when all**
hold:

1. **At least one child blocked** — there is a partial to reason about. The split
   report now carries a structured `partialDelivery` enumeration
   (`{ blockedModules: {goalId, title, blocker}[], childBlockers }`), built at
   `buildSplitRoundReport` where the per-child outcomes are in view.
2. **Real green work was delivered** — the worktree diff within scope has a
   non-zero changed count. Gate on the actual diff, not a proxy (the same
   discipline as the hollow-emit gate). An all-blocked tree has no green diff and
   preserves exactly as before.
3. **No root-level acceptance/integration failure** — every blocker in the report
   is one of the child-module blockers (`childBlockers`). If the root's own
   integration or acceptance judge rejected the *delivered* artifact, that is a
   real failure of the green work itself; it still gates and the tree preserves.
   Honesty over completion — a partial that fails acceptance is never shipped.
4. **The delivered diff stayed in scope** — an out-of-scope partial is preserved
   for inspection, not shipped.

When it fires, `finalizeSandboxedRun` collects the worktree, emits a
`partial-delivered` event enumerating the blocked modules, and folds a
"Partial delivery — N module(s) blocked …" block into the collect commit body so
the partiality is unmissable to whoever merges the green work. The report's
`blockers` stream stays fully populated: the run still reports as a completed run
with blockers, so the existing mint-on-complete path spawns follow-up improvement
work for the blocked modules. No silent partiality.

## Alternatives Considered

### (A) Separate the child-origin blockers from root blockers by string matching

**Rejected.** The root report's blockers are a heterogeneous mix — integration
eval, unmet acceptance, comprehend-merge, and raw child blockers — with
prefix-based text that is brittle to pattern-match. Instead the split report
records the exact child-origin blocker strings structurally (`childBlockers`), so
the collect decision computes the residual (root-origin) set by set difference,
not by parsing prose. Structured data at the boundary that owns it, not a fragile
downstream regex.

### (B) Elect the partial at the report-build layer (split-report / milestone loop)

**Rejected as the decision site; accepted as the enumeration site.** The
enumeration of blocked modules belongs where the per-child outcomes live
(`buildSplitRoundReport`), and that is where it is computed. But the *election* to
ship needs the worktree diff (was real green work delivered? did it stay in
scope?), which is only authoritative at collection — the same place the clean
collect/preserve decision already lives. Splitting responsibilities this way keeps
the milestone loop unaware of collection mechanics and keeps the honesty gate next
to the git read it depends on.

### (C) Auto-open the PR from the engine on a partial delivery

**Rejected.** `push_branch`/`open_pr` are model-driven boundary tools (ADR-025),
grant-gated and idempotent; the engine does not originate pushes. Collecting the
green work onto the branch and surfacing the blocked list is the deterministic
deliverable — the branch is ready for the operator (or the model's own PR path) to
merge. Manufacturing a PR from the finalizer would bypass the constitution's
no-self-merge / PR-only boundary.

### (D) Clear the blockers on a partial so the run reports "success"

**Rejected outright.** That is silent partiality — the exact failure the issue
calls out. The blockers stay populated; the delivery is honestly a *partial*, and
the blocked modules both appear in the report and spawn follow-up work.

## Rationale

The gate is the same shift as the hollow-emit gate and ADR-037: **decide on the
actual artifact/diff, not on a correlate.** "The tree had a blocker" is the wrong
proxy for "the tree delivered nothing" whenever the tree delivered most of its
modules and one blocked. Looking at the real worktree diff (green work exists?)
and the residual blocker set (did the delivered work itself fail a root judge?) is
the precise test. It trades an all-or-nothing block for "ship the verified 80%,
enumerate the 20%, and let the operator merge the good part" — while keeping every
existing gate authoritative over what actually shipped.

## Tradeoffs & Risks

- **A shipped green subtree could be incomplete in a way the root judges did not
  catch.** Mitigated: the root's integration and acceptance judges run against the
  delivered artifact and still gate (constraint 3); the partial only ships work
  that passed them. The blocked modules are enumerated and spawn follow-up.
- **The operator must read the PR body / report to see the partiality.** Mitigated:
  the collect commit body carries the blocked-module block, a `partial-delivered`
  event records it, and `report.blockers` stays populated — three surfaces, none
  silent.
- **One more event type** (`partial-delivered`). Acceptable — it is the audit trail
  for the ship-what's-green election, mirroring `dependency-degraded` (ADR-037) and
  `context-evicted` (ADR-036).

## Consequences for the Build

- **`src/contract/report.ts`**: add `Report.partialDelivery?: PartialDelivery`
  (`{ blockedModules: BlockedModule[]; childBlockers: string[] }`).
- **`src/engine/split-report.ts`**: `buildSplitRoundReport` takes the child goals
  and populates `partialDelivery` when any child blocked.
- **`src/engine/partial-delivery.ts`** (new): `decidePartialDelivery` (git-backed)
  and its pure predicate `decidePartialDeliveryFor`, plus `renderBlockedModules`.
- **`src/engine/sandbox-finalization.ts`**: on a blocked report, consult the
  decision; ship-green → collect + `partial-delivered` event + blocked-module
  commit body; otherwise preserve exactly as before.
- **`src/contract/events.ts`** / **`event-parser.ts`** / **`eventlog/projections.ts`**
  / **`eventlog/render.ts`**: add the `partial-delivered` event.
- **No new goal type, no CommissionInput change, no skill change.** Engine +
  contract work. Closes the downstream half of
  [partial-delivery-on-blocked-dependency](../issues/partial-delivery-on-blocked-dependency.md).
