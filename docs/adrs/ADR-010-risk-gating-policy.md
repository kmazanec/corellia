# ADR-010: Risk gates fail-safe; 'high' gates, 'medium' records (v1 policy)

**Status:** Accepted · **Date:** 2026-06-10 (decided iteration 2; recorded retroactively) · **Stretch:** no · **Contract:** no
**Supersedes:** none · **Superseded by:** none

## Context

DESIGN.md computes instance risk from scope × sensitivity and gates on type ∨
instance. Implementation needed concrete policy: which risk classes gate, what
happens with no human attached, and how sensitivity is matched.

## Options considered

- High + type-gated → authority gate, default-denied without a handler;
  medium → recorded, not gated — chosen.
- Gate medium too — rejected for v1: with substring sensitivity matching
  (below), medium fires often enough to make the gate noise, and noise
  trains the operator to rubber-stamp.
- Default-allow when no authority handler is attached — rejected outright:
  a fail-open authority gate is not an authority gate.

## Decision

`classifyRisk` runs over declared scope at goal entry and over the **actual**
artifact paths at emission (scope escape cannot bypass it). Goals classified
'high' — or whose type is statically `gated` — hit the authority gate, which
**fails safe**: no installed authority means denied. 'medium' is recorded as
an event for trace analysis but does not gate, explicitly marked as v1 policy
in code. The constitution lint runs at Engine construction, rejecting library
violations before any goal runs.

## Rationale

The authority gap is "consequences outrun what any eval can underwrite" — a
gate that opens when nobody's listening underwrites nothing. The
medium-records policy buys signal (traces show what medium *would* gate) for
the earned-autonomy tuning the design calls for, without paying noise now.

## Tradeoffs & risks

- Sensitivity matching is substring-based and over-gates (`author.md` matches
  `auth`) — conservative direction, named sharp edge, segment-boundary
  matching is the tuning pass.
- 'medium' not gating means a misclassified high-risk instance can pass with
  only a record. Mitigated by type-level `gated` as the static backstop.

## Consequences for the build

- **Source of truth:** `src/library/risk.ts` (classifier + default
  sensitivity), authority gate + emission re-check in `src/engine/engine.ts`,
  `src/library/constitution.ts` (lints).
- Tuning sensitivity or promoting 'medium' to gating is policy-table work,
  not engine work — keep it that way.
