---
type: adr
title: "ADR-037: a blocked dependency that produced a usable partial does not cascade-block its dependents"
description: The dependency cascade hard-blocked every dependent whenever a dependency had any blocker, even when that dependency produced a usable partial artifact; distinguish "produced nothing" (still a hard block) from "blocked but produced usable partial knowledge" (the dependent proceeds, the blocker is carried forward as a finding).
tags: [adr, engine, dependency-cascade, partial-delivery, comprehend, degraded-delivery]
timestamp: 2026-06-25T22:00:00-05:00
---

# ADR-037: a blocked dependency that produced a usable partial does not cascade-block its dependents

**Status:** Accepted · **Date:** 2026-06-25 · **Stretch:** no · **Contract:** yes
**Supersedes:** none · **Superseded by:** none

## Context

When a split's children carry `dependsOn` edges, the engine runs each child only
after its dependencies' reports are available, then applies a cascade
(`src/engine/engine.ts`, the `childPromise` body): **if any dependency had a
blocker, the dependent was hard-blocked before it executed a single step** —

```ts
const failedDep = depReports.find((r) => r.blockers.length > 0);
if (failedDep) return blockedReport(`Blocked because a dependency failed: …`);
```

This is binary: *any* `blockers.length > 0` on a dependency → the dependent emits a
block event and never runs. It does not look at whether the dependency actually
**produced anything usable**.

