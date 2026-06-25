---
type: adr
title: "ADR-011: Split-memo matching by spec-shape signature; trusted walks verbatim; only humans trust"
description: The structure flywheel matches splits by a deterministic specShape signature, trusted memos replay verbatim, and only a human may promote a memo to trusted.
tags: [adr, flywheel, split-memo, spec-shape, trust]
timestamp: 2026-06-10T21:16:39-05:00
---

# ADR-011: Split-memo matching by spec-shape signature; trusted walks verbatim; only humans trust

**Status:** Accepted · **Date:** 2026-06-10 (decided iteration 2; recorded retroactively) · **Stretch:** no · **Contract:** yes
**Supersedes:** none · **Superseded by:** none

## Context

The structure flywheel (DESIGN.md "Memoized splits") needed implementation
choices: how a node recognizes "this goal matches a known split shape," what
consulting a memo means at each trust level, and who may promote.

## Options considered

- Deterministic `specShape` signature (normalized structural fingerprint of
  the typed spec) as the match key — chosen.
- LLM-judged similarity matching — rejected for v1: nondeterministic matching
  makes "replays bind the same shape" impossible to guarantee.
- Allowing the engine to promote a memo to trusted after N clean walks —
  rejected: trusting structure is the design's canonical authority-gap act;
  no outcome statistic underwrites it.

## Decision

Splits are memoized under a `specShape` signature. Consultation by trust
level: a **trusted** memo is walked verbatim — derivation skipped, but the
split eval still runs (judgment is never skipped); a **provisional** memo
arrives as a `patternHint` in `BrainContext` — a suggestion the fresh
derivation weighs. Promotion to trusted exists only as
`PatternStore.promote(shape, 'trusted')`, called solely by the human ceremony
— no engine code path invokes it. Recurrence detection (autonomous →
provisional) and demotion-by-decision complete the lifecycle.

## Rationale

Deterministic matching is what makes memoized splits *reproducible* — the
flywheel's entire value over re-derivation. Keeping judgment unskipped on
trusted walks is the safety net for the known signature-collision risk.

## Tradeoffs & risks

- `specShape` collisions could walk a wrong trusted memo; the split eval is
  the designed safety net. Named sharp edge.
- The promotion ceremony has no surface yet (CLI vs PR-style review —
  open question, ride-along).

## Consequences for the build

- **Source of truth:** `src/contract/pattern.ts` (SplitMemo/PatternStore,
  frozen), `src/flywheel/shape.ts` (signature), consultation in
  `src/engine/engine.ts`, stores in `src/substrate/`.
- Any future promotion surface calls the existing API; it must record the
  signoff as an event (`signed_off_by` provenance).
