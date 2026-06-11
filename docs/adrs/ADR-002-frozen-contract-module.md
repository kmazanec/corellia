# ADR-002: `src/contract/` is the frozen contract barrier

**Status:** Accepted · **Date:** 2026-06-10 (decided iteration 1; recorded retroactively) · **Stretch:** no · **Contract:** yes
**Supersedes:** none · **Superseded by:** none

## Context

DESIGN.md's contract-barrier rule: shared shapes freeze first, before fan-out,
carrying every consumer's extension. Building the factory itself with parallel
builders required a concrete realization of that rule in the repo.

## Options considered

- A dedicated `src/contract/` module, frozen per build wave — chosen.
- Types co-located with their owning feature modules — rejected (siblings
  would import each other; the shared shape would have no single author).
- A separate published package — rejected (ceremony without benefit at this
  scale).

## Decision

All shared shapes live in `src/contract/`: `Goal`, `Budget`, `Decision`,
`Report`, `Verdict`/`Finding`, `FactoryEvent`, and the `Brain`, `EventStore`,
`MemoryView`, `PatternStore`, `Registry`, `GoalTypeDef` interfaces. The module
is **frozen per build wave**: it changes only in a dedicated barrier commit
that lands before dependent feature work, updating every consumer atomically.
Feature modules import from the contract; they never define shared shapes.

## Rationale

This is the design's own rule applied to building the design. Two iterations
of 3–4 parallel builders produced zero integration conflicts and zero contract
drift — the barrier is empirically what made wide fan-out safe.

## Tradeoffs & risks

- A mid-wave contract discovery forces either an awkward workaround or a
  wave restart. Mitigation: the plan stage's contract reconciliation exists to
  catch shapes before the wave starts.
- "Frozen" is discipline plus review, not tooling. A lint (no shared-shape
  exports outside `src/contract/`) would mechanize it; not yet built.

## Consequences for the build

- **Source of truth:** `src/contract/*.ts`. Every iteration's plan must list
  its contract changes explicitly; they land first, as one commit, with all
  existing consumers updated.
- Known v2 surface: iteration 3 adds the Tool/broker shapes and amends
  `Brain` (pending ADRs).
