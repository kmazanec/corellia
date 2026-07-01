---
type: adr
title: "ADR-043: bound the integration-judge input, and degrade a terminal provider error instead of crashing the tree"
description: The split-integration judge inlined every file of the merged child artifact with no size bound, so across milestone rounds the input grew past the provider's ~8 MB text-input ceiling and a non-retryable HTTP 400 crashed the whole delivery — abandoning verified, preserved work. Bound the judge's subject section to a byte budget (every path listed, content greedy-then-excerpted), the same "bound the context" posture as ADR-036/041, and make judgeSplitIntegration degrade a terminal provider error to a blocker rather than throw through the milestone loop.
tags: [adr, engine, brain, judge-integration, milestone-loop, context, robustness, adr-031, adr-036, adr-041]
timestamp: 2026-06-30T18:30:00-05:00
---

# ADR-043: bound the integration-judge input, and degrade a terminal provider error

**Status:** Accepted · **Date:** 2026-06-30 · **Stretch:** no · **Contract:** yes
**Relates to:** ADR-031 (milestone loop / ship gate), ADR-036 (leaf working-memory
bound), ADR-041 (bound context not count), ADR-037 (degraded dependency)

## Context

The milestone loop (ADR-031) re-integrates a split's children each round and, at
the integration edge, runs `judge-integration` over the merged artifact. For a
`deliver-intent` split the merged artifact is the union of every child's files —
an ADR, implementation modules, tests, a fixture. `judgeSplitIntegration`
(`src/engine/split-integration.ts`) passed that artifact straight to
`brain.judge`, whose `subjectSummary` inlined **every file's full content** with
no size bound (`src/brains/llm.ts`).

Across rounds this only grows, and there was nothing to stop it. The leaf
step-loop had a working-memory bound (ADR-036) and a context bound (ADR-041); the
**integration-judge input had none**. It marched toward the provider's hard
text-input ceiling until the request exceeded it.

Commission run `visual-runtime-verification` (run 9b, 2026-06-30) made this
concrete: the tree decomposed correctly, authored ADR-042, ran 3 rounds with 13
child emissions ($3.78 spend against a $40 ceiling), then died:

```
LLM request failed (400): "The total text input size exceeds 8 MB"
  at LlmBrain.judge → judgeSplitIntegration → runSplitRound → runMilestoneLoop
```

Two defects compounded:

1. **No input bound on the judge path.** A verdict on "does the integrated
   artifact satisfy the goal?" does not need every byte of every file — but the
   judge was fed exactly that, unbounded, growing with round and child count.
2. **A terminal provider error crashed everything.** An 8 MB-exceeded `400` is not
   retryable (identical on retry), yet it propagated as an unhandled exception
   through the milestone loop, abandoning a tree that had already done real,
   verified, `worktree-preserved` work.

## Decision

**1. Bound the integration-judge input to a byte budget.** A new
`summarizeJudgeSubject` (`src/brains/judge-subject-summary.ts`) renders the
SUBJECT ARTIFACT block within a fixed byte budget (`JUDGE_SUBJECT_BYTE_BUDGET`,
well under the provider ceiling so the rubric, goal context, and memories fit in
the remaining headroom). Every file PATH is always listed — the judge must see
the shape of what was integrated even when content is elided — and full content
is included greedily until the budget is reached; thereafter each file is reduced
to its path, byte length, and a head excerpt. A merged artifact that fits is
rendered exactly as before; elision only engages once the total would exceed the
budget. `brain.judge` calls it instead of inlining files directly.

This is the same insight as ADR-036 and ADR-041 — **bound the context, not a
proxy** — applied to the one input path those ADRs did not cover: the integration
judge. The bound is on total bytes, and the reduction keeps signal (paths + head
excerpts) rather than blind truncation.

**2. Degrade a terminal provider error to a blocker.** `judgeSplitIntegration`
wraps the `brain.judge` call: a terminal provider error — a 4xx surfaced as
`LLM request failed (<status>)` — is caught and returned as a blocker/finding, so
the round fails gracefully and the work can be collected and reported, instead of
throwing through the milestone loop. A non-provider error (a genuine bug) still
propagates. This is defense-in-depth: with the input bound in place the 8 MB case
should not recur, but a terminal size error on any judge path must never again
abandon preserved work — the same posture as ADR-037's "a blocked dependency that
produced a usable partial does not cascade-block."

## Options considered

### A. Bound the subject summary + degrade on terminal error — chosen
The minimal fix at the exact defect: one summarizer, one catch. Keeps the judge's
verdict meaningful (paths + excerpts), keeps the fix local to the brain and the
integration edge, and matches the existing "bound the context" family.

### B. Summarize the merged artifact before it reaches the judge (a pre-pass) — rejected
A separate summarization leaf/step over the merged artifact. Rejected: it adds a
model call and a new failure surface to fix a plumbing problem that a
deterministic byte-bound solves. The judge does not need a curated summary; it
needs a bounded input.

### C. Raise/route around the provider ceiling (chunk the judge over N calls) — rejected
Split the judge input across several requests and combine verdicts. Rejected as
premature: it multiplies judge cost and complexity for a case the byte-bound
removes, and a multi-call judge fragments the single pass/fail the ship gate
depends on (ADR-031 §4). The bound keeps one judge call with one verdict.

## Consequences

- **Brain:** `src/brains/judge-subject-summary.ts` — `summarizeJudgeSubject` +
  `JUDGE_SUBJECT_BYTE_BUDGET`; `src/brains/llm.ts` `judge` calls it in place of
  inlining files.
- **Engine:** `src/engine/split-integration.ts` — `judgeSplitIntegration` catches
  a terminal provider error (`isTerminalProviderError`, a 4xx `LLM request failed`
  match) and returns it as a blocker; non-provider errors re-throw.
- **Additive:** a merged artifact under budget is rendered identically to before;
  only over-budget inputs are elided. Every other judge caller is unchanged.
- **Tests:** `tests/brains/judge-subject-summary.test.ts` (bound + path-listing +
  excerpt behavior); `tests/engine/split-integration.test.ts` (degrade-on-terminal,
  re-throw-on-other).

## Tradeoffs & risks

- **The judge sees excerpts, not full content, for an over-budget artifact.** A
  verdict on a very large integrated artifact rules on paths + head excerpts of
  the tail files. This is the safe direction — a judge that cannot see enough
  fails the round, which re-splits or blocks — and in practice most integrated
  artifacts fit the budget. If a class of goal routinely exceeds it, the signal is
  to split smaller (the deliver-intent granularity rule), not to raise the bound.
- **The degrade path trusts the error-message shape.** `isTerminalProviderError`
  matches `LLM request failed (<4xx>)`. If the brain's transport error surface
  changes, the match must move with it; the fix is local and covered by a test
  asserting a non-provider error still throws.
