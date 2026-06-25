---
type: adr
title: "ADR-024: Golden-set capture is an event projection; curation is human"
description: Golden-set calibration data is captured as a golden-candidate event member and projection, with curation left to humans, so judge calibration data accrues from the start.
tags: [adr, golden-set, calibration, judges, event-projection]
timestamp: 2026-06-11T17:57:41-05:00
---

# ADR-024: Golden-set capture is an event projection; curation is human

**Status:** Accepted · **Date:** 2026-06-11 · **Stretch:** no · **Contract:** yes
**Supersedes:** none · **Superseded by:** none

## Context

DESIGN.md: judges are calibrated by replay against exogenous ground truth
(merged PRs, human verdicts) — never another eval. Iteration 05 starts the
data accruing. The capture needs a home.

## Options considered

- **A `golden-candidate` event member + projection** — chosen (ADR-003: one
  substrate, provenance and point-in-time replay free).
- Files per golden case — rejected (a second store).
- Defer entirely — rejected: calibration data compounds; starting late is
  the one unrecoverable cost.

## Decision

Every judge verdict on a real (non-scripted) run appends a
`golden-candidate` event referencing the judged context (goal id, artifact
digest, rubric, verdict, tier, model binding). A `goldenCandidates`
projection collects them per goal-type. Outcome labels arrive later from
exogenous signals (the operator's merge/rejection of the eventual PR) and
human curation — promotion to an actual golden *set* is a deliberate
ceremony, not automatic.

## Tradeoffs & risks

- Candidates without outcomes accumulate; that is fine — the projection
  filters, the log remembers, and curation prunes.

## Consequences for the build

- Barrier: one additive event member; projection beside the others;
  capture wired where judge verdicts are emitted.
