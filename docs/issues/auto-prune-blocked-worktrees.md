---
type: issue
title: "D4. Worktree teardown is manual on block"
description: Blocked runs leave .corellia/worktrees/<id>/ for the operator to git worktree remove by hand.
tags: [ergonomic, worktree, cleanup]
timestamp: 2026-06-25
status: fixed-pending-live-proof
kind: idea
severity: low
---

> **Fixed-pending-live-proof (2026-07-06):** implemented a reaper
> (`src/engine/worktree-reaper.ts`) rather than auto-deleting blocked work —
> ADR-026 preserves blocked worktrees as salvage deliberately. Each sandboxed run
> reaps stale tree worktrees under `.corellia/worktrees/` before opening its own
> (wired in `openSandboxAssembly`). The default pass removes ONLY worktrees whose
> `tree/*` branch is fully merged into the current branch (their commits are in
> history). A worktree with uncommitted changes is ALWAYS preserved — those edits
> are unrecoverable once the checkout is gone and are never captured by a merged
> tip. The run's own about-to-open worktree is marked active and never a target.
> `CORELLIA_REAP_WORKTREES=1` additionally clears clean-but-unmerged trees (their
> branch tip survives). Skips are reported, and each removal emits a
> `worktree-reaped` event. Deleting work being the one irreversible act, every
> ambiguous case is skipped.

# D4. Worktree teardown is manual on block

## Problem
Blocked runs left `.corellia/worktrees/<id>/` for the operator to
`git worktree remove`. There is no auto-prune.

## Evidence
tiutni blocked runs left orphaned worktrees for the operator to remove. Source:
the gap-audit iteration (docs/iterations/2026-06-24-01-gap-audit-tiutni/index.md). (Corroborated by the iteration-13 run record in
the relevant iteration record under docs/iterations/: the blocked `live-self-93cbaae0` worktree + its
`tree/*` branch were torn down by hand.)

## Proposed direction
Auto-prune (or `--reap`) blocked worktrees once their report is collected.

## Acceptance hint
A blocked run's worktree is auto-pruned (or pruned via an explicit `--reap`) once
its report is collected — no manual `git worktree remove`.
