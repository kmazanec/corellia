---
type: iteration
title: "Iteration 18 — Make-leaf progress: write-steering, non-isomorphic retry, worktree salvage, repair hints"
description: Five fixes that stop a make leaf from reading-but-never-delivering and then blocking with nothing salvaged — output-mode steering, a read-without-write nudge, a non-isomorphic retry carrying the rejection reason, worktree salvage on both the success and block paths, and an error-signature repair-hint library. Closes three issues.
tags: [iteration, engine, build, make-goal, step-loop, salvage, retry, repair, in-run-stall, self-hosting]
timestamp: 2026-06-28
status: landed on main
---

# Iteration 18 — Make-leaf progress

## Source

Three OKF issues, all about a make leaf that reads but never writes and then
blocks with zero salvage:

- `freeze-contract-step-loop-stall` — a make leaf emitted an architecture map
  instead of files, was rejected, retried identically, and isomorphic-blocked.
- `salvage-on-repeated-failure` (A1) — a block discarded the worktree's partial
  work, handing the operator an empty tree.
- `error-signature-repair-hints` (A2) — no feedback maps a known error signature
  to its fix, so the leaf thrashes on recurring classes (missing vitest import,
  ESM `__dirname`).

Surfaced by driving the `visual-runtime-verification` commission; built and
verified hand-on-main.

## What this delivers

### 1. Output-mode steering (iteration 17 follow-through)
The make-goal preamble (`step-loop-context.ts` `makeArtifactBlock`) and the
`freeze-contract` skill section state that a make goal's artifact is the files it
writes (fenced blocks), not a summary or map.

### 2. Read-without-write nudge
`make-progress-nudge.ts`: once a make leaf crosses 12 read-class calls with zero
successful writes, a one-time in-loop reminder fires — reading is not delivery,
write the files or raise a blocker. Wired through the step-loop router/session.

### 3. Non-isomorphic retry
`step-loop-context.ts` `priorRejectionBlock`: the prior attempt's gating-finding
titles are injected into the retry prompt as a "rejected for X — do something
different" block, threaded from `artifact-production.ts` through `runStepLoop`. A
retry after a wrong-mode rejection is genuinely different instead of re-tripping
the same isomorphic block.

### 4. Worktree salvage — success and block paths
`worktree-salvage.ts` collects in-scope changes from the worktree into a files
artifact. Two seams use it:
- **Success path** (`artifact-evaluation.ts`): a make goal that returns prose but
  wrote files delivers the files instead of the prose.
- **Block path** (`failure-resolution.ts` → `failure.ts` → `blockedReport`): a
  hard block (isomorphic / non-convergence / step-loop-failed) carries the
  salvaged partial diff on the blocked report's `artifact` instead of `null`, so a
  resume starts from the partial work rather than an empty worktree.

### 5. Error-signature repair hints
`repair-hints.ts`: a small static lookup mapping recurring error signatures
(missing vitest import, ESM `__dirname`/`require`, missing TS name, top-level
await) to a concrete fix. Matched hints ride the existing prior-rejection feedback
path as extra rejection reasons, so a leaf converges on a recognized class of
error instead of thrashing.

## Acceptance criteria

1. A make leaf reading without writing past the threshold receives a one-time
   nudge; a non-make leaf never does. (tests: `make-progress-nudge.test.ts`)
2. A retry carries the prior rejection reasons; a first attempt does not.
   (tests: `conventions-injection.test.ts`)
3. Worktree salvage collects in-scope changes and ignores out-of-scope / clean /
   non-repo cases. (tests: `worktree-salvage.test.ts`)
4. A blocked report carries the salvaged artifact instead of null. (tests:
   `attempt-failure.test.ts`)
5. Known error signatures map to their fixes; unknown failures yield none.
   (tests: `repair-hints.test.ts`)

## Outcome

Closes `freeze-contract-step-loop-stall`, `salvage-on-repeated-failure`, and
`error-signature-repair-hints`. The freeze-contract failure family — read-but-
don't-write, reject, retry identically, block with nothing salvaged — is
addressed end to end. Final proof is a live re-run of the commission.

## Validation

`npm run typecheck`, `npm run lint`, full `vitest` suite green (the `push-branch`
real-git test is a pre-existing timing flake under full-suite CPU load; it passes
in isolation).