Build run #9 (`live-self-76943fcd`, slice C — the ADR-034 engine integration steps)
showed why that is wrong. The root split into `dive-src-engine` (✓ ran, bounded by
ADR-036, emitted a converged artifact), `dive-tests`, and two implement leaves
(`impl-steps`, `impl-wire`) that depended on the dives. `dive-tests` itself
over-split into four sub-dives; one sub-dive **blocked on a coverage nit** ("Deep-dive
covers only tests/integration, not the full tests directory as requested"). But the
sub-dives that *did* run merged into a **valid `RegionFacts` artifact** — `dive-tests`
emitted a report with `artifact: non-null, blockers: [coverage nit]`. The cascade saw
`blockers.length > 0` and hard-blocked `impl-steps` and `impl-wire` **before they ran
a single step** (0 step runs, `write_file: 0`). A run that was otherwise healthy
produced **zero writes** purely because a comprehension coverage nit on a sibling
cascade-starved the builders — even though usable partial knowledge of `tests/`
existed the whole time. (See
[comprehension-oversplit-cascade](../issues/comprehension-oversplit-cascade.md) and
[partial-delivery-on-blocked-dependency](../issues/partial-delivery-on-blocked-dependency.md).)

The original tiutni Run-1 evidence is the same class: a blocked dependency took down
its dependents and the root even though most of the tree was green, with no
"ship-what's-green" path. The cascade is *correct in spirit* — a builder that truly
needs a comprehension/result that never materialised must not run blind — but it is
**too coarse**: it conflates "the dependency produced nothing" with "the dependency
blocked but produced usable partial knowledge."

## Decision

The dependency cascade **distinguishes a fatal dependency from a degraded one** by
whether the dependency produced a usable artifact:

1. **Fatal dependency — blocked AND `artifact === null`.** The dependency produced
   nothing usable. The dependent is **hard-blocked**, exactly as before. A builder
   that needs knowledge/results that never materialised must not run blind.

2. **Degraded dependency — blocked BUT `artifact !== null`.** The dependency
   produced usable partial knowledge (a partial comprehension, a green subtree). The
   dependent **proceeds** on that partial. The dependency's blocker is **carried
   forward as a finding** on the dependent (so it surfaces honestly at the root and
   is never silently dropped), and a `dependency-degraded` event is emitted so the
   proceed-on-partial decision is observable in the event log (ADR-003).

Concretely (`src/engine/engine.ts`, the `childPromise` body): the cascade now
hard-blocks only on `r.blockers.length > 0 && r.artifact === null`; for each
dependency with `blockers.length > 0 && artifact !== null` it appends a
`dependency-degraded` event and threads the blocker into the dependent's `findings`,
then runs the dependent normally.

The blockers still aggregate up: the parent split's report collects every child's
blockers (`allBlockers`), so `dive-tests`'s coverage nit remains visible at the root
as an honest finding — the tree reports *both* the work it shipped *and* what was
partial. Degraded delivery, not silent success.

## Alternatives Considered

### (A) Fix the over-split instead — bound how a modest region sub-splits

**Rejected as the primary fix; deferred as a complementary tuning.** The proximate
trigger in run #9 was that `dive-tests` over-split a small region (`tests/`) into
four fragile sub-dives where one would have sufficed — more sub-dives means more
places to block and more fragile dependency edges. Bounding that (reuse the region
size signal from
[comprehension-region-wallclock-exhaustion](../issues/comprehension-region-wallclock-exhaustion.md))
would reduce the *frequency* of this cascade. But:

- It is a **brain decide-time discipline**, not a deterministic guarantee. The
  comprehend skill (`comprehend.md`) *already* says "DEFAULT TO SATISFY … splitting a
  region that fits is the most common failure," and the brain over-split anyway.
  Tightening prose or adding a heuristic size gate reduces the odds but cannot
  *guarantee* the cascade won't bite — a region that genuinely warrants a split can
  still have one sub-dive block.
- It treats the symptom (too many edges) not the cause (a single partial-but-usable
  dependency is fatal under an all-or-nothing rule). Even with zero over-splitting, a
  legitimately-split dependency whose one sub-part blocks would still cascade-starve
  the builders.

So the cascade fix is the **robust root-cause fix** (deterministic, in the engine,
independent of model behavior — the same "never let robustness depend on the model
behaving" principle as ADR-036 and the hollow-emit gate). Bounding the over-split
remains worth doing as a separate, cheaper tuning that reduces how often the
situation arises; it is left to the comprehension-scoping work, not this ADR.

### (B) Remove the cascade entirely — always run dependents

**Rejected.** A builder that depends on a comprehension which produced **nothing**
(no artifact) genuinely cannot proceed — it would run blind, read the wrong things,
and emit garbage or a hollow artifact. The dependency-blocking semantics are
partially correct; the fix is to make them *precise*, not to delete them. The
`artifact === null` branch preserves the correct hard block.

### (C) Let the root collect the green subtree and open a PR for it (ship-what's-green at the root)

**Partially accepted as a future complement, not this ADR.** The
[partial-delivery-on-blocked-dependency](../issues/partial-delivery-on-blocked-dependency.md)
issue's broader ask is that a tree with mixed green/blocked children *collect the
green subtree and open a PR for it* rather than all-or-nothing at the root. That is a
real, larger change to the collect/integrate path (electing to ship a verified
portion). This ADR addresses the **upstream half** — stop *manufacturing* blocked
dependents in the first place when usable partial knowledge exists — which is what
actually killed run #9's builders before they ran. The root-level collect-the-green
behavior is downstream of this and can land separately; this ADR makes the common
case (a partial comprehension dependency) no longer fatal.

### (D) Treat a comprehension coverage nit as a non-gating finding at the source

**Rejected as the mechanism, accepted in spirit.** One could special-case the
comprehend merge so a "you mapped only part of the directory" finding never becomes a
*blocker* at all (only a finding), so `dive-tests` would report `blockers: []` and the
cascade question never arises. But that pushes a partial-vs-complete policy decision
into the comprehend gate and risks hiding genuinely-insufficient comprehensions. The
cascade fix is more general: it lets the comprehend gate stay honest about partial
coverage (it *did* block) while still letting dependents use the partial artifact.
"Partial knowledge is still knowledge" is honored at the **consumption** edge (the
cascade), where the dependent and its artifact are both in view, rather than by
softening the producer's gate.

## Rationale

Dependency edges encode "B needs what A produced." The cascade enforced that with a
proxy — "A had a blocker" — that is wrong whenever A blocked *but still produced what
B needs*. Looking at the **artifact**, the thing the dependency actually hands
downstream, is the precise test: present → the dependent has its input → run it;
absent → the dependent is blind → block it. This is the same shift as the hollow-emit
gate (which checks the real worktree diff, not a proxy for "did work happen"):
**gate on the actual artifact, not on a correlate.**

It is also the minimal change that unblocks the factory's own hardest slice: slice C
is unbuildable today not because the builders can't do the work, but because a
sibling comprehension's coverage nit cascade-starves them before they start. Making a
degraded dependency non-fatal is the unlock, and it generalizes to every mixed
green/partial tree.

## Tradeoffs & Risks

- **A dependent may proceed on partial knowledge that was insufficient.** It runs
  with a partial comprehension and could build the wrong thing. Mitigated: the
  dependent still has its own deterministic gates, judge, and the hollow-emit gate;
  the degraded-dependency finding is carried forward so a downstream judge/operator
  sees the work rested on a partial; and the alternative (hard-block, build nothing)
  is strictly worse than "build on a partial and let the gates catch a bad build."
- **The blocker becomes a finding, not a gate** — a partial that *should* have
  stopped the build no longer does. Acceptable: the `artifact === null` branch still
  hard-blocks the genuinely-empty case, and a non-empty-but-wrong artifact is exactly
  what the dependent's own eval exists to catch. We trade a guaranteed-zero-output
  failure for a build-and-verify path.
- **More events** (`dependency-degraded`). Acceptable — it is the audit trail for the
  proceed-on-partial decision, mirroring `context-evicted` (ADR-036): the signal that
  surfaces a tree running on partial knowledge.
- **Does not by itself reduce over-splitting.** A separate concern (alternative A);
  this ADR makes over-splitting non-fatal, which removes the urgency but not the
  waste. The comprehension-scoping tuning still has value.

## Consequences for the Build

- **`src/engine/engine.ts`** (the `childPromise` dependency-cascade body): hard-block
  only when a dependency `blockers.length > 0 && artifact === null`; for a degraded
  dependency (`blockers.length > 0 && artifact !== null`) emit a `dependency-degraded`
  event and append a "proceeded on a degraded dependency" line to the dependent's
  `findings`, then run the dependent normally.
- **`src/contract/events.ts`**: add the `dependency-degraded` event
  (`{ goalId, dependency, blocker }`).
- **No new goal type, no CommissionInput change, no skill change.** This is engine +
  contract work, landable as factory-repo work. Closes the upstream half of
  [partial-delivery-on-blocked-dependency](../issues/partial-delivery-on-blocked-dependency.md)
  and [comprehension-oversplit-cascade](../issues/comprehension-oversplit-cascade.md);
  unblocks slice C (the ADR-034 engine integration steps).
