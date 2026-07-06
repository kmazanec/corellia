---
type: adr
title: "ADR-047: a repair rung at the integrate edge fixes cross-module seam bugs"
description: judge-integration finds real cross-module seam bugs at the root, but a leaf is scoped to one area and no rung could commission a cross-cutting fix — so an integration failure was terminal. Add the integrate-edge analogue of the leaf repair rung: on an actionable integration failure, spawn ONE implement child scoped to the union of the failing children's scopes, fed the judge's findings verbatim, then re-run the integration judge once. Escalated findings skip the rung straight to block; a second failure follows today's escalate/block path.
tags: [adr, engine, integration, repair, control-loop, milestone-loop, adr-006, adr-031]
timestamp: 2026-07-06T23:30:00-05:00
---

# ADR-047: a repair rung at the integrate edge fixes cross-module seam bugs

**Status:** Accepted · **Date:** 2026-07-06 · **Stretch:** no · **Contract:** no
**Relates to:** ADR-006 (repair-within-attempt at the leaf), ADR-031 (milestone
loop / integrate edge), ADR-037 (degraded dependency), ADR-043 (integration judge)

## Context

DESIGN.md's control loop is explicit that a failing judge verdict is repaired
before it escalates:

> **fail** → **repair first**: a judge verdict carries **prescriptions** — … a
> cheap-tier fixer applies exactly those edits. … (The fixer is not a new type —
> it is `implement` with a prescription as its spec.)

That rung existed only at the **leaf** (ADR-006, repair-within-attempt). At the
parent's **integrate edge**, `judge-integration` renders an authoritative verdict
over the assembled tree — and it finds real bugs that no single leaf owns, because
each `implement` leaf is scoped to one region and the bug lives at the **seam**
between two of them. With no rung to commission a cross-cutting fix, an integration
failure became a terminal blocker: true findings, no owner, nothing built.

The issue `repair-integration-rung` records the motivating run:

> Run 1 (tiutni) `deliver-intent` blocker: *"Guardrails reject core domain inputs:
> 'single','MFJ','MFS','HoH' wrongly classified; redirect message references
> 'transcript'; budgetExhausted not called; QUESTION_BUDGET absent."* All true bugs
> — but they live at the SEAM between the guardrails leaf and the (never-built)
> orchestrator leaf. The judge saw them; no leaf owned the fix.

## Decision

**Add a repair rung at the integrate edge, the direct analogue of the leaf rung.**
When `judge-integration` fails with actionable findings, before the round blocks:

1. **Spawn ONE repair child**, `implement`-typed (no new goal type, no new
   authority — "the fixer is `implement` with a prescription as its spec"),
   spawned as an ordinary child through the same `buildSplitChildGoals` /
   `child-spawned` path every other child uses.

2. **Scope it to the UNION of the failing children's scopes** — the seam a
   cross-cutting fix is allowed to touch. A child that fixes across two regions
   needs both in scope; the union is exactly that and no more, so the repair stays
   inside the parent's blast radius and passes `filesWithinScope`.

3. **Feed it the judge's findings verbatim** — each finding's dimension, severity,
   title, and prescription rendered into the readable `{ description }` spec the
   producing prompt already understands. The expensive judge prescribes; the cheap
   implement child types.

4. **Re-run the integration judge once** over the repaired tree (re-derived from
   the worktree state, so the re-judge sees the actual repaired files). A pass
   emits the round; a second failure follows today's path — the round blocks with
   the integration blocker, exactly as before the rung existed.

5. **Escalated findings skip the rung straight to block.** A finding flagged
   `escalated` needs a frozen-contract change or a re-architecture — the human's
   call, not a fixer's. That is already the verdict contract's semantics
   (`src/contract/verdict.ts`); the rung respects it: if ANY finding is escalated,
   no repair child is spawned and the round blocks.

Bounded: **one repair per integrate**. The rung does not loop. The milestone loop
above it (ADR-031) already owns multi-round re-planning, and the attempts budget
bounds retries above that; a second in-round repair would duplicate that
machinery. The rung sits *below* the milestone loop, inside a single round's
integrate, and fires for both the plain-split and the per-milestone-round paths
because both flow through `runSplitRound`.

## Rationale

This is not new control-loop policy — it is the *existing* policy (fail → repair →
escalate → block) finally applied at the edge that lacked it. The leaf rung and the
integrate rung now mirror each other: a judge prescribes, a cheap fixer applies, a
re-judge decides. The seam bug that used to be terminal is now ordinary repairable
work, and the tree that did real work in its leaves is no longer thrown away
because the last mile crossed a scope boundary no leaf owned.

Reusing `implement` (rather than adding a `repair-integration` goal type as the
issue's rough sketch proposed) is the smaller, safer change: no new authority, no
constitution surface, no new persona — the fixer is a scoped implement child, which
is what DESIGN.md already says the fixer is. The issue's "a `repair-integration`
goal type" phrasing is a deviation this ADR takes deliberately; the *behavior* the
issue asks for is delivered exactly.

## Alternatives considered

- **A dedicated `repair-integration` goal type** (the issue's sketch). Rejected:
  it would add a new type, its own grants, and a constitution entry for no
  behavioral gain over a scoped `implement` child. DESIGN.md is explicit the fixer
  is not a new type.

- **Loop the repair until it passes or a budget bites.** Rejected: the milestone
  loop already owns iteration across rounds, and unbounded in-round repair is the
  runaway the one-repair-per-integrate bound exists to prevent. One repair, then
  the existing escalate/block path.

- **Repair inside `judgeSplitIntegration`.** Rejected: the judge should render a
  verdict, not spawn work. The rung lives in `runSplitRound` (the integrate
  orchestration), which already owns spawning children and re-deriving the merged
  artifact; the judge stays a pure verdict.

## Consequences

- **Engine:** new `src/engine/repair-integration.ts` (the rung as domain verbs:
  `isRepairableIntegrationVerdict`, `unionScope`, `repairIntegration`).
  `src/engine/split-integration.ts` now returns the structured `Verdict` on its
  `SplitIntegrationJudgment` so the rung can read prescriptions and `escalated`
  flags. `src/engine/split-round.ts` extracts an `integrateAndJudge` helper (merge
  + judge, run once initially and once after repair) and invokes the rung between.
- **Events:** no contract change. The repair child emits the ordinary
  `child-spawned`, and a `repair-applied` event (the existing leaf-rung event)
  records the prescriptions fed to it.
- **Bounded cost:** one extra `implement` child and one extra integration judge
  call per failing integrate, only when the verdict is repairable. Overall tree
  cost stays bounded by the dollar ceiling and the tree deadline (ADR-046).
- **Live proof pending.** The acceptance is observable: an integration failure on
  a cross-module seam bug spawns a scoped repair that re-passes the judge, instead
  of terminally blocking. Unit tests prove the mechanism at the `runSplitRound`
  seam; a live run over a real seam bug is the confirming proof.
