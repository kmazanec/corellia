---
type: adr
title: "ADR-033: Budget is a non-steering safeguard — it never shapes what or how a goal builds"
description: Budget becomes a non-steering safeguard — the count dimensions never block, cap fan-out, or shape the build, leaving only the per-tree dollar ceiling and wall-clock as hard bounds.
tags: [adr, budget, non-steering, safeguard, supersedes-adr-007]
timestamp: 2026-06-24T22:13:07-05:00
---

# ADR-033: Budget is a non-steering safeguard — it never shapes what or how a goal builds

**Status:** Accepted · **Date:** 2026-06-24 · **Stretch:** no · **Contract:** yes
**Supersedes:** none · **Superseded by:** none · **Amends:** ADR-007, ADR-030

## Context

Budget began (ADR-007) as four hard-gating dimensions: `attempts` capped fan-out
(`children.length ≤ attempts`) and bounded retries, `tokens` and `toolCalls`
blocked a goal on exhaustion, and the framing was explicit that tool-call
budgeting existed to "teach the batching rhythm." ADR-030 softened most of that
"until a real run justifies a hard bound" — it removed the fan-out cap, made
`subdivide` inherit the count dimensions instead of flooring them at depth, and
made `toolCalls` warn-only — but it left a hedge: `attempts` and `tokens` remained
"honest loop terminators," re-armable the first time a trace showed them blocking
legitimate work.

The hedge is the bug. A count that blocks a build is budget steering the build.
The whole premise — "we'll re-arm a count bound when we need it" — keeps alive the
idea that the right number of attempts or tokens is a property of the work, when it
is not. A goal that is worth building is worth building at any budget; budget's
only legitimate job is to stop a *runaway* — unbounded recursion or unbounded
spend — not to decide how wide a split may be, how many retries a goal gets, or how
many tokens it may think with.

This was never abstract. Across the live runs, every count bound that fired killed
legitimate work, never a real runaway: `toolCalls: 20` exhausted real-repo
comprehension before the model could emit; the attempts-floor forbade a trivial
scoped intent from decomposing; dividing tokens by share starved deep comprehension.
The runaways that *did* need stopping were always caught by the two real-cost
bounds — the dollar ceiling and wall-clock.

## Decision

**Budget is purely a backstop against runaway recursion and spend. It never
influences what or how anything is built.** A goal plans, splits, and builds
identically at any budget.

1. **The only hard bounds are the ones tied to real runaway cost: the per-tree
   dollar ceiling and `wallClockMs`.** These block. They are grounded in money and
   time, not in arbitrary counts.

2. **The count dimensions — `attempts`, `tokens`, `toolCalls` — never block, cap,
   or steer.** They are tracked and reported for observability (the
   `budget-exhausted` event still fires when a counter crosses zero, so we keep
   seeing where cost concentrates), but crossing zero terminates nothing. There is
   no operator flag that re-arms them as build-blockers; the `enforceToolCallBudget`
   escape hatch is retained only as a deliberate, off-by-default diagnostic.

3. **Fan-out is never keyed to a count.** A node decomposes into as many children
   as the brain proposes. The structural split checks (≥1 child, unique localIds,
   acyclic `dependsOn`, valid shares) stay — they guard correctness, not cost.

4. **Non-convergence is a distinct, legitimate terminator — and it is not budget.**
   A goal that repeats an isomorphic failure, or that fails at the highest tier with
   no actionable repair, *cannot converge*; the engine blocks it and routes it to
   the listener / improvement loop. This block is real signal about the *work*, and
   it is now labelled as non-convergence (`nonConvergenceBrief`), never as
   "attempts exhausted." The old code reached this state via a count-shaped path and
   mislabelled it `dimension: 'attempts'`; that conflation is removed.

## Rationale

A backstop earns its place by stopping the unbounded case without touching the
bounded one. The dollar ceiling and wall-clock do exactly that: a real runaway
cannot cost unbounded money or run for unbounded time, and neither bound has any
say over a normal build. Count bounds failed the test in the opposite direction —
they never caught a runaway the real bounds missed, and they routinely strangled
legitimate work. Removing their authority loses nothing real and removes a whole
class of "the factory built it differently because the budget was tighter,"
which must never be true.

## Tradeoffs & risks

- **A genuine runaway (infinite re-split / retry) is bounded only by wall-clock and
  the dollar ceiling.** Accepted: those are sufficient and are the only bounds tied
  to real cost. The per-iteration wall-clock check inside every loop is the
  infinite-loop backstop.
- **Deep trees can do more total work than a strict reading of any root count
  grant.** Accepted on purpose — cost is bounded by dollars and time, not by a
  retry count laddering to zero.

## Consequences for the build

- **Contract:** `src/contract/goal.ts` — the `Budget` doc comment states the
  principle; the count fields are documented as observability counters that never
  block.
- **Engine:** `src/engine/engine.ts` — the attempt-loop no longer blocks on
  `budget.attempts <= 0`; the token debit sites (step-loop, classic produce, judge)
  emit `budget-exhausted` and continue instead of calling `runBlock`; the
  split-attempt loop drops its `attempts`-based caps (isomorphic-failure and the
  ceiling/deadline checks remain its terminators); `blockOnBudgetExhaustion(...,
  'attempts')` is replaced by `blockOnNonConvergence` / `nonConvergenceBrief`.
- **`enforceToolCallBudget`** stays as an off-by-default diagnostic only.
- **Docs:** `DESIGN.md` budget row rewritten; ADR-007 marked superseded (its
  count-gating, fan-out cap, and "teaches the batching rhythm" claims are no longer
  in force); ADR-030 firmed (its "soft until proven" hedge on `attempts`/`tokens`
  is closed — they are non-blocking permanently); the `diagnose` skill no longer
  frames stopping as "budget discipline."
- **Tests:** engine/step-loop tests that asserted count exhaustion *blocks* are
  rewritten to assert it *emits the signal and continues*.
