---
id: F-61
title: "PR-opening boundary tools"
iteration: 06-loop
type: implement
intent: production
status: Not started
dependsOn: []
contracts: [ADR-025, ADR-003]
---

# Feature: PR-opening boundary tools

**ID:** F-61 · **Iteration:** 06-loop · **Status:** Not started

## What this delivers (before → after)
**Before:** a tree ends at a local `tree/<id>` branch (`collectTree` in
`src/engine/worktree.ts`); no push or PR code exists anywhere in `src/`.
**After:** a granted leaf pushes its branch and opens exactly one PR carrying
diff, proof, and `learned` — without ever seeing a credential.

## Reading brief
- ADR-025 (decision + tradeoffs)
- ADR-016 (worktree posture; env scrubber)
- `src/engine/worktree.ts` — `TreeWorktree`, `collectTree`; branch naming
- `src/contract/tool.ts` — `ToolImpl`, `ToolBroker`, `GRANT_TOOL_MAP`
- `src/engine/assembly.ts` — tool registration seam (`ToolImpl[]`)
- `src/contract/events.ts` — `FactoryEvent` union (exhaustive switch consumers)
- `src/eventlog/projections.ts` — `traceStats` (~:139), `costSummary` (~:274), `projectKnowledge` (~:403)
- The env-scrubber path in `src/library/script-runner.ts`

## Dependencies (must exist before this starts)
None — can start as soon as the iteration's contracts are frozen.

## Contracts touched
- `GRANT_TOOL_MAP` (source of truth: ADR-025, `src/contract/tool.ts`) — adds
  `push_branch: ['repo.branch']`, `open_pr: ['repo.pr']`; `improve-factory`
  card's `factory-repo.*` grants renamed to `repo.*` in `src/library/types/improve.ts`.
- Event log (source of truth: ADR-003, `src/contract/events.ts`) — adds
  `branch-pushed { at; goalId; treeId; branch; remote }` and
  `pr-opened { at; goalId; treeId; branch; url }`; all three exhaustive
  projection switches extended.

## Acceptance criteria
1. `push_branch` pushes the tree's branch to the bound repo's origin;
   `GITHUB_TOKEN` is read from the engine's environment at execute time; the
   step transcript and tool outputs never contain the token string.
2. The process-clean gate (AC-20's greppable set: goal ids, plan refs, factory
   process language) runs over the tree's diff before any push; a dirty diff
   refuses naming the offending file:line and nothing reaches the remote.
3. `open_pr` opens a PR with model-supplied title/body; the body carries the
   proof artifacts, `learned`, and commit SHAs; the tool returns the PR URL.
4. Idempotence: a second `open_pr` for the same tree refuses and returns the
   existing URL (looked up from prior `pr-opened` events); a repeat
   `push_branch` is an allowed fast-forward.
5. `branch-pushed` and `pr-opened` events are appended; all three exhaustive
   projections handle the new members without compiler errors.
6. No merge/approve/close capability exists in any tool; a goal-type without
   `repo.pr` is refused by the existing broker path (pinned by test).

## Testing requirements
- Unit tests: process-clean gate logic, idempotence guard (event-log lookup),
  token-never-in-output assertion over stubbed git output.
- Integration: real `git push` against a local bare repo as origin.
- GitHub REST behind an injectable fetch transport so tests never touch the
  network.
- Contract tests: `branch-pushed` and `pr-opened` round-trip through the
  event store and all three projection switches.

## Manual setup required
`GITHUB_TOKEN` with `repo` scope in the engine's environment for live runs.
None required for scripted tests (injectable transport).

## Build plan (approved)
- [x] Chunk 1 — Tool defs + broker/assembly registration: consume the
  barrier's frozen `GRANT_TOOL_MAP` entries and event members (the barrier
  commit owns the contract extension — grant-map entries, the
  `factory-repo.*` → `repo.*` rename, union members + projection switches);
  register `push_branch`/`open_pr` `ToolImpl` stubs in assembly;
  satisfies AC 5, 6; tests: `tests/contract/tool-grants.test.ts`,
  `tests/eventlog/projections.test.ts`; contract touchpoint: `GRANT_TOOL_MAP` + events.
- [x] Chunk 2 — Process-clean gate over the worktree diff: deterministic grep
  over `git diff` output for goal ids, plan refs, and factory process language;
  returns offending file:line list or passes; satisfies AC 2; tests:
  `tests/engine/process-clean-gate.test.ts`; contract touchpoint: none (internal gate).
