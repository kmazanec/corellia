---
id: F-31
title: Tool broker + core file tools
iteration: 03-hands
type: implement
intent: production
status: shipped
dependsOn: []
contracts: [ADR-014]
---

# Feature: Tool broker + core file tools

**ID:** F-31 · **Iteration:** 03-hands · **Status:** Shipped (build/03-hands)

## What this delivers (before → after)

**Before:** tools don't exist — goals emit artifacts as one-shot text and
"grants" are inert data on type definitions.
**After:** a goal can call `read_file`, `write_file`, `list_dir`, and
`search` through one broker that grant-checks, scope-checks writes, debits
`toolCalls`, and records every call or refusal as an event — an ungranted or
out-of-scope call returns a refusal result, never a crash.

## How it fits the roadmap

The enforcement point everything else in this iteration builds against
(ADR-014: "two enforcement points is zero enforcement points"). No hard
dependencies — builds as soon as the contract barrier lands.

## Reading brief

`docs/adrs/ADR-014` (the decision) · `docs/adrs/ADR-013` (exact grants) ·
`src/contract/` post-barrier (frozen tool shapes) · `src/library/checks.ts`
(`filesWithinScope` — reuse its path normalization for write checks) ·
DESIGN.md § "Tools: per goal-type grant".

## Requirements traced (from the PRD)

R9 (contract is the capability, refusals recorded) · AC-7.

## Dependencies (must exist before this starts)

None — builds as soon as the iteration's contracts are frozen.

## Unblocks (what waits on this)

Nothing hard-waits; F-32/F-34/F-36 consume the frozen broker interface and
integrate against this implementation at convergence.

## Contracts touched

Tool shapes + `ToolBroker` (source of truth: ADR-014) — this feature
implements the frozen signatures; it does not define them.

## Acceptance criteria (product behavior)

1. Given a goal whose type grants `read_file`, when it requests a file inside
   the sandbox root, then the result is `ok: true` with the content, a tool
   event is in the log, and `toolCalls` decremented by one.
2. Given a goal whose type does **not** grant `write_file`, when it requests
   one, then the result is `ok: false` naming the missing grant, a refusal
   event is in the log, and the goal's execution continues.
3. Given a granted `write_file` whose path falls outside the goal's scope (or
   escapes the sandbox root via `..`/absolute path), then the write is
   refused with the reason, and no file is created.
4. Given a `search` over the sandbox, then matches return as
   path:line-prefixed text suitable for a model transcript.
5. Every executed or refused call appears in the event log with goal id,
   tool name, and outcome (AC-13 discipline).

## Testing requirements

Unit tests per tool + broker paths (grant refusal, scope refusal, traversal
refusal, debit, event emission); property-style path-normalization cases
mirroring the existing `filesWithinScope` suite. No live API usage.

## Manual setup required

None.

## Build plan (approved)

