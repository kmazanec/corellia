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
