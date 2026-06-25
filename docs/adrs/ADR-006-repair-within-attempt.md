---
type: adr
title: "ADR-006: Repair runs inside the attempt that produced the flaw"
description: A single attempt covers produce, repair, and recheck so the cheap repair rung is not priced like a full retry.
tags: [adr, repair, attempt, control-loop, budget]
timestamp: 2026-06-10T21:16:39-05:00
---

# ADR-006: Repair runs inside the attempt that produced the flaw

**Status:** Accepted · **Date:** 2026-06-10 (decided iteration 1 review, confirmed by operator; recorded retroactively) · **Stretch:** no · **Contract:** no
**Supersedes:** none · **Superseded by:** none

## Context

The control loop's repair rung (judge prescribes, cheap fixer applies) needed
budget semantics. The iteration-1 review found the first implementation
burning two attempts per repair — one for the flawed production, one for the
fix — which made the cheap rung as expensive as a retry.

## Options considered

- One attempt covers produce + repair + recheck — chosen (operator confirmed).
- Repair consumes its own attempt — rejected: prices the cheap rung like an
  escalation, biasing the loop toward skipping repair.
- A separate repair budget line per goal — considered and left open as a
  refinement if traces show repair spend needs independent bounding.

## Decision

An attempt is the full unit: produce → deterministic checks → judge → (on
prescriptions) repair at the cheap tier → recheck. Only when that whole unit
fails does the next attempt begin (escalated tier, carrying the failure).

## Rationale

The design treats repair as the *cheap* rung — "the expensive model judges;
the cheap model types." Budget semantics must agree with that pricing, or the
loop's economics contradict its design. Tokens spent on repair still debit the
token budget, so repair isn't free — it just doesn't count as thrashing.

## Tradeoffs & risks

- A goal can spend meaningful tokens inside one attempt (produce + repair).
  Bounded by the token/tool-call dimensions, which gate independently.
- If traces show repair loops masking bad production quality, revisit the
  separate-budget-line option.

## Consequences for the build

- **Source of truth:** the attempt loop in `src/engine/engine.ts`.
- Tests asserting attempt counts must treat produce+repair+recheck as one
  attempt; event log records repair and recheck as distinct events within it.
