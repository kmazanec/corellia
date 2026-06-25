---
id: F-53
title: write-prd, design-arch, research-external, investigate
iteration: 05-taste
type: implement
intent: production
status: shipped
dependsOn: []
contracts: [ADR-022, ADR-023]
---

# Feature: The PM/discovery types

**After:** write-prd (the senior-PM interview craft, four pillars,
Given/When/Then criteria — emits a PRD-shaped artifact with outputSchema),
design-arch (ADR format, terraced-scan default policy per DESIGN.md, losing
candidates → alternatives-considered, Contract:yes flagging), 
research-external (cited findings, ≥2-source corroboration, ONE batched
skeptic, confidence flags — provisional facts), investigate (non-leaf
diagnose: spawns dives/research/spike-implements; evidence-chain proof;
budget-bounded chain) — registered with family skill files per the GOAL-TYPES
cards and seed table, deterministic checks for shape + citations-present +
anchors where applicable, scripted engine-path tests red+green per type.

Constitution lints must pass (kind ceilings; investigate is the one
non-leaf). Tier/grants per GOAL-TYPES. Files: new family modules + skills/
files only (no engine, no contract).

## Build plan (approved)
- [x] write-prd + design-arch (+ scan policy wiring on the type card) +
  checks + scripted tests.
- [x] research-external + investigate (+ spawn grants) + checks + tests.

## Implementation notes

Built per GOAL-TYPES rows; families author/research/diagnose. Strict pins + judgeType lint added at review. investigate's judgeType=critique-doc resolved at fold.
