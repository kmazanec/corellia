# ADR-014: One Tool contract, one Broker — the single point of grant, scope, debit, and event

**Status:** Accepted · **Date:** 2026-06-10 · **Stretch:** no · **Contract:** yes
**Supersedes:** none · **Superseded by:** none

## Context

Iteration 3 gives leaves hands. DESIGN.md requires "the contract is the
capability" to be true at runtime: goals use only the tools their type grants
(exact static grants, ADR-013), refusals are recorded not crashed (PRD AC-7),
and tool calls debit the budget that teaches the batching rhythm (ADR-007).
Those properties need exactly one enforcement point.

## Options considered

- A typed `Tool` contract + one `ToolBroker` mediating every call — chosen.
- Tools as functions handed directly to brains — rejected: enforcement
  scatters into every call site; refusal/debit/event become conventions.
- Adopting a framework's tool abstraction — rejected (ADR-015 context; the
  enforcement point is the product, not a detail to outsource).

## Decision

The contract barrier freezes (concrete signatures at plan time, consistent
with this shape):

- `ToolDef` — `name`, `description`, JSON-Schema `parameters`. Definitions
  are data; execution lives broker-side, keyed by name.
- `ToolCall` — `{id, name, args}` · `ToolResult` — `{callId, ok, output}`;
  a refusal is `ok: false` with a stated reason, never an exception.
- `ToolBroker.execute(goal, call)` — checks the goal-type's **exact grant**
  (ADR-013), checks write paths against the goal's **scope**, debits
  `toolCalls`, appends a tool event (call or refusal) to the log, then runs
  the tool. One broker instance per tree, bound to its sandbox (ADR-016).

**V1 tool set:** `read_file`, `write_file`, `list_dir`, `search` (content
grep), `run_script` (repo-declared entry points only, per PRD R12). The
wire shapes mirror standard provider tool-calling so adapters stay thin
(ADR-015).

## Rationale

Every required property — refusal-as-data, central debiting, complete logs,
scope enforcement at write time rather than only at emission — is a
corollary of having exactly one mediator. Two enforcement points is zero
enforcement points.

## Tradeoffs & risks

- Broker-side execution means tools are factory code; a target repo cannot
  inject tools. That's the intended trust boundary, but it makes new tools a
  factory PR (improvement-loop work), never a runtime extension.
- Write-time scope checks plus emission-time `diff ⊆ scope` is deliberate
  double coverage; the broker check gives fast feedback, the diff check
  remains the authoritative gate.

## Consequences for the build

- New contract files: tool shapes in `src/contract/`; broker implementation
  in `src/library/` or `src/engine/` (plan decides placement).
- Tool events join the `FactoryEvent` union (ADR-003 discipline: exhaustive
  switches must break until handled).
- `GoalTypeDef` grants become the broker's input verbatim — no side channel.
