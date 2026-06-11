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

## Build plan (approved)

### Chunk 1: Git lifecycle primitives in a worktree module (open + create branch + ensure-gitignored)

- [ ] **Delivers:** openTreeWorktree(repoRoot, rootGoalId) creates a git worktree on a fresh branch under <repoRoot>/.claude/worktrees/<sanitized-tree-id>/, ensures .claude/worktrees is gitignored (appends to .git/info/exclude when the tracked .gitignore is absent or should not be touched; leaves a present tracked .gitignore unmodified), and returns { treeId, branch, root } with root as the absolute worktree path a future broker binds to. Implemented with node:child_process execFileSync passing git args as an array (no shell string), reusing nothing external — no new deps. **Satisfies:** AC-1 (a worktree exists on a fresh branch under .claude/worktrees/<tree-id>/ and .claude/worktrees is ensured gitignored via .git/info/exclude when tracked .gitignore is absent or should not change). **Tests:** tests/engine/worktree.test.ts — describe('open worktree'): asserts branch exists, worktree dir exists at the returned absolute root, .git/info/exclude contains the .claude/worktrees entry when no tracked .gitignore exists, and a present tracked .gitignore is left byte-for-byte unmodified. Tmp repo via fs.mkdtemp + git init. **Contract touchpoint:** none.

### Chunk 2: Real-diff scope check reusing filesWithinScope normalization

- [ ] **Delivers:** diffWithinScope(worktreeRoot, scope) runs the actual `git -C <root> diff --name-only` (staged+unstaged+untracked) and returns { ok, scopeInsufficiency? } by feeding each changed path through the SAME normalization/boundary predicate already implemented in src/library/checks.ts filesWithinScope (extracted to a shared isWithinScope(path, scope) helper so both the artifact check and the diff check share one definition — no duplicated scope logic). Refusal carries a scope-insufficiency report string (the value for Report.scopeInsufficiency). **Satisfies:** AC-2 (a leaf whose actual git diff touches a file outside its declared scope is refused with a scope-insufficiency report, even when every individual broker write was in-scope (script-mutated-file case)). **Tests:** tests/library/checks.test.ts — extend with describe('isWithinScope shared predicate') proving the extracted helper matches prior filesWithinScope behavior (no regression). tests/engine/worktree.test.ts — describe('diff vs scope'): write an in-scope file then assert ok; write an out-of-scope file DIRECTLY to the worktree filesystem (simulating a run_script side effect, NOT a broker write) then assert refusal with a scopeInsufficiency string naming the offending path. **Contract touchpoint:** none.

### Chunk 3: Tree-lifecycle FactoryEvents (additive union members)

- [ ] **Delivers:** Three additive FactoryEvent members (worktree-created, worktree-collected, worktree-preserved) in src/contract/events.ts so the lifecycle can record what happened to the log, and AC-3's 'preservation recorded as an event' is satisfiable. Any exhaustive switch over FactoryEvent (projections/printers) gains arms for the new members so the build stays exhaustive. **Satisfies:** AC-3 (event-recording portion: a preserved worktree's preservation is recorded as an event). **Tests:** tests/engine/worktree.test.ts — assertions in the collect/preserve describes check that the expected event member was appended to the MemoryEventStore stub with correct treeId/branch/path/reason. Repo typecheck (npm run typecheck) confirms no exhaustive switch was left non-exhaustive. **Contract touchpoint:** FactoryEvent union (src/contract/events.ts).

### Chunk 4: Collect-and-teardown vs preserve-on-failure

- [ ] **Delivers:** collectTree(worktree, store, { ok }) for a successful tree: stages and commits the worktree's work onto its branch (commits returned), removes the worktree (git worktree remove on the now-clean tree), and appends worktree-collected. For a failed/blocked tree: leaves the worktree in place, appends worktree-preserved with a reason. Uses synchronous execFileSync for metadata-mutating git ops so concurrent trees serialize on the shared .git. **Satisfies:** AC-3 (a completed tree's work exists as commits on the tree branch and the worktree is removed; a failed/blocked tree's worktree is preserved for inspection). **Tests:** tests/engine/worktree.test.ts — describe('collect completed tree'): after writing in-scope work, assert commits exist on the branch (git log on the branch) and the worktree dir no longer exists. describe('preserve failed tree'): assert the worktree dir still exists, no commit was forced, and a worktree-preserved event was appended. **Contract touchpoint:** none.

### Chunk 5: Concurrent trees on one repo are isolated

- [ ] **Delivers:** Two trees opened concurrently against one repo receive distinct treeIds/branches/worktree directories and cannot observe each other's writes (verifying the create/branch primitives compose safely under concurrency, with synchronous git metadata ops avoiding index-lock races). **Satisfies:** AC-4 (two concurrent trees on one repo get distinct worktrees/branches and cannot see each other's writes). **Tests:** tests/engine/worktree.test.ts — describe('concurrent trees'): open two trees, assert branch names differ, root paths differ, and a file written in tree A's worktree is absent from tree B's worktree (mutual write-invisibility). Final feature gate: npm run typecheck && npm test once over the whole repo. **Contract touchpoint:** none.

### Test strategy

