---
type: adr
title: "ADR-046: wall-clock is one tree-wide deadline, never a per-goal slice"
description: ADR-030 subdivided wallClockMs among a split's children, so a wide fan-out rationed each child down to ~90s and killed productive leaves mid-work — budget steering the build, which ADR-033 forbids. Stop subdividing wall-clock. Fix one deadline at the tree root (now + rootBudget.wallClockMs) on the shared TreeState, and have every goal check that same deadline. Per-goal starvation becomes impossible by construction; a runaway is still bounded by the root deadline and the dollar ceiling.
tags: [adr, engine, budget, wall-clock, tree-deadline, non-steering, amends-adr-030, firms-adr-033]
timestamp: 2026-07-06T18:00:00-05:00
---

# ADR-046: wall-clock is one tree-wide deadline, never a per-goal slice

**Status:** Accepted · **Date:** 2026-07-06 · **Stretch:** no · **Contract:** no
**Amends:** ADR-030 (which subdivided `wallClockMs`) · **Firms:** ADR-033 (budget
is a non-steering safeguard) · **Relates to:** ADR-017 (per-tree dollar ceiling),
ADR-029 (comprehension recursion)

## Context

ADR-030 made every count dimension inherit rather than divide, but kept
`wallClockMs` subdividing proportionally — "a real external-time bound that should
ladder down." ADR-033 then firmed the principle the whole budget must obey:
**budget is a runaway backstop, never a steer on what or how a goal builds; the
only hard bounds are the per-tree dollar ceiling and wall-clock.**

Subdividing wall-clock violates that principle. When a deliver-intent root fans
out wide, each child's proportional slice collapses, and a productive goal is
killed not because the work was unbounded but because it had many siblings. That
is budget steering the build — "the factory built it differently because the
split was wider" — exactly what ADR-033 says must never be true.

The issue `comprehension-region-wallclock-exhaustion` records three consecutive
live runs where subdivided wall-clock killed *productive* goals:

> "With the build scope narrowed and the size-split fix in place, the root split
> into ~13 children, so ADR-030's wall-clock subdivision gave each
> `deep-dive-region` only **~94.7s** — and 5 of 12 dives still timed out,
> INCLUDING `src/contract` at just **14 files**. … The real gap: a thorough
> deep-dive needs more wall-clock than it gets once the root fans out wide —
> per-dive starvation, not region size."

> "(2026-07-01, third run, 40-min budget) … the `implement` goal — mid-build,
> with a committed round-0 implementation on the branch — exhausted its
> subdivided slice … and was denied; the close-out goal cascade-blocked. Three
> runs, three wall-clock kills of *productive* goals: the per-goal starvation fix
> … is now the single biggest blocker to a commission shipping end-to-end."

A first, narrow attempt (commit `b6434a8`) added a wall-clock FLOOR for
comprehension dives only. It helped that one family but did not generalize: the
2026-07-01 runs show starvation moved to `implement` and `research-external`
goals the floor never covered. A floor is a patch that invites an endless game of
"which goal type needs the carve-out next." The real defect is that wall-clock is
subdivided at all.

## Decision

**Stop subdividing wall-clock. There is one wall-clock deadline for the whole
tree, fixed once at the root, and every goal checks that same deadline.**

1. **The tree deadline lives on `TreeState`.** `TreeState` was already the
   tree-scoped accumulator for the dollar ceiling — created once at the root
   `run()` call and passed by reference through every recursive child so the whole
   tree shares one spend counter (ADR-017). It now also carries `deadline`, an
   absolute timestamp fixed at the root as `now() + rootBudget.wallClockMs`. The
   dollar ceiling and the wall-clock deadline are the two real-cost backstops, and
   they now sit together, both tree-scoped, both never subdivided.

2. **`subdivide` inherits `wallClockMs`, like every other dimension.** No child
   gets a rationed slice; each inherits the parent's full allowance as a reported
   number only. Wall-clock is no longer enforced per-goal from `Goal.budget`.

3. **The single enforcement point is the tree deadline.** The attempt loop — the
   one place a goal blocks on wall-clock — checks
   `hasReachedTreeDeadline(treeState, now())`. A goal is killed only when the
   *whole tree's* deadline passes, never because its siblings were many. The
   `budget-exhausted { dimension: 'wallClockMs' }` event and the block still fire
   exactly as before when the tree genuinely runs out of time.

4. **The comprehension wall-clock floor is removed.** With no per-goal slice there
   is nothing to floor; `COMPREHENSION_WALLCLOCK_FLOOR_MS` and `floorWallClock`
   are deleted and the comprehension carve-out in `split-children.ts` is gone.

