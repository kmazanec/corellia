---
type: iteration
title: "Iteration 24 — Shell scope escapes are surfaced; a stray path no longer freezes round commits"
description: Closes the two residual holes in out-of-scope-edit-enforcement (C1). run_command writes are scope-checked after each call and surfaced as scope-escaped events plus a warning to the leaf; commitRound commits a round's in-scope work instead of silently skipping the whole round when anything is out of scope.
tags: [iteration, scope-safety, engine, broker, milestone-loop, bootstrap]
timestamp: 2026-09-23
status: landed; live proof pending
---

# Iteration 24 — Shell scope escapes

## Source

[out-of-scope-edit-enforcement](../../issues/out-of-scope-edit-enforcement.md)
(C1, severity high). It was marked fixed-pending-live-proof: the file tools
(`write_file`, `edit_file`, `delete_file`, `file_issue`) refuse out-of-scope
paths, the root emission gate blocks an escaping tree diff, and collection
emits `files-touched`. An audit while closing
[iteration 23](../2026-09-23-01-daemon-declared-scripts/index.md) found two
remaining holes:

1. **`run_command` writes anywhere, silently.** It takes free-form shell
   text, which cannot be checked before it runs. Build leaves hold
   `repo.command`, so a `sed -i` or a redirect could edit any file, the C1
   failure itself. The leaf got no signal, and nothing was logged until the
   emission gate blocked the whole tree at the end.
2. **`commitRound` skipped out-of-scope rounds silently.** With any
   out-of-scope path dirty, it returned `null` before staging anything. The
   round's in-scope progress went uncommitted, and the stray path stayed, so
   every later round did the same. HEAD froze, verify-on-read went stale, and
   the loop ran toward its no-progress halt with no event naming the cause.

## What shipped

- **`src/engine/scope-watch.ts`** (new): `scopeWatchedTool` wraps
  `run_command`. It samples out-of-scope dirty paths before and after each
  call. Any path the call newly pushed out of the calling goal's scope is
  appended as a `scope-escaped` event (`source: 'run_command'`) and named at
  the top of the tool output, with how to restore it. Paths that were already
  dirty (a sibling's work) are not attributed to the call.
- **`commitRound` commits in-scope work.** With a scope, it unstages
  everything (a shell may have staged a stray path), stages only in-scope
  paths, and commits them. Out-of-scope residue stays uncommitted: it never
  enters history, and the emission gate still blocks on it. The split runner
  logs that residue as `scope-escaped` (`source: 'round-commit'`).
- **`scope-escaped` event** added to the contract, parser, renderer,
  projections, and the write-attributable conformance set.
- `worktree.ts`: the changed-path collection and the scope partition are
  shared helpers (`uncommittedPaths`, `partitionByScope`) behind
  `diffWithinScope`, `commitRound`, and the new `outOfScopeChanges`.

Deliberately not taken: reverting escaped paths. Sibling leaves run
concurrently in one worktree (`split-children.ts`), so a diff across one call
cannot be attributed to that call alone, and a revert could destroy a
sibling's in-scope work. The leaf is told, the log records it, and the
emission gate is the backstop.

## Verification

`tests/engine/scope-watch.test.ts` (an escape is logged and named, not
reverted; a sibling's pre-existing dirt is not attributed),
`tests/engine/commit-round.test.ts` (a mixed round commits only its in-scope
work, even when the stray path was pre-staged; an all-out-of-scope round still
commits nothing), `tests/engine/milestone-loop.test.ts` (async commitRound).
Typecheck, lint, and the full suite green.

## Still open

- **Live proof** for C1 as a whole. The acceptance is a run in which an
  out-of-scope write is refused or surfaced and `files-touched` lists every
  path.
- A leaf that ignores the warning still leaves the tree blocked at emission.
  Carrying `scope-escaped` paths into round N+1's re-decide context, so the
  planner can schedule a restore, is the natural next step if live runs show
  leaves ignoring the warning.
- `run_script` is not watched. Its entry points are operator-declared, but a
  declared formatter could still rewrite out-of-scope files.
