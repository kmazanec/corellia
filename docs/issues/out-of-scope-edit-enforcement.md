---
type: issue
title: "C1. Out-of-scope edits were neither prevented nor surfaced"
description: A job scoped to public/ silently edited the tax engine; grant/scope enforcement at the write_file boundary is not wired.
tags: [scope-safety, engine, broker]
timestamp: 2026-06-25
status: open
kind: bug
severity: high
---

# C1. Out-of-scope edits were neither prevented nor surfaced

## Problem
The deferred **grant enforcement** (README "Deliberately deferred": "the runtime
check that a goal's tool calls stay within the grants declared on its type") plus
scope enforcement is not wired. `write_file` can touch anything in the worktree. A
scoped "UI" job silently altering tax math is exactly the failure a harness must
prevent. (Marked ⭐ highest risk in the source.)

## Evidence
Run 3 (tiutni) was scoped to `public/` only, yet `src/tax/engine.ts` and several
test files were modified (the standard-deduction constants). The operator only found
this by reviewing `git show` on the merge commit — the factory neither blocked the
out-of-scope write nor flagged it in its report. Source:
the gap-audit iteration (docs/iterations/2026-06-24-01-gap-audit-tiutni/index.md).

## Proposed direction
Enforce the declared `scope` prefixes at the broker's `write_file` boundary (refuse
+ report a write outside scope), and make the collected report **list every file
touched** vs. the declared scope.

## Acceptance hint
A `write_file` outside a goal's declared scope is refused and surfaced in the
report; the collected report lists every file touched against the declared scope.
