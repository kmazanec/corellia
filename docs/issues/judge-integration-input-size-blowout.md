---
type: issue
title: "split-integration judge feeds the whole merged artifact uncapped — exceeds the provider 8 MB input limit and crashes the tree"
description: judgeSplitIntegration passes the full merged child artifact to brain.judge with no size bound; across milestone rounds the merged artifact accretes until the request exceeds the provider's 8 MB text-input limit, returning a terminal HTTP 400 that crashes the entire delivery instead of degrading.
tags: [engine, brain, judge-integration, milestone-loop, working-memory, context, robustness]
timestamp: 2026-06-30
status: open
kind: bug
severity: high
---

# split-integration judge feeds the whole merged artifact uncapped — exceeds the provider 8 MB input limit and crashes the tree

## Problem
`judgeSplitIntegration` (`src/engine/split-integration.ts:108`) passes
`params.artifact` — the **full merged artifact of all the split's children** —
straight to `brain.judge` with no size bound. For a `deliver-intent` split the
merged artifact is the union of every child's files (an ADR, implementation
modules, tests, a fixture, …). Across milestone-loop rounds this artifact only
grows: each round re-integrates and re-judges, so the judge's input accretes
until the request exceeds the **provider's hard 8 MB text-input ceiling**. The
provider returns a terminal `HTTP 400 "The total text input size exceeds 8 MB"`,
which propagates straight up `judge → judgeSplitIntegration → runSplitRound →
runMilestoneLoop → runSandboxedRoot` and **crashes the whole tree**.

Two distinct defects compound:

1. **No input bound on the judge path.** The leaf step loop has a working-memory
   bound (`TRANSCRIPT_TOKEN_CAP`, context eviction — ADR-036), but the
   split-integration *judge* input has no equivalent cap. A growing merged
   artifact silently marches toward the provider ceiling with nothing to stop it.

2. **A terminal provider error is not handled — it kills everything.** An
   8 MB-exceeded `400` is *not* retryable (it will fail identically every time),
   yet it is allowed to abort the entire delivery. The run had done real,
   verified work — 3 rounds, 13 emissions, a complete ADR-042, `worktree-preserved`
   so the work survived — and all of it was lost to an exception instead of the
   round degrading (e.g., the judge bounding/summarizing its input, or treating
   over-limit as a round failure that re-splits smaller).

## Evidence
Commission run `visual-runtime-verification` (run 9b, 2026-06-30, $3.78, ceiling
$40). The tree decomposed correctly and produced a strong ADR-042
(`docs/adrs/ADR-042-runtime-visual-verification.md`, committed at `444a912` in the
preserved worktree). It ran 3 milestone rounds with 13 emissions, then died:

```
LLM request failed (400): {"error":{"message":"The total text input size exceeds 8 MB","code":400}}
  at LlmBrain.callCompletions (src/brains/llm.ts:1139)
  at LlmBrain.callJson (src/brains/llm.ts:1178)
  at LlmBrain.judge (src/brains/llm.ts:1449)
  at judgeSplitIntegration (src/engine/split-integration.ts:133)
  at runSplitRound (src/engine/split-round.ts:98)
  at runMilestoneLoop (src/engine/milestone/loop.ts:86)
```

The failure is deterministic at the round-integration boundary: as rounds
accumulate child artifacts, the merged artifact handed to the integration judge
grows past 8 MB. This was also what made the run *look* stalled for ~80 minutes —
long judge round-trips on an ever-larger payload, not a hang. (Run observability
was separately hardened in commit `fd0d747`: per-run event logs + a live watcher;
that is what made this diagnosis clean.)

## Proposed direction
(Rough, not committed — two separable fixes, mirroring the existing leaf
working-memory discipline.)

- **Bound the integration-judge input.** The judge does not need every byte of
  every child file to rule on whether the integrated artifact satisfies the goal.
  Cap/summarize the merged artifact before it reaches `brain.judge` — the same
  posture as the leaf transcript cap (ADR-036): keep the criteria, the diffs, and
  bounded excerpts; reduce bulk file bodies to references/lengths. The judge rules
  on satisfaction, not on raw content.
- **Make a terminal provider-size error degrade, not crash.** A non-retryable
  `400` (size exceeded) at the integration judge should fail *that round*
  gracefully — surface it as a round failure / actionable blocker that can
  re-split smaller or collect the preserved work — rather than throwing through
  the milestone loop and abandoning a tree that already preserved verified output.
  Same family as [partial-delivery-on-blocked-dependency](partial-delivery-on-blocked-dependency.md)
  and [design-arch-empty-artifact-block](design-arch-empty-artifact-block.md):
  all-or-nothing failure strands good work.

## Acceptance hint
A multi-round `deliver-intent` whose merged artifact would exceed the provider's
input limit completes (or degrades to a clear, actionable blocker that preserves
and reports the work done) instead of crashing with an unhandled HTTP 400; the
integration judge's input is bounded so it cannot grow unboundedly with round
count or child count.
