---
type: issue
title: Screenshot-judge call site never sets needs.vision
description: The model catalog resolves needs.vision, but the ADR-042 screenshot-judge call site doesn't declare it, so visual verification can land on a non-vision model.
tags: [brain, model-catalog, vision, critique-ui, judge]
timestamp: 2026-07-07
status: open
kind: bug
severity: low
---

# Screenshot-judge call site never sets needs.vision

## Problem
ADR-044's capability-tagged catalog resolves `needs.vision` correctly, but the
ADR-042 visual-verification call site — the judge that looks at captured
screenshots — never sets it. The seam was recorded in ADR-044 as known-unwired.
Until it is set, a screenshot judgment can resolve to a text-only model, which
either errors or (worse) judges images it cannot see.

## Evidence
- ADR-044 records the gap explicitly; iteration 21 "still open" list
  (docs/iterations/2026-07-06-19-cloud-ready-wave/index.md) names "vision wiring
  gap: catalog resolves needs.vision but the ADR-042 screenshot-judge call site
  doesn't set it."

## Proposed direction
Set `needs: {vision: true}` on the brain request wherever screenshot inputs are
attached to a judge call, and add a test asserting a vision-needing judge request
resolves only to vision-capable catalog entries.

## Acceptance hint
The screenshot-judge path declares vision in its needs; a unit test proves the
resolved model for that call site is vision-capable, and a non-vision catalog
band is skipped past rather than selected.
