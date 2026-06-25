---
type: issue
title: "D1. Generic commit messages"
description: Collected/auto commits read 'feat(tree): collect worktree <id>' or 'Fix bugs' — not conventional, not descriptive.
tags: [ergonomic, collect, git]
timestamp: 2026-06-25
status: open
kind: idea
severity: low
---

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
