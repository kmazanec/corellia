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
> actual size, emitting a "SPLIT into sub-region children" hint when large — so a
> big `docs/` dive should decompose instead of timing out. **Still open:** the
> dependency-cascade half — one blocked comprehension dependency still hard-blocks
> every dependent with no degraded path (shared with
> [partial-delivery-on-blocked-dependency](partial-delivery-on-blocked-dependency.md)).

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
