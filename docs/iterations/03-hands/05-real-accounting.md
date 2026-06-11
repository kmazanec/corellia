---
id: F-35
title: Provider-usage accounting + spend ceiling
iteration: 03-hands
type: implement
intent: production
status: not-started
dependsOn: []
contracts: [ADR-017, ADR-003]
---

# Feature: Provider-usage accounting + the $15 ceiling

**ID:** F-35 · **Iteration:** 03-hands · **Status:** Not started

## What this delivers (before → after)

**Before:** token budgets debit a chars/4 guess; decide-phase calls are
unmetered; dollar cost is unknown until the provider dashboard says so.
**After:** every brain call's event carries provider-reported usage (tokens
+ cost where reported), all debits derive from it, decide/scan calls are
metered like any other, and a tree halts with a decision brief when measured
spend reaches its dollar ceiling (default $15) — plus a per-tree cost
summary projection.

## How it fits the roadmap

Makes the budget system's authority real before the tool loop multiplies
call volume (ADR-017). Closes the decide-phase metering gap recorded in
iteration 2.

## Reading brief

`docs/adrs/ADR-017` (the decision) · `docs/adrs/ADR-007` (the four
dimensions this rides on) · `src/brains/llm.ts` (where usage is read) ·
budget debit sites in `src/engine/engine.ts` ·
`src/eventlog/projections.ts` (where the cost projection lands).

## Requirements traced (from the PRD)

R5 · AC-11, AC-12.

## Dependencies (must exist before this starts)

None — usage fields land in the barrier's event changes. Touches
`src/engine/engine.ts` (see the roadmap's overlap note).

## Unblocks (what waits on this)

Nothing hard-waits; F-36's live run is where reported-cost figures first
appear for real.

## Contracts touched

Usage fields on brain-call events; the tree spend ceiling's home in
the root contract (source of truth: ADR-017) — consumed from the barrier.

## Acceptance criteria (product behavior)

1. Given a brain response carrying usage, then the corresponding event
   records prompt/completion tokens (and cost when reported), and the
   `tokens` debit equals the reported figure — the chars/4 path is absent
   from accounting code.
2. Given a scripted run, then a cost-summary projection reports per-goal and
   per-tree token totals derived solely from event usage fields.
3. Given a tree whose accumulated reported cost reaches its ceiling, then
   the tree halts with a decision brief and no subsequent brain call events
   exist for that tree.
4. Given a decide-phase call (including terraced-scan candidates), then its
   usage is recorded and debited identically to produce/judge calls.
5. Given an endpoint reporting tokens but not cost, then the tree still
   enforces a conservative bound (documented fallback policy) rather than
   running uncapped.

## Testing requirements

Scripted-brain tests with synthetic usage payloads: debit equality, ceiling
halt (including the one-in-flight-call overshoot case documented in
ADR-017), decide-phase metering, the no-cost-reported fallback, projection
totals. No live API usage.

## Manual setup required

None.

## Implementation notes (filled in by the building agent)

> Owned by the builder, not the planner. Starts empty.
