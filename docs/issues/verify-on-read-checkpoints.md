---
type: issue
title: Verify-on-read fires at only the split checkpoint — decide and integrate deferred
description: DESIGN's checkpoint consistency re-reads depended-on facts at decide, split, AND integrate; today only the split checkpoint verifies, and lesson memories get no verify-on-read at all.
tags: [engine, knowledge, memory, verify-on-read, consistency]
timestamp: 2026-07-07
status: open
kind: future-work
severity: medium
---

# Verify-on-read fires at only the split checkpoint — decide and integrate deferred

## Problem
Corellia's named consistency model is checkpoint consistency: "every goal re-reads
the facts it depends on at each decide / split / integrate checkpoint … never
silently wrong at a moment of trust." In code, knowledge freshness fires only at
the split checkpoint; the decide and integrate checkpoints are explicitly deferred
(src/engine/options.ts:102-104), and lesson memories get no verify-on-read
anywhere. The integrate edge is the costliest place to act on a stale fact — it is
where verdicts are rendered — and it currently trusts whatever the split saw,
however long ago. This also weakens lateral coordination: a sibling's mid-tree
write is only noticed if a split happens to occur afterward.

## Evidence
- capability-scout sweep (2026-07-07): "Verify-on-read fires at only 1 of 3
  checkpoints — decide/integrate deferred (options.ts:102-104); lesson memories
  get no verify-on-read."
- DESIGN.md "Branches coordinate through shared state, by pull — checkpoint
  consistency."

## Proposed direction
Extend the existing split-checkpoint mechanism to decide and integrate — same
freshness query, same targeted-refresh-on-failure, no new machinery. Keep it
cheap: verify only the facts the checkpoint actually consumes (the artifact
categories in the goal's coverage set), and dedupe by SHA so an unchanged repo
costs one head check. Lesson-memory verify-on-read can follow as a second step
(facts with a file:line anchor re-check the anchor; anchorless lessons are
suggestions and stay label-only).

## Acceptance hint
A test that moves the repo SHA (or rewrites a depended-on fact) between a split
and its integrate sees the integrate checkpoint catch the drift and trigger
refresh/re-decision instead of judging against the stale fact.
