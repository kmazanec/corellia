---
type: issue
title: "A5. A blocked dependency silently kills its dependents with no degraded path"
description: Dependency edges are hard gates with no ship-what's-green partial-delivery mode, so a few blocked modules sink an otherwise-good tree.
tags: [in-run-stall, engine, partial-delivery, collect, round-commit]
timestamp: 2026-06-25
status: open
kind: bug
severity: high
---

# A5. A blocked dependency silently kills its dependents with no degraded path

## Problem
Dependency edges are hard gates; there is no "ship what's green, report the rest"
partial-delivery mode. A blocked dependency takes down its dependents and the root,
even when most modules are perfect.

## Evidence
Run 1 (tiutni): filler failed → orchestrator `"Blocked because a dependency failed"`
→ root blocked, even though 3 of 5 modules were perfect. The operator hand-fished
the good modules out of the worktree. Source: the gap-audit iteration (docs/iterations/2026-06-24-01-gap-audit-tiutni/index.md).

**Sharpened by build run #6 (`live-self-a2397f0f`, 2026-06-25) — the worst form:
passing work is DISCARDED, not merely uncollected.** The run split into 3 slices;
slice A (the OKF docs lint, `scripts/lint-docs.ts`) **passed its gate cleanly**, but
slice B blocked and the root blocked (`judge-acceptance: no shippable verdict`). On
the block the engine **reset the worktree back to HEAD** (`reflog: reset: moving to
HEAD`), discarding the per-round commits (ADR-032 `commitRound`) — so slice A's
passing lint code was **unrecoverable** (no `lint-docs.ts` on disk, HEAD == main).
This is strictly worse than run #5, where the blocked file_issue work at least
survived in the working tree to be hand-salvaged. A root block must NOT erase a
sibling's verified, committed round work.

## Proposed direction
**Partial-delivery**: when some children succeed and others block, emit a report
that (a) collects the green subtree, (b) lists the blocked modules + why, so the
operator merges the 80% immediately. Two layers, in priority order:
1. **Don't discard passing round work on a block.** On a root block, preserve the
   round commits (the worktree should NOT be reset to HEAD when verified work
   exists) so a passing sibling slice is at least recoverable — the run #6
   regression. Minimal fix; stops the data loss.
2. **Ship-what's-green:** collect the verified subtree into the PR and report the
   blocked slices, instead of an all-or-nothing root block.

## Acceptance hint
A tree with a mix of green and blocked children (a) never resets away a passing
slice's committed round work, and (b) emits a report that collects the green
subtree and enumerates the blocked modules with reasons — the operator can merge
the good part directly.
