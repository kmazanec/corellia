---
type: issue
title: No real-model smoke test — CI never exercises a live brain
description: Every automated test uses ScriptedBrain; prompt, skill, catalog, and tier-wiring regressions are invisible until an operator manually runs a live harness.
tags: [tests, ci, brain, live-proof, smoke]
timestamp: 2026-07-07
status: open
kind: future-work
severity: medium
---

# No real-model smoke test — CI never exercises a live brain

## Problem
The 160-file vitest suite proves the loop's plumbing (sequencing, gates, repair
rungs) against `ScriptedBrain`, and the `live:*` harnesses prove real behavior —
but the latter are operator-run and ungated. Nothing automated ever sends one
prompt to one real model. A regression in a skill file, the model catalog, prompt
assembly, or OpenRouter request encoding ships silently past `npm test` and is
discovered mid-live-run, where diagnosis is expensive and the failure burns a
real commission.

## Evidence
- eval-scout sweep (2026-07-07): tests/brains/llm.test.ts:21 stubs fetchImpl; no
  test hits a real API; examples/live-self.ts header states it is not CI-gated.
- .github/workflows/build-image.yml runs lint → typecheck → vitest only.

## Proposed direction
One tiny end-to-end goal (greeting-sized, low band, budget-capped at a few cents)
runnable as `npm run smoke:live`, asserting only cheap invariants: tree completes,
an artifact exists, deterministic checks ran before the judge, spend below the
cap. In CI, a separate non-required job gated on secret presence (skip cleanly
when `OPENROUTER_API_KEY` is absent), scheduled (nightly) or manually dispatched
rather than per-push, so flake and spend never block the main gate. Adding the
secret to the repo is an operator step and stays out of scope.

## Acceptance hint
`npm run smoke:live` with a key runs one real-model goal end-to-end under a
declared cost cap and exits nonzero on failure; the CI workflow runs it on
schedule/dispatch when the secret exists and skips (not fails) when it doesn't.
