---
type: issue
title: "deliver-intent root that decides satisfy (it has no code tools) loops to a step-loop:failed block"
description: After judge-split rejected its split, a deliver-intent root re-decided satisfy — but deliver-intent has no code tools and structurally cannot satisfy, so it looped the step loop to an isomorphic step-loop:failed block with no PR and nothing built.
tags: [engine, deliver-intent, decide, robustness, milestone-loop]
timestamp: 2026-06-25
status: open
kind: bug
severity: high
---

# deliver-intent root that decides satisfy (it has no code tools) loops to a step-loop:failed block

## Problem
The `deliver-intent` root type **cannot satisfy directly** — by design its grants
are `retrieval.api` + `classify_risk` + `spawn`, no code tools (GOAL-TYPES.md: "the
root literally cannot satisfy directly; the grant enforces it"). Yet after
`judge-split` rejected its first split, the root **re-decided `{"kind":"satisfy"}`**.
With no code tools it produced an empty artifact, the step loop failed repeatedly
with the same signature, the isomorphic-failure detector caught the repetition
(`signature: step-loop:failed`), and the root **blocked** — no PR, nothing built,
zero commits in the worktree.

The decide path coerces a *comprehend-family* block→satisfy (engine.ts ~728, to
force discovery goals to probe before blocking), and `parseDecision` coerces a
childless split→satisfy (a terse "can't decompose" → leaf). Both are correct for
their types. **Neither guard protects the deliver-intent root from the inverse
error: a satisfy it is structurally incapable of fulfilling.** For a type with no
code tools, `satisfy` is never a valid decision — when its split is rejected it must
re-split (informed by the rejection) or block-with-reason, never collapse into
satisfy.

## Evidence
Build run `live-self-3bf0f5b2` (2026-06-25, $0.08), commissioning the full
ADR-034/035 implementation. Event sequence:
`judge-verdict(judge-split, pass=False) → decided(kind=satisfy, children=0) →
step ×6 (all tool-call/step, no code emitted) → emitted({}) → blocked(signature:
step-loop:failed)`. The first split was rejected for good reasons (not vertical
slices); the re-decide collapsed to satisfy instead of producing better slices.
Worktree ended at the same SHA as main (nothing built). Decide path:
`src/engine/engine.ts` (the satisfy/split/block dispatch ~650–760; the analogous
comprehend coercion at ~728).

## Proposed direction
(Rough, not committed.)
- **Guard: a code-tool-less type may not satisfy.** When a goal whose grants
  include no write/code tools (canonically `deliver-intent`) decides `satisfy`,
  treat it as a decode error to correct, not a valid decision — re-ask the decide
  with the split-rejection findings in context to produce a better split, or block
  with an actionable brief ("this root cannot satisfy; it must decompose"). Mirror
  the existing comprehend-family coercion at engine.ts ~728, inverted.
- **Feed the judge-split rejection back into the re-decide.** The re-decide that
  produced `satisfy` may not have carried the judge's "not vertical slices"
  findings, so it had no signal to split better and took the (invalid) easy exit.
  Closely related to the prior decide-skill-injection fix.

## Acceptance hint
A `deliver-intent` root whose split is judge-rejected re-decides into a *better
split* (or a clearly-briefed block), and NEVER into a satisfy it cannot fulfill;
the commission of a large multi-mechanism intent no longer dead-ends at a
`step-loop:failed` block with nothing built.
