---
type: issue
title: "A5. A blocked dependency silently kills its dependents with no degraded path"
description: Dependency edges are hard gates with no ship-what's-green partial-delivery mode, so a few blocked modules sink an otherwise-good tree.
tags: [in-run-stall, engine, partial-delivery]
timestamp: 2026-06-25
status: open
kind: idea
severity: medium
---

# A5. A blocked dependency silently kills its dependents with no degraded path

## Problem
Dependency edges are hard gates; there is no "ship what's green, report the rest"
partial-delivery mode. A blocked dependency takes down its dependents and the root,
even when most modules are perfect.

## Evidence
Run 1 (tiutni): filler failed → orchestrator `"Blocked because a dependency failed"`
→ root blocked, even though 3 of 5 modules were perfect. The operator hand-fished
the good modules out of the worktree. Source: `docs/gaps-from-tiutni.md` §A5.

## Proposed direction
**Partial-delivery**: when some children succeed and others block, emit a report
that (a) collects the green subtree, (b) lists the blocked modules + why, so the
operator merges the 80% immediately.

## Acceptance hint
A tree with a mix of green and blocked children emits a report that collects the
green subtree and enumerates the blocked modules with reasons — the operator can
merge the good part directly.
