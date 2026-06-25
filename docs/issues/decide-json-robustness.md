---
type: issue
title: "decide-robustness — large/complex root intent makes brain.decide emit malformed JSON"
description: A large free-text root intent inlined into the decide prompt via JSON.stringify makes the model break JSON well-formedness, blocking the tree at decision #1.
tags: [engine, brain, transport]
timestamp: 2026-06-25
status: open
kind: bug
severity: high
---

# decide-robustness — large/complex root intent makes brain.decide emit malformed JSON

## Problem
`brain.decide` embeds the full goal spec into the decide prompt
(`goalContext`, `src/brains/llm.ts:781`: `Spec: ${JSON.stringify(goal.spec, null,
2)}`). When the intent is large and dense (arrows, parentheses, nested quotes, code
snippets), the model breaks its own JSON well-formedness while emitting the decision
— and does so on both the first call and `callJson`'s schema-constrained re-ask, so
the tree **blocks at decision #1** before it ever splits. The block is the factory's
law working correctly (a node that can't decide responsibly blocks), but the cause
is a transport/prompt-shape gap, not a reasoning failure.

## Evidence
the relevant iteration record under docs/iterations/. Event sequence:
`goal-received → risk-classified → pattern-consulted → decided(block)`. Blocker:
*"Decision-maker could not produce a valid decision: Expected double-quoted property
name in JSON at position 1546 (line 1 column 1547)"* — ≈ the embedded ~1583-char
spec length. Same CLASS as prior live:self transport bugs (model/transport issues
masquerading as logic).

## Proposed direction
(a) Don't inline the full free-text spec into the decide prompt — summarize/reference
it, or point the model at the spec file via comprehension rather than echoing it;
(b) a JSON-repair pass before declaring a parse failure; (c) more re-ask attempts
with a shrinking/escaped spec. Orthogonal to the milestone loop — its own iteration.

## Acceptance hint
A large, complex root intent (≈1500+ chars, arrows/quotes/code) commissioned via
`live:self` produces a valid decision and the tree splits instead of blocking at
decision #1.
