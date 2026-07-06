---
type: issue
title: "a large docs/ region exhausts a deep-dive-region's wall-clock and cascades to block every dependent"
description: A deep-dive of a now-large docs/ tree ran out its per-goal wallClockMs (~112s) instead of splitting; that one comprehension dependency failing then cascade-blocked all six build slices, so nothing was built.
tags: [engine, comprehend, wall-clock, recursion, partial-delivery, deliver-intent]
timestamp: 2026-06-25
status: partially-fixed
kind: bug
severity: high
---

# a large docs/ region exhausts a deep-dive-region's wall-clock and cascades to block every dependent

> **Partially fixed (2026-06-25, commit 22a411e).** The split-signal half is done:
> `repoShapeHint` now fires for `deep-dive-region` and measures a SCOPED region's
> actual size, emitting a "SPLIT into sub-region children" hint when large.
>
> **But run #4 (`live-self-63daa9cf`, $3.21) reframed the root cause — size was
> NOT the real problem.** With the build scope narrowed and the size-split fix in
> place, the root split into ~13 children, so ADR-030's wall-clock subdivision gave
> each `deep-dive-region` only **~94.7s** — and 5 of 12 dives still timed out,
> INCLUDING `src/contract` at just **14 files** (below the size-split threshold, so
> no hint even fired). The milestone loop ran 3 rounds trying to recover; the
> timeouts recurred each round. **The real gap: a thorough deep-dive needs more
> wall-clock than it gets once the root fans out wide — per-dive starvation, not
> region size.** Candidate fixes (NOT built): give comprehension dives a wall-clock
> FLOOR that does not subdivide below a workable minimum (a comprehension carve-out
> like the ADR-030 attempts/tokens inheritance); or make the root's comprehension
> fan-out narrower (fewer, coarser dives); or let a dive that is making progress
> extend its slice. **Still open too:** the dependency-cascade half — one blocked
> dive hard-blocks every dependent with no degraded path (shared with
> [partial-delivery-on-blocked-dependency](partial-delivery-on-blocked-dependency.md)).
>
> **Update (2026-06-26, run `live-self-14794116`).** The size-split signal was
> file-count-only and under-measured a few-but-huge region: `dive-tests-engine`
> (`tests/engine`, **33 files but ~642KB / ~17K lines**) fell *below* the 40-file
> bar, so no SPLIT hint fired — it `satisfy`-ied as one dive, ballooned working
> memory, evicted repeatedly, and `step-loop:failed` → cascade-blocked every build
> leaf (no code was written; $2.02). Fixed: `countRegion` now also sums bytes
> (cheap `statSync`, no content read) and `repoShapeHint` fires on EITHER bar —
> `files >= 40` OR `bytes >= ~450KB`. The byte bound sits above `src/engine`
> (332KB, which deep-dives in one node fine and now passes by repairing its anchors)
> and below `tests/engine`. **Still open:** the per-dive wall-clock starvation above,
> and the cascade half (a step-loop-failed dive still hard-blocks its dependents).

