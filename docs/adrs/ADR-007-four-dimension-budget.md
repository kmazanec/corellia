# ADR-007: Budgets are four-dimensional, subdivided, and all four dimensions gate

**Status:** Accepted · **Date:** 2026-06-10 (decided iteration 1 + review fixes; recorded retroactively) · **Stretch:** no · **Contract:** yes
**Supersedes:** none · **Superseded by:** none

## Context

DESIGN.md requires budgets inherited and subdivided so a fan-out cannot
multiply costs past its root grant. The iteration-1 review found two
violations in the first implementation: tokens/tool-calls/wall-clock were
tracked but never gated the loop, and a `Math.max(1, …)` floor in subdivision
let many tiny-share children sum past their parent.

## Options considered

- Four dimensions `{attempts, tokens, toolCalls, wallClockMs}`, every one
  enforced, child count capped by attempts — chosen.
- Attempts-only gating (others advisory) — rejected: an advisory budget is a
  prompt-hope, and tool-call budgeting is what teaches the batching rhythm.
- Dollar-denominated budget as a fifth dimension — deferred to iteration 3
  (PRD R5 requires a per-tree spend ceiling; lands with real token
  accounting).

## Decision

`Budget = {attempts, tokens, toolCalls, wallClockMs}` in the frozen contract.
A parent subdivides its remaining allowance among children;
`children.length ≤ attempts` guards the subdivision floor; every dimension is
checked in the attempt loop and exhaustion of **any** dimension is an event
that ends the goal (block/summon), never a hang or silent overrun.

## Rationale

Each dimension bounds a different failure: attempts bound thrashing, tokens
bound spend, tool calls bound the per-edit loop (the dominant agentic cost),
wall clock bounds external stalls. The kmaz field data is explicit that
"run until green" without a tool budget invites the 30-test-run loop.

## Tradeoffs & risks

- Token figures are currently a chars/4 heuristic — honest accounting arrives
  with provider-reported usage (iteration 3, PRD AC-12). Until then the token
  gate is approximate in the right direction.
- Decide-phase brain calls (including the terraced scan's k candidates) are
  not yet debited — recorded gap, ride-along fix.

## Consequences for the build

- **Source of truth:** `src/contract/goal.ts` (Budget), subdivision + gating
  in `src/engine/engine.ts`.
- Iteration 3 must replace heuristic token debits with provider usage and add
  the per-tree dollar ceiling on top of (not replacing) the four dimensions.
