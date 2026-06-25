---
type: issue
title: "D4. Worktree teardown is manual on block"
description: Blocked runs leave .corellia/worktrees/<id>/ for the operator to git worktree remove by hand.
tags: [ergonomic, worktree, cleanup]
timestamp: 2026-06-25
status: open
kind: idea
severity: low
---

# D4. Worktree teardown is manual on block

## Problem
Blocked runs left `.corellia/worktrees/<id>/` for the operator to
`git worktree remove`. There is no auto-prune.

## Evidence
tiutni blocked runs left orphaned worktrees for the operator to remove. Source:
`docs/gaps-from-tiutni.md` §D4. (Corroborated by the iteration-13 run record in
`docs/prototype-build-notes.md`: the blocked `live-self-93cbaae0` worktree + its
`tree/*` branch were torn down by hand.)

## Proposed direction
Auto-prune (or `--reap`) blocked worktrees once their report is collected.

## Acceptance hint
A blocked run's worktree is auto-pruned (or pruned via an explicit `--reap`) once
its report is collected — no manual `git worktree remove`.