Integration tests only, against throwaway tmp git repos created with fs.mkdtemp + `git init` (the tmp-dir pattern already used in tests/env.test.ts and tests/eventlog/stores.test.ts), zero live API. Each test initializes a real repo, runs the lifecycle/diff functions against it, and asserts on real git state (branches, worktree dirs, commits, .git/info/exclude contents) and on the appended FactoryEvents via the existing MemoryEventStore stub. The architecture-named risks drive the coverage: the script-mutated-file case (AC-2) is tested by writing an out-of-scope file directly to the worktree filesystem (simulating a run_script side effect) then asserting diffWithinScope refuses — this is the case write-time broker checks structurally cannot catch, so it MUST be an actual-diff test. Concurrency (AC-4) is tested by opening two trees on one repo and asserting distinct branch names, distinct worktree dirs, and mutual write-invisibility. Exclude-file handling (AC-1) is tested both when .gitignore is absent (assert .git/info/exclude gains the entry) and when present (assert tracked .gitignore is left unmodified). No unit-mock layer — git is the system under test, so mocking it would test nothing. Run just tests/engine/worktree.test.ts and tests/library/checks.test.ts (diff-scope additions) per chunk; one repo-wide `npm run typecheck` + `npm test` gate at feature end (the new FactoryEvent members force re-checking every exhaustive switch).

### Contract touchpoints

- **FactoryEvent union (src/contract/events.ts)** — extends: Add three additive members to the FactoryEvent discriminated union: { type: 'worktree-created'; at: number; goalId: string; treeId: string; branch: string; path: string } | { type: 'worktree-collected'; at: number; goalId: string; treeId: string; branch: string; commits: string[] } | { type: 'worktree-preserved'; at: number; goalId: string; treeId: string; branch: string; path: string; reason: string }. goalId is the tree-root goal id (keeps the log queryable by goal, consistent with every existing member). Every exhaustive switch over FactoryEvent (event-log projections, any printer) must add arms for these or stay non-exhaustive-by-default; no existing member changes.

- **ToolBroker construction (ADR-014/ADR-016) — sandbox root binding** — consumes: NOT introduced or wired in this feature. The worktree lifecycle exposes the absolute worktree root path (the value a future broker constructor will bind to as its sandbox root). Frozen surface this feature owns: openTreeWorktree(...) returns { treeId: string; branch: string; root: string } where `root` is the absolute worktree path a broker would later be bound to. The ToolBroker type itself lives in a sibling contract that does not yet exist in src/contract/; per the spec, binding the real broker instance happens at convergence — this feature must not import or depend on it.

### Risks

- **BROKER CONTRACT IS ABSENT FROM THE TREE.** ADR-014 (Contract: yes) freezes ToolBroker/Tool/ToolDef in src/contract/, but no such files exist yet and the spec lists dependsOn: []. The spec resolves this by saying the feature 'builds against the frozen broker shape' and 'binding the real broker instance happens at convergence.' Plan routes AROUND it: this feature does NOT build, import, or wire the broker; it only exposes the absolute worktree root that a future broker will bind to. If a builder tries to consume a ToolBroker type it will fail — that coupling belongs to a different feature/convergence.

- **AC-2 has a subtle, load-bearing ambiguity:** it requires refusal 'even though every broker write was individually in-scope at the time (e.g., a script mutated files).' Since the broker is NOT wired here, the only way to make this testable is to test the ACTUAL git diff against scope independently of any broker — i.e. write the out-of-scope file straight to the worktree filesystem to simulate a script side effect, then run diffWithinScope. The test must NOT route through a broker write or it would prove nothing. The diff check is the authoritative gate (ADR-014 confirms: 'write-time scope checks plus emission-time diff ⊆ scope is deliberate double coverage; the diff check remains the authoritative gate').

- **Wiring the diffWithinScope check into the engine emission path** (src/engine/engine.ts) is the riskiest chunk: the engine's deterministic-check loop runs DeterministicCheck(goal, artifact) — it has no notion of a worktree root or a tree-scoped git repo, and engine.ts is flagged in the roadmap's overlap note. A check that needs to shell out to git in a specific worktree does not fit the pure (goal, artifact) DeterministicCheck signature. Mitigation: keep diffWithinScope as a standalone function the TREE lifecycle calls at collection time (where the worktree root is in hand), NOT as a DeterministicCheck plugged into the per-leaf attempt loop. This avoids changing the DeterministicCheck contract and avoids touching the hot attempt loop. Report.scopeInsufficiency already exists as the refusal channel, so no report-contract change is needed.

- **Tree-id source is unspecified:** AC uses <tree-id> for both the worktree dir and the branch, but the engine identifies work by goalId (which contains '/' separators for children, e.g. parent/child). Branch and directory names cannot contain raw '/' segments safely / must be filesystem-safe. Mitigation: derive treeId from the root goal id with a deterministic sanitization (replace path separators), and freeze it as the returned treeId; tests assert the sanitized form is filesystem- and git-ref-safe.

- **git worktree teardown footgun:** `git worktree remove` refuses if the worktree has uncommitted changes or untracked files. AC-3 says completed trees commit then remove, failed/blocked trees are PRESERVED — so teardown only runs after a successful commit (clean tree), and preservation is the explicit branch for the dirty/failed case. Tests must cover both. Also `git worktree prune` may be needed if a dir is removed out-of-band; keep teardown to the documented commit-then-remove path only.

- **Concurrency (AC-4) under one shared git repo:** two `git worktree add` invocations touch the same .git/worktrees metadata and could race on index lock. Node child_process calls are serialized within a single process by execFileSync's synchronous nature, but if the builder uses async execFile the two adds can interleave and hit `.git/index.lock` contention. Mitigation: use synchronous execFileSync for the metadata-mutating git ops (worktree add/remove, branch create) so concurrent trees serialize naturally; the test for AC-4 should still assert distinct branches/dirs and write-invisibility.

## Implementation notes (filled in by the building agent)

> Owned by the builder, not the planner. Starts empty.
