---
type: issue
title: "D1. Generic commit messages"
description: Collected/auto commits read 'feat(tree): collect worktree <id>' or 'Fix bugs' — not conventional, not descriptive.
tags: [ergonomic, collect, git]
timestamp: 2026-06-25
status: fixed-pending-live-proof
kind: idea
severity: low
---

> **Fixed-pending-live-proof (2026-07-06):** the collect commit is now derived
> mechanically from data already in the goal and event log — no LLM call
> (`src/engine/collect-commit-message.ts`). Subject: `feat(<scope-hint>):
> <intent>`, where the scope-hint is the meaningful segment of the root goal's
> first declared scope prefix (skipping a generic `src`/`app`/`lib`/`pkg` root)
> or the goal type, and the intent is the root goal's title trimmed to one line
> and capped at 72 chars. Body: one line per contributing goal (id, type, title),
> root-first, gathered from the tree's `goal-received` events via `parentId`
> descent. `finalizeSandboxedRun` derives the message and passes it to
> `collectTree`, which falls back to the old generic subject only when no message
> is supplied. Note: the "Fix bugs" / "Fix 2025 standard deduction" auto-commits
> cited here came from the model's own in-tree `git commit` calls, not the
> collect path — this fix addresses the collect commit.

# D1. Generic commit messages

## Problem
Collected commits read `feat(tree): collect worktree <id>`; later auto-commits were
`"Fix bugs"` / `"Fix 2025 standard deduction expectations"` — not
conventional-commits, not descriptive.

## Evidence
tiutni runs (collected commits + auto-commits). Source:
the gap-audit iteration (docs/iterations/2026-06-24-01-gap-audit-tiutni/index.md).

## Proposed direction
Have the deliver report supply a proper commit subject/body from the goal intent.

## Acceptance hint
Collected commits carry a conventional, descriptive subject/body derived from the
goal intent rather than a generic placeholder.
