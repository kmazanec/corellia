---
type: issue
title: "A1. Repeated-failure → step-loop:failed gives up with ZERO salvage"
description: On step-loop:failed the engine blocks the subtree and discards the worktree, handing the operator an empty worktree instead of the partial progress.
tags: [in-run-stall, engine, salvage]
timestamp: 2026-06-25
status: open
kind: bug
severity: medium
---

# A1. Repeated-failure → step-loop:failed gives up with ZERO salvage

## Problem
When an `implement` leaf repeats an isomorphic failure, the engine blocks the
whole subtree and discards everything in the worktree — even partial, useful
progress. The operator got an *empty* worktree and started from zero.

## Evidence
Run 2 (tiutni), both children: `"step-loop:failed … escalating to block"` ×16;
worktree collected with the stub bodies UNTOUCHED. Run 1 hit the same signature on
the orchestrator dependency. Source: the gap-audit iteration (docs/iterations/2026-06-24-01-gap-audit-tiutni/index.md).

## Partially addressed (2026-06-28)
`src/engine/attempt/worktree-salvage.ts` now salvages partial work on the
**success/evaluation** path: when a make goal returns prose but the worktree holds
in-scope file changes, the artifact is rebuilt from the files actually written, so
that work is delivered rather than discarded. This handles the common
"wrote files, forgot to echo them" case and reduces how often a leaf reaches a
zero-salvage block at all.

**Residual (still open):** salvage on the **block path** itself. When a leaf
genuinely blocks (isomorphic / non-convergence) with partial work in the worktree,
the blocker report should still carry that partial diff + the failing transcript so
a resume starts from the partial work. The current salvage only fires when the
attempt would otherwise emit; a hard block still discards the worktree.

## Proposed direction
On a hard block (`step-loop:failed` / isomorphic / non-convergence), (a) preserve
the worktree's best attempt as a draft artifact on the blocker report, and (b)
attach the failing transcript + last diff so the operator/improvement-loop can
resume from the 90% instead of 0%. The success-path salvage above already exists
and supplies the diff-collection helper (`salvageWorktreeArtifact`) to reuse.

## Acceptance hint
A blocked subtree's report carries the worktree's best partial diff + the failing
transcript, so a resume starts from the partial work rather than an empty worktree.
