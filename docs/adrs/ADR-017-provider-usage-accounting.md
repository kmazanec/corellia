---
type: adr
title: "ADR-017: Accounting from provider-reported usage; a dollar ceiling per tree"
description: Spend is measured from provider-reported usage per call, recorded in events, and a per-tree dollar ceiling is computed from it rather than estimated.
tags: [adr, accounting, usage, dollar-ceiling, budget]
timestamp: 2026-06-10T21:40:50-05:00
---

# ADR-017: Accounting from provider-reported usage; a dollar ceiling per tree

**Status:** Accepted · **Date:** 2026-06-10 · **Stretch:** no · **Contract:** no
**Supersedes:** none · **Superseded by:** none

## Context

Iteration 1's token budget debits a chars/4 heuristic (ADR-007 noted this as
honest-but-approximate). The PRD requires spend measured from
provider-reported usage, never estimated (AC-12), and a per-tree
dollar ceiling — learning-phase default **$15**, operator-configurable
(R5, AC-11) — decided at the PRD interview.

## Options considered

- Provider-reported usage per call, recorded in events; dollar ceiling
  computed from it — chosen (largely determined by the PRD).
- Keep the heuristic, gate only on shape dimensions — rejected: a budget
  that mismeasures its costliest dimension makes exhaustion-as-event
  theater.
- Client-side tokenizer counting — rejected: re-implements what the
  provider already reports authoritatively, and still can't price.

## Decision

Every brain call's response usage (prompt/completion tokens, and cost where
the endpoint reports it — OpenRouter does with usage accounting enabled) is
recorded on the corresponding event. Token debits against the `tokens`
budget dimension use these figures; the chars/4 heuristic is removed from
accounting (it may survive only as a pre-call estimate for subdivision
sizing). Each tree carries a dollar ceiling (default $15); measured spend
reaching it halts the tree with a decision brief — no further provider calls
for that tree. Per-goal and per-tree token/dollar totals are projections
over the log (ADR-003).

## Rationale

The budget system's authority rests on measuring what it gates. Usage
arrives free on every response; the ceiling turns the operator's stated risk
tolerance into a structural bound rather than a hope.

## Tradeoffs & risks

- Cost figures depend on the endpoint reporting them; an endpoint that
  reports tokens but not cost needs a price table or a conservative
  token-only ceiling. V1 targets OpenRouter, which reports both.
- Mid-flight calls already in progress when the ceiling trips can overshoot
  by one call per concurrent branch. Accepted: the ceiling is a halt
  condition, not a transaction.

## Consequences for the build

- Usage fields join the relevant brain-call events (contract-barrier event
  change, ADR-003 discipline).
- The decide-phase metering gap (ADR-007) closes as part of this work:
  decide/scan calls report usage like any other call.
- Budget seed values (per-type token/tool-call defaults) start as a named
  policy table and are tuned from traces.
