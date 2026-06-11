---
id: F-45
title: Mechanical coverage gate + JIT comprehension spawning
iteration: 04-eyes
type: implement
intent: production
status: not-started
dependsOn: []
contracts: [ADR-021, ADR-019]
---

# Feature: Mechanical coverage gate + JIT comprehension spawning

**ID:** F-45 · **Iteration:** 04-eyes · **Status:** Not started

## What this delivers (before → after)

**Before:** the split gate's "do we have enough information?" is a stub;
nothing ever spawns comprehension; verify-on-read fires nowhere.
**After:** the gate runs ADR-021's policy table against the knowledge
projection; misses spawn `map-repo`/`deep-dive-region` children **as
dependencies of the split** (recorded in `gate-checked.missing`); at
decide/split/integrate checkpoints a stale artifact (SHA drift) triggers
self-validation and, on failure, a refresh child — never a silent stale
read. This is DESIGN.md's JIT discovery made real.

## Reading brief

`docs/adrs/ADR-021` (the table + spawn rule), ADR-019 (freshness) ·
DESIGN.md § "The three evals — plus a gate before the split" and
§ "Discovery is just-in-time" · the existing split-gate seam + dependency
scheduler in `src/engine/engine.ts` (`gate-checked` event, contract-children-
first ordering).

## Requirements traced (from the PRD)

AC-15 (comprehension spawned as dependencies; nothing speculative) · AC-16
(stale triggers refresh before the fact is acted on).

## Dependencies / contracts

No hard deps: consumes `projectKnowledge` (F-41) and the policy table by
frozen signatures; the spawned types are F-44's by name (registry lookup at
runtime — scripted tests register stub types). **Touches
`src/engine/engine.ts`** — schedule serially with F-46 (overlap note).

## Acceptance criteria

1. Given a root goal on a repo with no knowledge artifacts, when the gate
   runs, then `gate-checked` records the missing categories and the decided
   split gains `map-repo` children that every other child depends on —
   ordinary dependency machinery sequences them first (AC-15).
2. Given fresh artifacts satisfying the table, then the gate passes with no
   comprehension children and no extra brain calls (the check is mechanical
   — a projection query, not a judge).
3. Given a code-emitting leaf whose scope's region has no dive, then a
   `deep-dive-region` dependency is injected per the table.
4. Given an artifact whose `generatedAtSha` mismatches HEAD at a checkpoint,
   then its self-validation runs; pass → `knowledge-checked(fresh-enough)`
   and proceed; fail → a refresh child is spawned as a dependency and the
   decision waits on it (AC-16) — in no path is the stale value silently
   consumed.
5. Learn-kind goals are exempt (no recursive mapping-to-map).
6. Sandbox-absent/knowledge-absent engines behave byte-identically when no
   coverage policy is configured (regression guard — the gate only engages
   when the run is wired with a knowledge source).

## Build plan (approved)

- [ ] **Policy table + coverage query** — `src/library/coverage.ts`: the
  ADR-021 table + `coverageCheck(goal, knowledge, graph)` returning
  `{ok, missing: CategoryRequirement[]}`. Pure. Tests:
  `tests/library/coverage.test.ts` (every table row, exemptions, scope-aware
  architecture coverage).
- [ ] **Gate integration + dependency injection** — engine split-gate seam:
  run the query when knowledge wiring is present; on misses synthesize
  comprehension ChildPlans (depended-on by all sibling children), emit
  `gate-checked` with `missing`; scripted tests prove sequencing (map
  children complete before the fan-out spawns). Tests:
  `tests/engine/gates.test.ts` extend (AC-1/2/3/5/6).
- [ ] **Checkpoint verify-on-read** — at the existing decide/split/integrate
  checkpoints: SHA-compare consumed artifacts, run self-validation on drift,
  spawn refresh dependency on failure; events recorded. Tests:
  `tests/engine/gates.test.ts` or a focused file (AC-4: both the
  validated-stale-pass and refresh-spawn paths).

### Test strategy

Scripted brains + synthetic knowledge projections + fixture repos for the
SHA-drift cases (commit, then mutate). The regression guard (AC-6) re-runs
the existing engine suite untouched. No network. Per-chunk named files; one
typecheck + full suite at end.
