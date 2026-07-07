---
type: issue
title: Golden candidates never receive outcome labels — calibration data is being lost
description: ADR-024 captures a golden-candidate event at every judge verdict, but nothing wires exogenous outcomes (PR merged/rejected, criteria later proven wrong) back to the candidates, so the calibration set can never be labeled.
tags: [engine, eventlog, golden, calibration, judge]
timestamp: 2026-07-07
status: open
kind: bug
severity: high
---

# Golden candidates never receive outcome labels — calibration data is being lost

## Problem
`appendGoldenCandidate` (src/engine/judge-support.ts) records a candidate at every
judge verdict on non-scripted runs — artifact digest, rubric digest, verdict, tier,
model. ADR-024's premise is that outcome labels "arrive later from exogenous
signals (merge/rejection)". Nothing delivers them: no event type carries a label,
no path correlates a PR merge/rejection or a human verdict back to the candidates
of the tree that produced it. Unlabeled candidates can never become a golden set,
so the exact "unrecoverable cost" ADR-024 warns about — runs happening today whose
ground truth evaporates — is being paid silently on every live run.

## Evidence
- Capture side exists: `appendGoldenCandidate` in src/engine/judge-support.ts, the
  `goldenCandidates` projection at src/eventlog/projections.ts:794, and
  tests/engine/golden-capture.test.ts.
- Label side absent: grep for label/outcome ingestion over src/ and scripts/ finds
  no writer; docs/adrs/ADR-024-golden-capture-as-events.md defers the ceremony but
  the label *ingestion* path was never split out as its own work item.

## Proposed direction
A small, append-only labeling path, exogenous by construction (never another
eval): a `golden-label` event `{candidateRef | treeId, outcome, source, note?}`
appended (a) by a CLI (`corellia label <tree> merged|rejected|...`) for human
verdicts, and (b) later by whatever observes PR merge/rejection (the listener's
merge channel, when it exists). The projection joins labels to candidates by tree
and goal. Keep promotion-to-golden-set a separate deliberate ceremony — this issue
is only about not losing the labels.

## Acceptance hint
After a live run ends in a merged (or rejected) PR, one command (or one observed
event) attaches that outcome to the run's captured candidates, and the
`goldenCandidates` projection shows labeled pairs ready for curation.
