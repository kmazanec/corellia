# ADR-021: The split gate's coverage check is a per-kind policy table; misses spawn dependencies

**Status:** Accepted · **Date:** 2026-06-11 · **Stretch:** no · **Contract:** no
**Supersedes:** none · **Superseded by:** none

## Context

DESIGN.md: the split gate asks "do we have enough information to decompose?"
as a mechanical coverage query against the knowledge artifacts; discoverable
misses spawn JIT comprehension goals *as dependencies*. Iteration 04 must
make "coverage" concrete.

## Options considered

- A small per-kind/per-type **policy table** mapping goal classes to required
  fresh categories — chosen.
- Per-goal LLM judgment of sufficiency — rejected for the gate itself (the
  design demands the *gate* be mechanical; the split eval remains the
  judgment layer above it).
- Block-and-ask the human on misses — rejected by design: the factory never
  asks for what it can go find.

## Decision

A named policy table (library code, not contract):

| Goal class | Required fresh categories |
| --- | --- |
| root split on a repo | `architecture`, `stack` |
| code-emitting leaf (make kind) | `architecture` covering its scope, `conventions`, region dive for touched regions |
| characterize / test work | the above + `test-scaffold` |
| learn-kind goals | none (they ARE the coverage) |

"Fresh" = ADR-019's checkpoint rule (SHA match, or self-validation passes).
A miss spawns the corresponding `map-repo`/`deep-dive-region` children **as
dependencies of the split** (gate-checked event records `missing[]`); the
node splits once they return. The table's strictness is tuned from traces —
v1 errs minimal (the four shipped categories only).

## Rationale

The gate stays cheap and auditable ("why did this spawn a map?" is a table
lookup plus an event), and JIT comprehension stays the only discovery
trigger — no bootstrap re-enters through a side door.

## Tradeoffs & risks

- A too-lenient table lets under-informed splits through — caught by the
  split eval (the judgment layer), logged for tuning.
- A too-strict table over-maps — bounded by the four-category v1 set and by
  map goals being cheap-tier leaves.

## Consequences for the build

- **Source of truth:** the policy table beside the gate logic; the existing
  `gate-checked` event member carries `missing[]` (no event change needed).
- The engine's split-gate seam gains the coverage query + dependency
  injection of comprehension children; verify-on-read fires at the existing
  decide/split/integrate checkpoints.
