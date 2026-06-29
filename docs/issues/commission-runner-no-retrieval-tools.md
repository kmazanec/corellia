---
type: issue
title: "commission:run did not register retrieval tools — leaves granted retrieval.api get every call refused"
description: examples/run-commission.ts built the live engine without sandbox.knowledge, so the five retrieval tools (find_symbol/find_exemplar/conventions_for/stack_versions/impact) were never registered; the author-acceptance-criteria leaf had all its tool calls refused as "not registered in this broker" and isomorphic-blocked. Fixed by setting sandbox.knowledge:true.
tags: [harness, commission, broker, retrieval, knowledge, tool-registration, bootstrap]
timestamp: 2026-06-28
status: open
kind: bug
severity: high
---

# commission:run did not register retrieval tools

## Problem
`examples/run-commission.ts` built the engine with
`buildLiveEngine({ store, sandbox: { repoRoot, declaredScripts }, goldenCapture })`
— omitting `sandbox.knowledge: true`. The broker registers the five retrieval
ToolImpls (`find_symbol`, `find_exemplar`, `conventions_for`, `stack_versions`,
`impact`) only when `sandbox.knowledge` is set (`src/engine/assembly.ts`). So any
leaf whose type grants `retrieval.api` — e.g. `author-acceptance-criteria` — finds
those tools "not registered in this broker" and every call is refused.

This is the same family as the earlier (resolved) `commission-runner-wires-no-broker`
gap, one layer deeper: the broker exists, but a whole tool class it should carry
was never wired. The runner keeps under-wiring the engine relative to the real
front door.

## Evidence
Third live run of `visual-runtime-verification` (2026-06-28, $40 ceiling, spend
~$0.21). Tree decomposed to two `author-acceptance-criteria` leaves; the producing
leaf (`c1`) made 9 steps of retrieval calls, **all refused**, then blocked:

```
8x  tool "find_symbol" is not registered in this broker
4x  tool "find_exemplar" is not registered in this broker
4x  tool "stack_versions" is not registered in this broker
4x  tool "conventions_for" is not registered in this broker
2x  tool "impact" is not registered in this broker
```

(Surfaced directly by the new structured tool-call arg logging — the refusal
reasons named the cause in one read.) Cascaded to
`Isomorphic failure detected (signature: step-loop:failed)` and
`judge-acceptance did not pass: no shippable verdict`. Output under
`out/commission-visual-runtime-verification.run3-*`.

## Fix
`examples/run-commission.ts` now builds the sandbox with `knowledge: true`, so the
retrieval tools are registered for leaves that need them. (The top-level
coverage-gate `knowledge` stays off, matching live-self's deliver-run posture.)

## Acceptance hint
A re-run gets an `author-acceptance-criteria` (or any `retrieval.api`) leaf whose
retrieval calls RUN instead of being refused, and the tree proceeds past it.
Close once the re-run confirms.

## Follow-on
The runner has now under-wired the engine twice (broker, then retrieval tools).
Consider a shared "full live commission engine" builder or a default in
`buildLiveEngine` so the commission path cannot drift from the real front door's
wiring again.
