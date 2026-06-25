---
type: issue
title: "A4. The integration judge finds REAL cross-module bugs but no rung can fix them across leaf boundaries"
description: judge-integration finds true seam bugs but no rung can commission a cross-cutting repair, so integration findings become a terminal blocker.
tags: [in-run-stall, engine, integration]
timestamp: 2026-06-25
status: open
kind: idea
severity: medium
---

# A4. The integration judge finds REAL cross-module bugs but no rung can fix them across leaf boundaries

## Problem
`implement` leaves are scoped to one area; `judge-integration` runs after, at the
root, with no rung that can commission a cross-cutting repair against the integrated
tree. Integration findings become a terminal blocker, not new work.

## Evidence
Run 1 (tiutni) `deliver-intent` blocker: *"Guardrails reject core domain inputs:
'single','MFJ','MFS','HoH' wrongly classified; redirect message references
'transcript'; budgetExhausted not called; QUESTION_BUDGET absent."* All true bugs —
but they live at the SEAM between the guardrails leaf and the (never-built)
orchestrator leaf. The judge saw them; no leaf owned the fix. Source:
the gap-audit iteration (docs/iterations/2026-06-24-01-gap-audit-tiutni/index.md).

## Proposed direction
A `repair-integration` goal type the root can spawn when `judge-integration` fails —
scoped to the union of the failing modules, fed the judge's findings, allowed to
edit across the seam. (Intra-delivery, before the PR — distinct from the deferred
post-PR improvement loop.)

## Acceptance hint
When `judge-integration` fails on cross-module seam bugs, the root spawns a
`repair-integration` goal scoped to the failing modules that fixes the seam and
re-passes the judge, instead of terminally blocking.
