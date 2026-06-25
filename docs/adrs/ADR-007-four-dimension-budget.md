---
type: adr
title: "ADR-007: Budgets are four-dimensional, subdivided, and all four dimensions gate"
description: Budgets are four-dimensional and subdivided so a fan-out cannot multiply costs past its root grant (superseded by ADR-033, which makes the count dimensions non-steering).
tags: [adr, budget, four-dimensions, subdivision, superseded]
timestamp: 2026-06-24T22:13:07-05:00
---

# ADR-007: Budgets are four-dimensional, subdivided, and all four dimensions gate

**Status:** Superseded by ADR-033 · **Date:** 2026-06-10 (decided iteration 1 + review fixes; recorded retroactively) · **Stretch:** no · **Contract:** yes
**Supersedes:** none · **Superseded by:** ADR-033 (budget is a non-steering backstop: count dimensions never block, cap fan-out, or shape the build)

> **Superseded by ADR-033.** Budget is a non-steering backstop: the count
> dimensions (`attempts`, `tokens`, `toolCalls`) never block work, cap fan-out,
> or shape the build — they are tracked for observability only. The only hard
> bounds are the per-tree dollar ceiling and wall-clock. The count-gating,
> fan-out cap (`children.length ≤ attempts`), and "tool-call budget teaches the
> batching rhythm" claims below are **no longer in force.** This ADR is retained
> only for the record that the four counters exist.

## Context

DESIGN.md requires budgets inherited and subdivided so a fan-out cannot
multiply costs past its root grant. The iteration-1 review found two
violations in the first implementation: tokens/tool-calls/wall-clock were
tracked but never gated the loop, and a `Math.max(1, …)` floor in subdivision
let many tiny-share children sum past their parent.

## Options considered

- Four dimensions `{attempts, tokens, toolCalls, wallClockMs}`, every one
  enforced, child count capped by attempts — chosen.
- Attempts-only gating (others advisory) — rejected at the time. (Superseded:
  ADR-033 makes all four counters non-gating; the dollar ceiling and wall-clock
  are the only hard bounds.)
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

At the time, each dimension was meant to bound a different failure. ADR-033
retired that framing: a count that blocks a build is budget steering the build.
The counters remain for observability; the dollar ceiling and wall-clock are
the bounds grounded in real runaway cost.

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
