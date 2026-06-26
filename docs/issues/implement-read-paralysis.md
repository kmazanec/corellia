---
type: issue
title: "Implement leaf dies on a truncated tool-call (context bloat → malformed JSON → isomorphic block)"
description: A make/implement leaf on a hard task accumulates ~117K tokens of file reads; its tool-call response is then truncated by the output limit, JSON.parse throws Unexpected-end-of-JSON, the step fails repeatedly, and the isomorphic detector blocks it with 0 writes.
tags: [engine, step-loop, llm, truncation, finish-reason, isomorphic-block]
timestamp: 2026-06-25
status: fixed
kind: bug
severity: high
---

# Implement leaf dies on a truncated tool-call (context bloat → malformed JSON → isomorphic block)

> **Fixed by ADR-036 (commit d90c4a8), pending live proof.** The root cause —
> unbounded leaf working memory — is addressed: a leaf now has a `note` scratchpad
> + an engine eviction backstop (transcript capped at 60K est. tokens, oldest raw
> reads stubbed) so it can no longer balloon to truncation. Re-proven by
> re-commissioning slice C once the next live run confirms it.

> **Proven (run #9, live-self-76943fcd).** The comprehension leaf that ran
> (`dive-src-engine`, 34 reads) stayed bounded at 74K tokens (vs run #8's 117K),
> eviction fired 3×, no truncation crash, and it emitted a converged artifact — the
> exact run-#8 balloon/crash is gone. (Slice C still didn't fully build, but for a
> different reason — a comprehension over-split + dependency cascade starved the
> implement leaves before they ran; see the partial-delivery issue. ADR-036's own
> failure mode is fixed.)

> **Corrected root cause (the first cut of this issue was wrong).** Initial read:
> "an implement leaf read-loops without writing because there's no forced-emit
> backstop." On reading the full event trace + `JSON.parse` path, that was a
> symptom, not the cause. The leaf was NOT calmly choosing to keep reading — it was
> **repeatedly trying to act and getting its tool-call responses truncated** under a
> bloated context. The real failure is below.

## Problem
On a hard implement task, a leaf's step-loop context balloons with file reads, and
its tool-call response gets **truncated by the output-token limit**, producing
incomplete JSON. `JSON.parse(wc.function.arguments)` throws `Unexpected end of JSON
input` (`src/brains/llm.ts:366`), the step throws → `runStepLoop` returns
`kind:'failed'` → the same `step-loop:failed` signature **twice** → the
isomorphic-failure detector blocks the leaf with **0 writes**. It is neither
read-paralysis-by-choice nor budget exhaustion: it is a transport/output-size
crash the engine can't distinguish from a genuine logical failure.

Two concrete engine gaps make it terminal rather than recoverable:

1. **No `finish_reason` check.** `translateStepResponse` (`llm.ts`) never inspects
   whether the model stopped on `length` (output truncated → the JSON is cut off,
   not malformed-by-the-model) vs `stop`. It can't tell "your output was cut off,
   the context is too big" from "you emitted bad JSON," so it can't respond
   appropriately (shrink context / re-prompt for a smaller step / force an emit).
2. **A thrown parse error is terminal, not a clean re-prompt.** `translateStepResponse`
   is designed to return `null` on malformed tool-calls so the caller re-prompts —
   but the truncation path surfaces as a *thrown* `JSON.parse` error that escapes to
   the engine as `kind:'failed'`, and the isomorphic detector then treats two such
   failures as non-convergence and blocks. The recovery the design intended
   (re-prompt) is bypassed.

## Evidence
Build run #8 (`live-self-cb6abfc2`, $0.56), slice C (ADR-034 engine integration
steps). The impl leaf trace: decided `satisfy`; 11 steps, ALL `outputKind:
tool-calls` (it kept trying to act); **prompt tokens grew 2.8K → 50K → 107K → 117K**
across steps as reads accumulated; no `budget-exhausted`, no `tier-escalated`, no
`ceiling`. Final report finding: **`"Step loop failed: Unexpected end of JSON
input"`**, blocker `"Isomorphic failure detected (signature: step-loop:failed)"`,
artifact `null`, **0 write_file**. Run #7's slice C: same shape. Origin:
`src/brains/llm.ts:366` (`JSON.parse(wc.function.arguments)`); the failed-step path
at `src/engine/engine.ts` ~2258; the isomorphic block ~920.

## Proposed direction
(Rough, not committed.)
- **Read `finish_reason`.** When a step response has `finish_reason: 'length'`
  (or the provider's truncation signal), treat it as a TRUNCATION incident, not a
  malformed-decision: re-prompt with a "your last output was cut off — make a
  smaller move / emit now" nudge, and/or shed context. Do not let it count toward
  the isomorphic-failure signature as if it were a logical failure.
- **Bound the step-loop context.** ~117K prompt tokens of accumulated reads is the
  proximate trigger. Cap/summarize the read transcript the leaf carries forward
  (it already has a duplicate-read guard; add a context-size guard), so a hard
  implement task does not balloon past the point where outputs truncate.
- **Make a truncated-tool-call recoverable, not terminal.** Route the thrown
  `JSON.parse` truncation through the SAME re-prompt path the `null`-return
  malformed case uses, rather than `kind:'failed'` → isomorphic block.

## Acceptance hint
An implement leaf on a hard multi-file task does not die on a truncated tool-call:
a `finish_reason: length` step is recovered (re-prompt / context-shed / forced
emit) instead of crashing `JSON.parse` and blocking as `step-loop:failed` with 0
writes. Slice C (the ADR-034 engine integration steps) becomes buildable by the
factory.
