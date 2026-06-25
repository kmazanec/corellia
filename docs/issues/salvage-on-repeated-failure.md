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
the orchestrator dependency. Source: `docs/gaps-from-tiutni.md` §A1.

## Proposed direction
On `step-loop:failed`, (a) preserve the worktree's best attempt as a draft
artifact on the blocker report, and (b) attach the failing transcript + last diff
so the operator/improvement-loop can resume from the 90% instead of 0%.

## Acceptance hint
A blocked subtree's report carries the worktree's best partial diff + the failing
transcript, so a resume starts from the partial work rather than an empty worktree.
