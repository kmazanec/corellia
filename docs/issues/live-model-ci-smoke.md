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

---

> **Fixed (2026-07-07, branch `issue/ci-smoke`; status stays open pending the
> scheduled-CI live proof).** `npm run smoke:live` (`scripts/smoke-live.ts`) sends
> ONE greeting-sized `deliver-intent` goal end-to-end through `buildLiveEngine`
> against the real low-band model. It is bounded by the existing per-tree dollar
> ceiling (`Goal.spendCeilingUsd`, ADR-017 → `TreeState.ceilingUsd`) defaulted to
> $0.25 and env-overridable via `CORELLIA_SMOKE_CAP_USD`, plus a wall-clock bound
> (`budget.wallClockMs`, default 4 min, `CORELLIA_SMOKE_WALLCLOCK_MS`). It asserts
> only the cheap invariants: the tree completed (report emitted, no blockers), an
> artifact exists, deterministic checks preceded the judge for every judged leaf,
> and reported spend ≤ cap. On any failure it exits nonzero with a readable reason.
>
> **Isolation:** the run targets a THROWAWAY git repo created fresh under the OS
> temp dir (`mkdtemp`, seeded with an empty root commit so the engine can open its
> worktree), never `.corellia/` and never the primary checkout. The temp dir, its
> worktrees, and its `events.jsonl` are removed on exit; `CORELLIA_SMOKE_EVENTS_OUT`
> copies the log out first for CI failure-artifact upload.
>
> **Gating:** a missing `OPENROUTER_API_KEY` prints a SKIP and exits 0 (gating is by
> secret presence). Verified: with the key unset the script self-skips (exit 0).
>
> **Testability:** the pass/fail judgement lives in a pure `assessSmoke`
> (`src/smoke/verdict.ts`) — no I/O, no clock — so the script's verdict is provable
> without spend. `tests/smoke/verdict.test.ts` feeds synthetic event logs and
> asserts each invariant's pass/fail (11 cases, green).
>
> **CI:** `.github/workflows/live-smoke.yml` — a separate, NON-required workflow on
> nightly schedule + `workflow_dispatch` only (never per-push), so real spend and
> real-model flake never block `build-image.yml`. It reports secret presence, skips
> cleanly when the secret is absent, and uploads `smoke-events.jsonl` as an artifact
> only on failure. Adding the `OPENROUTER_API_KEY` repo secret is the operator's
> step (called out in the workflow header).
>
> **Not yet done (why status stays open):** no live run has executed — the key was
> absent from the build env, so the end-to-end greeting-against-a-real-model path is
> proven only by the unit test plus the typecheck/lint gate, not by a real run. The
> confirming proof is the first scheduled `live-smoke` run (or a manual dispatch)
> passing green against the real model with actual spend under the cap.