5. **The count dimensions and the dollar ceiling are untouched.** ADR-030's
   attempts/tokens/toolCalls inheritance stands; the ADR-017 dollar ceiling
   remains the real spend bound under parallelism.

## Rationale

A backstop earns its place by stopping the unbounded case without touching the
bounded one. A tree deadline does exactly that: a real runaway (infinite re-split,
a stalled provider) cannot run past the root's time grant, and no normal goal is
ever killed for being one of many. Per-goal starvation becomes impossible *by
construction* — there is no per-goal wall-clock left to starve.

Subdivision never actually bounded real spend anyway. Under parallelism the
children's wall-clocks overlap, so dividing the number by share bounded nothing
that overlapping wall-time didn't already bound; the thing that truly bounds spend
is the dollar ceiling (ADR-017), which is unaffected here. Subdivision's only real
effect was the starvation — a cost with no corresponding benefit.

## Alternatives considered

- **Keep subdivision, add a wall-clock FLOOR (`max(subdivided, FLOOR)`), default
  ~5 min, env-configurable.** This is the design the first attempt started down
  (`b6434a8`, comprehension-only). Rejected: a floor keeps the subdivided
  mechanism — the very thing that steers — and merely raises the death threshold.
  It requires choosing which goal types deserve the floor (comprehension did; the
  2026-07-01 runs proved `implement` and `research-external` need it too), so the
  carve-out list grows without end. The tree deadline needs no carve-outs and no
  tunable: it is one number, the root's, and it steers nothing.

- **Progress-aware extension: let a goal making progress extend its slice.**
  Deferred, not rejected. It is strictly more complex (it needs a trustworthy
  progress signal and an extension policy) and, once wall-clock is a single tree
  deadline, it is no longer needed to stop starvation — the tree deadline already
  does. Revisit only if a *tree-level* deadline proves too coarse in a real run
  (e.g. one branch legitimately wants far more time than the root granted), which
  no evidence yet shows.

## Consequences

- **Engine:** `tree-spend.ts` gains `TreeState.deadline` and
  `hasReachedTreeDeadline`; `createTreeState` takes an optional deadline
  (defaulting to `+Infinity` so a treeState without one never expires).
  `root-runner.ts` sets the deadline from the root goal's budget.
  `budget.ts` `subdivide` inherits `wallClockMs`; `floorWallClock` and
  `COMPREHENSION_WALLCLOCK_FLOOR_MS` are removed. `split-children.ts` drops the
  comprehension floor. `goal-entry.ts` no longer computes or returns a per-goal
  `deadline`; `attempt/loop.ts` checks the tree deadline via `treeState`.
- **Tests:** `budget.test.ts` asserts wall-clock inheritance (and drops the
  `floorWallClock` block); `split-children.test.ts` asserts full-wall-clock
  inheritance for every child; `goal-entry.test.ts` drops the per-goal deadline
  assertion; `tree-spend.test.ts` covers the tree deadline; `engine.test.ts` gains
  a wide-fan-out non-starvation test and a tree-deadline-still-fires test.
- **Cascade half still open.** This fixes the *starvation* half of the issue. The
  dependency-cascade half — a single blocked dependency hard-blocking every
  dependent — is tracked separately (`partial-delivery-on-blocked-dependency`) and
  is out of scope here. Making killed goals rarer should make the cascade fire
  less often, but the degraded-dependency path itself is unchanged.
- **Live proof pending.** The acceptance is observable: a productive leaf in a
  wide fan-out is no longer killed after ~95s while the tree is within its
  deadline. Unit tests prove the mechanism; a live `live:self` run over a wide
  comprehension fan-out is the confirming proof.

## Amendment (2026-07-07) — the deadline must be checked inside the leaf, not only between attempts

The first live proof (daemon commission `proof-word-count`, 15-minute grant)
exposed an enforcement hole: the tree deadline was checked only at attempt-loop
entry, so a leaf grinding through slow provider calls *inside one attempt*
(4–12-minute stalls on the criteria leaf) ran ~90 minutes past the tree's
expiry — and the milestone loop then started fresh rounds whose children all
instantly blocked on entry. The backstop did not stop the runaway; it only
priced it.

Two enforcement points added, same honest block as the entry check:

- **Step boundary:** `runStepLoop` takes `hasReachedTreeDeadline` and returns a
  `deadline` result before each step once the tree deadline has passed; the
  attempt loop maps it to the existing wallClockMs-exhaustion block. A single
  in-flight provider request stays bounded by the per-request timeout; the loop
  can no longer start another step after expiry.
- **Round boundary:** the milestone loop consults the deadline beside the
  ceiling check and halts with outcome `halt-deadline` instead of spawning a
  round of instantly-dead children.
