---
type: issue
title: Judge calibration by golden-set replay — the eval of the evaluators is unbuilt
description: DESIGN.md requires judges calibrated by replaying pinned golden pairs against exogenous ground truth; capture exists (ADR-024) but no replay/scoring harness does, so all three judges run uncalibrated.
tags: [engine, eval, golden, calibration, judge, replay]
timestamp: 2026-07-07
status: open
kind: future-work
severity: high
---

# Judge calibration by golden-set replay — the eval of the evaluators is unbuilt

## Problem
The three evals are the factory's whole quality thesis, and two of them
(split, integration) plus every critique are LLM-as-judge calls with no
calibration story — exactly the "just vibes" DESIGN.md forbids ("the split and
integration judges have a calibration story, not just vibes", DESIGN.md
"Eval economics"). Nothing replays a curated pair through a judge to measure
agreement, nothing detects judge drift across model/prompt changes, and there is
no promotion ceremony from labeled candidate to pinned golden pair. Until this
exists, every downstream trust mechanism (earned autonomy, tier re-policy,
memo demotion on golden divergence) has no ground to stand on.

## Evidence
- DESIGN.md "Eval economics — judges are calibrated by replay" and "the
  justification regress terminates outside the system".
- Capture-only reality: `goldenCandidates` projection
  (src/eventlog/projections.ts:794), ADR-024; grep confirms no
  replayGolden/calibrate/runGolden anywhere in src/ or scripts/.
- Blocked-on: labeled pairs (see golden-outcome-labels.md) — replay without
  labels can only measure self-consistency, not accuracy.

## Proposed direction
Three pieces, smallest-first: (1) a curation ceremony — a script that promotes a
labeled candidate into a versioned golden set per goal-type (pinned at the SHA it
shipped against), stored as factory-repo fixtures per the epistemic rule
(outcome-only-validatable → versioned code); (2) a replay harness — run a goal
type's golden set through its judge at a given tier/model and score agreement
(per-judge precision/recall against labels); (3) a report surface (a `corellia
calibrate <judge>` command and/or a projection) so drift is a query. Point-in-time
memory rebinding can come later; SHA-pinned artifacts are enough to start.

## Acceptance hint
`corellia calibrate critique-code` (or equivalent) replays that judge's golden
set and prints an agreement score; changing the judge's prompt or model and
re-running shows the score move. At least one judge has a real (if small) golden
set curated from labeled live-run candidates.

---

> **Fixed (2026-07-07, branch `issue/golden-calibration`; pending live proof /
> operator use).** All three smallest-first pieces are built, on top of the label
> ingestion from [[golden-outcome-labels]]. The epistemic rule is honored
> throughout: the golden pair is a versioned factory-repo artifact, and the
> justification regress terminates at the exogenous label — a judge is scored
> against ground truth, never against another eval.
>
> **Mechanism** (all under `src/eval/golden/`):
> 1. **Curation ceremony** (`curate.ts`) — `curateGoldenPair` promotes a labeled
>    candidate into a `GoldenPair` and writes it as a fixture. Because the event
>    log stores only digests (never artifact bodies), curation takes the artifact
>    and rubric bodies explicitly and VERIFIES they hash to the candidate's pinned
>    `artifactDigest` / `rubricDigest` (a mismatch is a hard error — a golden pair
>    whose subject drifted would calibrate against a fiction). The pair is pinned
>    with the ship SHA and the label. Stored under
>    `fixtures/golden/<goalType>/<id>.json` (`golden-store.ts`,
>    `GoldenPair`/`golden-set.ts`).
> 2. **Replay harness** (`replay.ts`) — `replayGoldenSet` runs each pair through
>    `brain.judge` at a given tier and scores the verdict against the label's
>    pass/fail expectation (`merged`/`confirmed` → should pass; `rejected`/`refuted`
>    → should fail; `expectedPass` owns that mapping). Reports agreement (headline
>    accuracy) plus a confusion matrix with precision/recall for the positive
>    class. **The brain is injected**, so tests run a `ScriptedBrain` and never hit
>    a live API.
> 3. **Report surface** (`calibrate-cli.ts`) — `corellia calibrate
>    <judge-or-goal-type> [--tier ...] [--repo ...]` resolves the target's golden
>    set(s) (a goal-type resolves directly; a judge-type scans every goal-type dir
>    for matching pairs), replays, and prints `renderScore`. Live invocation builds
>    an OpenRouter `LlmBrain` (dynamic import); dispatched from `scripts/corellia.ts`.
>
> A committed **seed golden set** exists so calibrate runs out of the box and the
> versioned-artifact home is demonstrably in place:
> `fixtures/golden/implement/clamp-merged-seed.json` (a merged `critique-code`
> pair). "Score moves on a prompt/model change" is proven at the unit level: a
> perfectly-calibrated scripted judge scores agreement 1; an always-pass judge
> scores 0.5 with precision 0.5 on the same set.
>
> **Deviations from the sketch:** (a) curation takes the bodies explicitly rather
> than reconstructing them from the log — the log deliberately does not duplicate
> artifact/rubric bodies (ADR-024), so the operator supplies them and the digest
> check enforces they are the exact judged subject. (b) The golden set is keyed
> by GOAL-TYPE (its judge is derivable), with a judge-type lookup layered on top,
> because a goal-type is the natural fixture directory and one judge can serve
> several goal-types. Point-in-time memory rebinding is left for later, as the
> issue allows; SHA-pinned artifacts are the starting point.
>
> **Tests** (`npx vitest run` green): `tests/eval/golden-calibration.test.ts`
> (curate digest-verification + write, replay confusion-matrix scoring across
> perfect/always-pass/empty sets, `confirmed`/`refuted` mapping, end-to-end);
> `tests/eval/calibrate-cli.test.ts` (arg parse, target resolution by goal-type
> and judge-type, replay through an injected scripted brain, seed-fixture load,
> exit codes). `npx tsc --noEmit` and `npm run lint` clean; `npm run code-shape`
> clean on the new modules. A live `corellia calibrate` against a curated set with
> the real judge brain is the confirming proof.