> **Update (2026-07-01, commission run `observability-live-tail`).** Fresh
> occurrence, now on the `characterize` family: the first comprehension child
> (`c1`, "Map existing event-log reading, readable view generation, and CLI
> command structure") exhausted its subdivided wallClockMs and was auto-denied;
> serial dependents `c2`–`c7` all cascade-blocked ("dependency failed without
> producing any usable artifact"), killing the entire comprehension phase. The
> replanned `impl-live-view` goal then also ran out its slice mid-implementation.
> The commission's own 15-min `wallClockMs` was authored for a "focused slice"
> and was plainly too small once subdivided — but the starvation + cascade
> mechanics are the same as documented below. Events under
> `out/commission-observability-live-tail/`.
>
> **Update (2026-07-01, third run, 40-min budget).** Recurred at 40 min: a
> `research-external` dive starved, and the `implement` goal — mid-build, with
> a committed round-0 implementation on the branch — exhausted its subdivided
> slice (tokens twice, then wall-clock) and was denied; the close-out goal
> cascade-blocked. Three runs, three wall-clock kills of *productive* goals:
> the per-goal starvation fix (a floor, or progress-aware extension) is now the
> single biggest blocker to a commission shipping end-to-end.
>
> **Starvation half FIXED (2026-07-06, ADR-046, branch `feat/wallclock-floor`;
> pending live proof).** The fix is the tree-deadline model, not a floor.
> `wallClockMs` no longer subdivides among a split's children — every goal
> inherits the parent's full allowance, and wall-clock is enforced ONCE, tree-wide,
> against a single deadline fixed at the root (`now() + rootBudget.wallClockMs`,
> stored on the shared `TreeState` next to the dollar ceiling). The attempt loop
> checks `hasReachedTreeDeadline(treeState, now())` instead of a per-goal deadline,
> so a goal is killed only when the whole tree runs out of time — per-goal
> starvation is impossible by construction, and no fan-out width can starve a
> leaf. This is maximally aligned with ADR-033 (wall-clock is a runaway backstop,
> never a per-goal steer); a runaway is still bounded by the root deadline and the
> ADR-017 dollar ceiling. The earlier comprehension-only floor (`b6434a8`) and its
> `COMPREHENSION_WALLCLOCK_FLOOR_MS` / `floorWallClock` are removed — the floor
> only ever covered comprehension dives, and the 2026-07-01 runs showed the
> starvation had moved to `implement` and `research-external` goals it never
> touched. Unit-proven (wide 13-way fan-out starves no leaf; the tree deadline
> still fires when the tree genuinely runs out); a `live:self` run over a wide
> comprehension fan-out is the confirming proof.
>
> **Still open: the cascade half.** A single blocked dependency still hard-blocks
> every dependent with no degraded path (shared with
> [partial-delivery-on-blocked-dependency](partial-delivery-on-blocked-dependency.md)).
> ADR-046 does not touch it. Making killed goals rarer should make the cascade
> fire less often, but the degraded-dependency mechanism itself is unchanged.

## Problem
Two compounding failures, both real:

1. **A `deep-dive-region` over a large region exhausts its wall-clock instead of
   splitting.** Build run #3 (`live-self-4b84f2d2`) split cleanly into 6
   comprehension dives + 6 build slices. Five dives emitted fine; the `docs/` dive
   (`dive-docs`) **exhausted its `wallClockMs` budget (112,500ms ≈ 1.9 min)** and
   blocked. `docs/` is now large — the 2026-06-25 OKF reorg added 33 ADRs, 13
   iteration dirs, ~22 issues, the log + indexes — so mapping it faithfully no
   longer fits one wall-clock slice. Per ADR-029, a region too large to comprehend
   in one node should **split** (recurse), not run out the clock. Wall-clock is the
   one budget dimension that genuinely subdivides (ADR-030), but here it bounded a
   single dive that should have decomposed first.

2. **One failed comprehension dependency cascade-blocked every dependent with no
   degraded path.** All six build slices (`s1`–`s6`) depended on the dives; when
   `dive-docs` blocked, each slice blocked with "Blocked because a dependency
   failed" — they never ran a single tool. The root then failed `judge-acceptance`
   ("Artifact is a knowledge-region summary, not a build deliverable — none of the
   five ADR-specified mechanisms are implemented"). This is the partial-delivery
   gap ([partial-delivery-on-blocked-dependency](partial-delivery-on-blocked-dependency.md))
   seen from the comprehension side: a single timed-out dependency takes the whole
   tree down.

## Evidence
Run `live-self-4b84f2d2` (2026-06-25, $1.05, 985K tokens). Event trace: 5 dives
`emitted`; `dive-docs` → `deterministic-checked → blocked` (wallClockMs exhausted);
`s1`–`s6` each have only a dependency-failed `blocked`; root `judge-acceptance`
failed. dive-docs budget at goal-received: `wallClockMs: 112500`. The decompose +
split worked perfectly (the satisfy-prevention + guard fixes held); the failure is
downstream, in comprehension sizing + the cascade.

## Proposed direction
(Rough, not committed.)
- **Make a too-large region split before it times out.** The decide path for a
  `deep-dive-region`/`map-repo` should weigh region size (the `repoShape` signal
  already exists for whole-repo maps — extend it to a scoped region like `docs/`)
  and SPLIT into sub-region children rather than attempt a single dive that blows
  the wall-clock. This is exactly the ADR-029 recursion the comprehend family
  already has — the gap is that it didn't fire for a large scoped `docs/` dive.
- **Degraded path on a blocked dependency** (shared with the partial-delivery
  issue): a sibling whose dependency blocked should surface that clearly and, where
  the build can proceed without it, not be hard-blocked. At minimum the cascade
  should not erase the work of the 5 dives that succeeded.
- **Cheaper mitigation:** scope the build commission's comprehension away from the
  whole `docs/` tree (it rarely needs all 33 ADRs to implement a tool) — but that
  is a workaround, not the fix.

## Acceptance hint
A deliver-intent build whose scope includes a large `docs/` tree comprehends it by
SPLITTING the region (sub-dives that each fit the wall-clock), not by timing out a
single dive; and a single blocked comprehension dependency does not silently
cascade-block every build slice with nothing salvaged.
