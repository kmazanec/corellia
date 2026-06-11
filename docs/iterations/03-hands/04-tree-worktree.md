---
id: F-34
title: Tree worktree lifecycle
iteration: 03-hands
type: implement
intent: production
status: not-started
dependsOn: []
contracts: [ADR-016, ADR-014]
---

# Feature: Tree worktree lifecycle

**ID:** F-34 · **Iteration:** 03-hands · **Status:** Not started

## What this delivers (before → after)

**Before:** goals produce artifacts in memory; nothing touches a real
checkout; `diff ⊆ scope` checks artifact path lists, not actual diffs.
**After:** each tree opens its own git worktree/branch under the target
repo's `.claude/worktrees/<tree-id>/` (gitignored), the broker is bound to
that root, leaf emission checks the **actual git diff** against declared
scope, and the tree's collected work lands as commits on its branch with
teardown after collection.

## How it fits the roadmap

Realizes the design's isolation unit (ADR-016) and turns scope enforcement
from bookkeeping into a property of the real diff. The PR-opening boundary
itself stays in iteration 6; this feature ends at "an isolated branch with
commits."

## Reading brief

`docs/adrs/ADR-016` (the lifecycle and trust posture) · DESIGN.md § "Scope
is enforced, not declared" and § "Humans operate beside the factory" ·
`src/library/checks.ts` (`filesWithinScope`) · the emission path in
`src/engine/engine.ts`.

## Requirements traced (from the PRD)

R9 (isolated checkout, diff ⊆ scope) · AC-6.

## Dependencies (must exist before this starts)

None — builds against the frozen broker shape (binding the real broker
instance happens at convergence). Touches `src/engine/engine.ts` (see the
roadmap's overlap note).

## Unblocks (what waits on this)

Nothing hard-waits; F-36's live demo runs inside a worktree this feature
provides.

## Contracts touched

`ToolBroker` construction (sandbox root binding — ADR-014/016) — consumed.
If tree lifecycle events need new members, they ride the barrier.

## Acceptance criteria (product behavior)

1. Given a tree starting against a git repo, then a worktree exists on a
   fresh branch under `.claude/worktrees/<tree-id>/`, and `.claude/worktrees`
   is ensured gitignored (via `.git/info/exclude` when the tracked
   `.gitignore` is absent or shouldn't change).
2. Given a leaf whose actual `git diff` in the worktree touches a file
   outside its declared scope, when it attempts to emit, then emission is
   refused with a scope-insufficiency report (AC-6) — even though every
   broker write was individually in-scope at the time (e.g., a script
   mutated files).
3. Given a completed tree, then its work exists as commits on the tree
   branch and the worktree is removed; given a failed/blocked tree, the
   worktree is preserved for inspection and its preservation recorded as an
   event.
4. Two concurrent trees on one repo get distinct worktrees/branches and
   cannot see each other's writes.

## Testing requirements

Integration tests against tmp git repos: lifecycle create/teardown,
diff-vs-scope refusal (including the script-mutated-file case), concurrent
trees, exclude-file handling. No live API usage.

## Manual setup required

None.

## Implementation notes (filled in by the building agent)

> Owned by the builder, not the planner. Starts empty.
