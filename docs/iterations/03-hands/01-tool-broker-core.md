---
id: F-31
title: Tool broker + core file tools
iteration: 03-hands
type: implement
intent: production
status: not-started
dependsOn: []
contracts: [ADR-014]
---

# Feature: Tool broker + core file tools

**ID:** F-31 · **Iteration:** 03-hands · **Status:** Not started

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

## Implementation notes (filled in by the building agent)

> Owned by the builder, not the planner. Starts empty.