- [x] Chunk 3 — `push_branch` via git subprocess: token passed via
  `GIT_ASKPASS` (never in argv, never ps-visible); fast-forward repeat allowed;
  satisfies AC 1, 4 (push half); tests: `tests/engine/push-branch.test.ts`
  (bare-repo fixture); contract touchpoint: `branch-pushed` event.
- [x] Chunk 4 — `open_pr` via GitHub REST on global fetch with injectable
  transport; idempotence via `pr-opened` event-log lookup; satisfies AC 3, 4
  (PR half); tests: `tests/engine/open-pr.test.ts` (stub transport);
  contract touchpoint: `pr-opened` event.
- [x] Chunk 5 — Bare-repo integration suite: push + PR end-to-end with a local
  origin and stub GitHub transport; satisfies AC 1–6; tests:
  `tests/integration/pr-boundary.test.ts`.

### Test strategy
Unit tests cover gates and idempotence deterministically. The bare-repo
integration fixture (a `git init --bare` temp dir) gives real `git push`
coverage without network. The injectable fetch transport isolates the GitHub
REST path; the transport contract pins the request shape.

### Contract touchpoints
`GRANT_TOOL_MAP` and `FactoryEvent` are frozen barrier shapes; changes require
ADR-025 sign-off. The process-clean grep set must be the single source of truth
shared with the judge harness (AC-20 reference).

### Manual setup
None beyond `GITHUB_TOKEN` for operator-run live demos.

### Risks
- Token leakage via argv (ps-visible) — mitigated by `GIT_ASKPASS`/env-only
  path; builder must choose and pin the approach.
- AC-20 grep set duplication with judge harness — single-source file required.
- GitHub availability in live runs — retry per ADR-018 semantics on the
  injectable transport.

## Implementation notes

### Token-passing approach: GIT_ASKPASS

Chose **GIT_ASKPASS** over alternatives (token in remote URL, `credential.helper`
env var). Rationale:

- Embedding the token in the remote URL (`https://token@host`) exposes it in
  `git remote -v` output, in reflog messages, and potentially in git's trace
  output — all user-visible, all credential-leak surfaces.
- `GIT_ASKPASS` provides the token to git's credential-query path via a tiny
  helper script written to a secure tmpfile (mode 0700) that prints the token
  to stdout. Git invokes the helper internally and never echoes its output into
  the process argument list — zero ps-visible exposure.
- The helper file is deleted in a `try/finally` block after each push, so it
  is never left on disk. Even if deletion fails (process kill), the tmpdir
  lifecycle on the host OS will clean it.
- `GITHUB_TOKEN` is additionally deleted from the child process's environment
  before `execFile` is called — the askpass helper is the sole credential path.
- The tool output only contains the branch name and origin URL, never the token.
  Tests assert this with a distinctive fake token string.

Implementation: `src/engine/pr-tools.ts` — `writeAskpassHelper()` +
`pushWithToken()`.

### Process-clean grep set: single source of truth

`src/engine/process-clean.ts` exports `PROCESS_CLEAN_PATTERNS` (a
`readonly string[]`) and `scanDiffForProcessLanguage`. Both `pushBranchTool`
and any judge harness that runs AC-20 checks import from this single file.
No duplication. Tests pin the exported constant shape in
`tests/engine/process-clean-gate.test.ts`.

### Deviations / seams left for F-67 assembly

- `SandboxConfig.prBoundary` is the assembly seam: when present, the broker
  gets `push_branch` and `open_pr` registered. F-67 wires this when building
  a sandboxed `improve-factory` commission.
- `extractRepoSlug` is exported from `src/engine/pr-tools.ts` for operators
  and F-67 to derive the `repoSlug` from `git remote get-url origin` at
  commission-build time.
- `blocker-routed` event is handled only in projection switches (via the
  barrier); the ToolImpl for F-63 is not implemented here — that is F-63's
  scope.
- Live GitHub push requires `GITHUB_TOKEN` in the engine's process environment
  with `repo` scope. No code change needed; it is a runtime operator concern.
- The `push_branch` tool takes no model-supplied arguments (the branch is
  bound at construction). F-67 may want to expose a `force` flag for
  non-fast-forward repeats — not implemented here, left as a known seam.

