---
type: issue
title: "An author leaf (author-acceptance-criteria) dies at its first step with step-loop:failed — 0 steps, 0 tools, 0 produced"
description: A leaf decides satisfy then emits step-loop:failed (isomorphic block) before running a single step or tool call — a malformed/truncated first-step response the isomorphic detector cannot distinguish from a logic failure. Not a context balloon. Blocks slice C by killing its acceptance-criteria author, which cascade-blocks the implement leaves.
tags: [engine, step-loop, author, isomorphic-block, first-step, truncation, finish-reason]
timestamp: 2026-06-26
status: open
kind: bug
severity: high
---

# An author leaf dies at its first step with step-loop:failed — 0 steps, 0 tools, 0 produced

## Problem
A leaf decides `satisfy`, then emits `step-loop:failed` (isomorphic block) **before
running a single `step`, `tool-call`, or `produced` event**. The step loop's first
`brain.step` call fails (a thrown error — almost certainly a `JSON.parse` on a
malformed/truncated tool-call response, the same transport class as
implement-read-paralysis), the step returns `kind:'failed'`, the SAME
`step-loop:failed` signature repeats, and the isomorphic-failure detector blocks the
leaf with nothing produced.

This is **not** a context balloon — ADR-036 is intact (the leaf failed at step *one*,
with no reads accumulated; 5 sibling comprehension dives in the same run succeeded
bounded). It is the still-open half of
the former implement-read-paralysis issue (now [ADR-036](../adrs/ADR-036-leaf-working-memory-bound.md)): that issue's ADR-036 fix
addressed *ballooning to truncation*, but a leaf can ALSO get a malformed/truncated
response on its **very first** step — before any bloat — and the engine still cannot
tell "your output was cut off / malformed transport" from "you logically failed," so
it counts two such failures as non-convergence and blocks. The `finish_reason` /
recoverable-truncation direction proposed in implement-read-paralysis was never built;
this is where that gap now bites.

## Evidence
Build run `live-self-481afacb` ($0.78, isolated store `out/slicec-adr037-run/`), slice
C (the ADR-034 lifecycle steps). The root split correctly (5 dives →
`author-acceptance-criteria` → 2 `implement` → `open-pr`) and ran the milestone loop
for 2 rounds. The `author-acceptance-criteria` leaf (`c1` in round 0, `a0` in round 1)
emitted, in full: `goal-received` → `risk-classified` → `decided: satisfy` →
`blocked` → `emitted` blockers=`["Isomorphic failure detected (signature:
step-loop:failed) — escalating to block"]`. **No `step`, no `tool-call`, no
`produced`.** Both rounds, same shape. Its failure cascade-blocked the implement leaves
(correctly, via ADR-037's fatal `artifact === null` branch — they depended on an
author that produced nothing), and the loop halted on `judge-acceptance: no shippable
verdict`. The isomorphic block path: `src/engine/engine.ts` (~the step-loop failed
path + isomorphic detector); the likely throw origin: `src/brains/llm.ts`
(`JSON.parse` of a tool-call's `function.arguments`).

## Proposed direction
(Rough, not committed.)
- **Distinguish a transport/parse failure from a logical step failure.** A first-step
  `brain.step` that throws on malformed/truncated JSON should NOT feed the
  `step-loop:failed` isomorphic signature as if it were a logical non-convergence.
  Read the provider's `finish_reason`; on `length`/truncation (or a parse throw),
  route to the existing re-prompt/repair path with a "your last output was cut off —
  make a smaller move / emit now" nudge, rather than `kind:'failed'` → isomorphic
  block. (This is implement-read-paralysis's unbuilt `finish_reason` direction.)
- **A leaf that has run zero steps cannot be "isomorphic-failed" yet.** Consider not
  counting a pre-first-step throw toward the isomorphic signature at all — there is no
  prior attempt to be isomorphic *to*. Give it at least one genuine re-prompt before
  the detector engages.
- Confirm the throw site by capturing the raw wire response (per the debug-from-
  evidence discipline) before theorizing — a truncated tool-call vs a provider error
  vs a schema mismatch each want a different fix.

## Acceptance hint
An author (or any) leaf whose first `brain.step` returns a malformed/truncated
response is recovered (re-prompt / finish_reason-aware) and runs at least one real
step, instead of emitting `step-loop:failed` with 0 steps / 0 tools / 0 produced and
isomorphic-blocking. Slice C's `author-acceptance-criteria` reaches a produced artifact
so the implement leaves can build on it.
