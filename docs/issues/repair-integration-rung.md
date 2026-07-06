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

---

> **Fixed (2026-07-06, ADR-047, branch `feat/repair-integration`; pending live
> proof).** The integrate edge now has a repair rung — the direct analogue of the
> leaf repair rung (ADR-006), the control loop DESIGN.md always specified
> ("fail → repair first … the fixer is `implement` with a prescription as its
> spec"). When `judge-integration` fails with actionable findings, `runSplitRound`
> spawns ONE `implement` child scoped to the UNION of the failing children's
> scopes, fed the judge's findings verbatim, then re-runs the integration judge
> once. A pass emits the round; a second failure follows the existing
> escalate/block path (one repair per integrate — the milestone loop above and the
> attempts budget bound retries). Findings flagged `escalated` (frozen-contract
> change) skip the rung straight to block, per the verdict contract.
>
> **Deviation from the sketch above:** the fixer reuses the existing `implement`
> type rather than a new `repair-integration` goal type — no new authority, no
> constitution surface, exactly as DESIGN.md prescribes ("the fixer is not a new
> type"). The behavior the issue asks for is delivered as specified.
>
> Mechanism in `src/engine/repair-integration.ts` (rung), `split-integration.ts`
> (returns the structured verdict), `split-round.ts` (the `integrateAndJudge`
> helper + rung wiring). Unit-proven at the `runSplitRound` seam
> (`tests/engine/repair-integration.test.ts`): integration-fails → repair child
> spawned with union scope + findings in spec → re-judge passes → root emits;
> repair fails again → blocks as today; escalated finding → no repair child. A live
> run over a real seam bug is the confirming proof.
