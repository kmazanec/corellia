---
type: issue
title: "B4. The GREENFIELD bootstrap — git init, scaffold, frozen contract"
description: The worktree flow requires an existing git repo to build into; there is no path to scaffold a new project from nothing.
tags: [structural, scaffold]
timestamp: 2026-06-25
status: open
kind: future-work
severity: medium
---

# B4. The GREENFIELD bootstrap — git init, scaffold, frozen contract

## Problem
`openTreeWorktree` asserts a git repo; `deliver-intent` assumes a scaffold; there is
no "scaffold a new project from nothing" path. The factory delivers *increments*,
not the first commit.

## Evidence
Operator did: `git init`, wrote the initial `package.json`/`tsconfig`/server
scaffold + the frozen `domain/types.ts` contract + typed stubs, committed a green
baseline — because the worktree flow REQUIRES an existing git repo with something to
build *into*. Source: the gap-audit iteration (docs/iterations/2026-06-24-01-gap-audit-tiutni/index.md).

## Proposed direction
A `scaffold-project` goal type (or, at minimum, a documented "operator seeds the
baseline, then commissions" protocol) that stands up a minimal, typechecking,
test-green skeleton + frozen contract from an intent.

## Acceptance hint
From an intent and an empty directory, the factory (or a documented protocol)
produces a typechecking, test-green skeleton with a frozen contract that a
`deliver-intent` goal can then build into.
