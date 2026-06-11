# ADR-009: Memory promotion/decay is projection policy, not stored state

**Status:** Accepted · **Date:** 2026-06-10 (decided iteration 1; recorded retroactively) · **Stretch:** no · **Contract:** no
**Supersedes:** none · **Superseded by:** none

## Context

DESIGN.md requires provisional→trusted hardening and failure-correlated decay
for fact memories. The question was where that state machine lives: written
into stored memory rows, or computed from the event history.

## Options considered

- Trust state computed by the memory projection from reinforcement events —
  chosen.
- Trust state as a mutable field on stored memories — rejected: state divorced
  from its evidence; ADR-003's whole point is that provenance is a query.

## Decision

Children report `memoriesUsed`; parents write reinforcement events (use +
outcome). The `projectMemory` projection computes trust: a provisional fact
memory becomes trusted after **2** successful uses; **2** failure-correlated
uses decay it out. The thresholds are named constants in the projection —
policy, deliberately tunable, not contract.

**Exception preserved:** structure (split-memos) never auto-hardens —
trust for structure requires human signoff (ADR-011), per the design's
facts-decay/structure-versions rule.

## Rationale

Computing trust from events keeps the causal decay signal honest ("this
memory was used and the goal failed") and makes every trust state auditable
back to the events that produced it. The 2/2 thresholds are starting values
with no empirical basis yet — they exist to make the machinery real; traces
tune them.

## Tradeoffs & risks

- 2 successes is a low bar for "trusted"; a coincidence can harden a mediocre
  fact. Bounded by verify-on-read (a trusted fact is still re-checked against
  the world at moments of trust) — trust affects weight, not exemption.

## Consequences for the build

- **Source of truth:** `src/eventlog/projections.ts` (`projectMemory`).
- Threshold changes are one-line policy edits with test updates — no schema
  or contract change. When thresholds become per-layer or per-type, that's
  still projection policy.