- [x] **Freeze the tool contract + extend the event union** — Delivers `src/contract/tool.ts` with `ToolDef`/`ToolCall`/`ToolResult` and the `ToolBroker` interface (the frozen ADR-014 signatures), one additive 'tool-call' member on `FactoryEvent`, and barrel re-exports from `src/contract/index.ts`. Acceptance criteria: 5 (event must carry goal id, tool name, outcome — the union member's shape is fixed here). Tests: `tests/contract/tool.test.ts` (type-level construction + a switch-exhaustiveness assertion over FactoryEvent that fails to compile if the new member is unhandled); plus `npm run typecheck` as the gate that the additive union member compiles repo-wide. Contract touchpoint: `FactoryEvent` union (`src/contract/events.ts`) + new `src/contract/tool.ts`.

- [x] **read_file + list_dir bound to a sandbox root** — Delivers two pure async tool functions over `node:fs/promises` that resolve a relative path against the sandbox root, refuse absolute paths and `../` traversal (reusing the normalize/isAbsolute pattern from `checks.ts`), and return content / directory entries as data. No grant or debit logic yet — these are the leaf capabilities the broker will mediate. Acceptance criteria: 1 (read returns content for an in-sandbox path). Tests: `tests/engine/tools.test.ts` (or `src/engine/tools/*`) — in-sandbox read returns content; absolute-path and `../`-escape reads return a refusal/error value, not a throw; list_dir returns entries for an in-sandbox dir. Use `os.tmpdir()`-based fixtures. Contract touchpoint: none (implements `ToolDef`/`ToolResult` from chunk 1).

- [x] **write_file with scope + traversal refusal** — Delivers `write_file` tool that, given a sandbox root and the goal's scope[], refuses any path that is absolute, escapes the root via `..`, or falls outside the goal's scope prefixes — reusing the exact `filesWithinScope` normalization (normalize + boundary-suffix prefix match). On refusal no file is created; on success the file is written under the root. Acceptance criteria: 3 (write outside scope or escaping root is refused with reason, no file created). Tests: `tests/engine/tools.test.ts` — in-scope write creates the file; out-of-scope write returns `ok:false` with reason and creates no file; `../` and absolute paths refused; property-style cases mirroring `tests/library/checks.test.ts`'s `filesWithinScope` suite (parametrized path table). Contract touchpoint: none.

- [x] **search over the sandbox returning path:line text** — Delivers `search` tool that content-greps files under the sandbox root and returns matches as path:line-prefixed text suitable for a model transcript, implemented with `node:fs` + a plain RegExp/substring scan (no glob/ripgrep dependency, per ADR-001). Acceptance criteria: 4 (matches return as path:line-prefixed text). Tests: `tests/engine/tools.test.ts` — seeded files with known matches produce path:line-prefixed lines; no-match returns empty; binary/large-file and no-match-in-dir edge cases return cleanly, never throw. Contract touchpoint: none.

- [x] **ToolBroker.execute — grant, scope, debit, event, run** — Delivers the single mediator: `ToolBroker` class, one instance per tree, constructed with `{root, registry, store, onDebit, tools: ToolImpl[]}` — the dispatch table is **injectable** (barrier-frozen `ToolImpl` shape), so F-31 registers the four core file tools and `run_script` (F-33's `runScriptTool`) is registered at assembly (F-37) **without the two features ever touching the same file**. `execute(goal, call)` resolves the goal-type via the registry, checks the type's exact grants against the requested tool **through the barrier-frozen grant→tool map** (approval-review decision: `fs.read` covers `read_file`/`list_dir`/`search`; `fs.write` covers `write_file`; `test.run_scoped` or `test.run_impacted` covers `run_script`; `fs.write_test_dirs` is unmapped/deferred in v1), scope-checks writes, debits `toolCalls` via the **engine-owned counter** (approval-review seam decision: the engine owns per-goal tool-budget state; the broker debits through the engine-provided `onDebit` callback, which returns the remaining count — one state cell, never a mutation of `Goal.budget`), appends a tool-call event (call or refusal) with goalId + tool name + outcome, then dispatches to the matching `ToolImpl`. Ungranted/out-of-scope calls return `ok:false` and execution continues; never crashes. Acceptance criteria: 1 (granted read: ok:true, event logged, toolCalls decremented by one), 2 (ungranted write: ok:false naming missing grant, refusal event logged, execution continues), 3 (broker enforces write scope/traversal refusal end-to-end), 5 (every executed/refused call appears in the log with goal id, tool name, outcome). Tests: `tests/engine/broker.test.ts` — using `InMemoryEventStore` + `createRegistry(starterTypes())`: granted read path debits once + logs a call event; ungranted tool yields `ok:false` naming the grant + a refusal event; out-of-scope write refused + logged; assert event presence via `store.list({goalId})`. Run JUST this file plus `tools.test.ts`, then one repo `npm run typecheck`. Contract touchpoint: consumes `ToolBroker` signature from chunk 1; consumes `FactoryEvent` tool member.

### Test strategy

Unit-first per ADR/spec testing requirements: one vitest file per tool family (`tests/engine/tools.test.ts`) and one for the broker (`tests/engine/broker.test.ts`), plus a contract-level `tool.test.ts` that pins the frozen shapes and asserts `FactoryEvent` switch-exhaustiveness. Reuse the established idiom: constructed Goal literals (as in `tests/library/checks.test.ts`), `.js` ESM import extensions, `InMemoryEventStore` for event-log assertions, `createRegistry(starterTypes())` for grant lookups. Property-style path-normalization cases mirror the existing `filesWithinScope` suite (a parametrized table of absolute/../in-scope/out-of-scope paths). Filesystem tests use `os.tmpdir()` fixtures created/torn down per test — no fixed paths, no network, no live API (spec: 'No live API usage'). The architecture-named risk that demands the most coverage is the grant-string ↔ tool-name mismatch (see risks): the broker test must assert against whatever real grant strings the library uses, not the spec's tool names, so the test encodes the resolved mapping. One repo-wide `npm run typecheck` gate per feature catches the additive union member breaking exhaustive switches elsewhere (ADR-003 discipline). No e2e/on-device tests — this is a pure library + fs feature.

### Contract touchpoints

- **`src/contract/tool.ts` (new file: ToolDef, ToolCall, ToolResult, ToolBroker)** — Introduces: `ToolDef = { name: string; description: string; parameters: Record<string, unknown> /* JSON-Schema */ }; ToolCall = { id: string; name: string; args: Record<string, unknown> }; ToolResult = { callId: string; ok: boolean; output: string }; interface ToolBroker { execute(goal: Goal, call: ToolCall): Promise<ToolResult> }`. Re-exported from `src/contract/index.ts`. Frozen exactly per ADR-014: refusal is `ok:false` with the reason carried in `output`, never an exception.

- **`FactoryEvent` union (`src/contract/events.ts`)** — Extends: add member: `{ type: 'tool-call'; at: number; goalId: string; tool: string; callId: string; outcome: 'ran' | 'refused'; reason?: string }`. Additive only. Every existing exhaustive switch over `FactoryEvent['type']` (e.g. `src/eventlog/projections.ts`) must add a no-op/handled arm so the build's `noFallthroughCasesInSwitch` + exhaustiveness stays green — this is the one place the build can break repo-wide and the typecheck gate must cover it.

### Risks

- **GRANT-STRING vs TOOL-NAME MISMATCH — RESOLVED (approval review, 2026-06-11):** the barrier freezes an explicit grant→tool map keyed to GOAL-TYPES.md's capability vocabulary: `fs.read` ⊇ {read_file, list_dir, search}; `fs.write` ⊇ {write_file}; `test.run_scoped` | `test.run_impacted` ⊇ {run_script}. Grants stay capability-level; the library's grant strings are NOT renamed mid-iteration. The broker test asserts against the real grant strings via this map.

- **fs.write_test_dirs is a SECOND write grant (characterize type)** the spec's binary 'grants write_file or not' framing ignores — the broker's write-grant check must treat `fs.write_test_dirs` as a write capability scoped to test dirs, OR the feature explicitly defers it. Spec AC-2/AC-3 only exercise the plain `write_file`/`fs.write` path; recommend implementing only `fs.write` for v1 and noting `fs.write_test_dirs` as deferred to avoid scope creep.

- **run_script — RESOLVED (approval review, 2026-06-11):** not deferred and not built here. F-33 exports `runScriptTool` as a barrier-shaped `ToolImpl`; F-37 (assembly) registers it into this broker's injectable dispatch table. ADR-014's one-mediator rule holds: script runs as tool calls flow through `execute()` like every other call.

- **SANDBOX ROOT source is unspecified:** AC says 'inside the sandbox root' and ADR-014 says the broker is 'bound to its sandbox (ADR-016)', but ADR-016 (worktree-per-tree) was not in read scope. The broker must take the root as a constructor parameter (do not reach into ADR-016 internals); tests inject an `os.tmpdir()` root. This keeps the feature buildable without the worktree machinery.

- **DEBIT MECHANICS — RESOLVED (approval review, 2026-06-11):** the engine owns a per-goal mutable tool-budget counter (initialized from `goal.budget.toolCalls`); the broker debits through the engine-provided `onDebit(goal)` callback, which decrements and returns the remaining count. The loop's while-gate (F-32) and the per-step remaining-count injection read the same counter. `Goal.budget` is never mutated; `consume()` stays pure. Tests assert the decrement via the counter the callback exposes.

## Implementation notes (filled in by the building agent)

> Owned by the builder, not the planner.

Built as planned plus review repairs: the broker owns the write-path scope/traversal check (refusals logged `outcome:'refused'` with reason — audit-honest), dead stub exports deleted, shared containment predicate unified (`isInScope`, one definition in `src/library/checks.ts`). Broker does NOT debit budget (engine-as-sole-debitor seam, recorded in the manifest). Symlink escape accepted lexically per ADR-016 posture (why-comment in code). `fs.write_test_dirs` deliberately unmapped in v1, pinned by test.
