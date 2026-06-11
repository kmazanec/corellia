---
id: F-44
title: map-repo + deep-dive-region goal types
iteration: 04-eyes
type: implement
intent: production
status: shipped
dependsOn: []
contracts: [ADR-019, ADR-021]
---

# Feature: `map-repo` + `deep-dive-region` goal types

**ID:** F-44 · **Iteration:** 04-eyes · **Status:** Shipped (build/04-eyes)

## What this delivers (before → after)

**Before:** the learn kind has no real members; the factory cannot produce
knowledge.
**After:** `map-repo` (four categories: `architecture`, `stack`,
`conventions`, `test-scaffold`) and `deep-dive-region` are registered
library types with harness prompts and **deterministic per-category
self-validation**, emitting knowledge artifacts through F-41's write helper.

## Reading brief

GOAL-TYPES.md § learn (the type table — input/output/proof/grants/tiers) ·
`docs/adrs/ADR-019` (artifact shape + validation), ADR-021 (what consumes
which category) · `src/library/starter-types.ts` (registration idiom) ·
`src/library/checks.ts` + `script-runner.ts` (executing-check machinery
from iteration 03).

## Requirements traced (from the PRD)

R11 · AC-15 (the goals the gate spawns) · AC-16 (self-validation is the
recheck).

## Dependencies / contracts

No hard deps: artifact writing via F-41's frozen helper signature (stub in
tests), validation via the existing CheckContext machinery. Registered types
must pass the constitution lints (learn-kind grant ceilings: read-only +
sandboxed validation runs; no product-file writes).

## Acceptance criteria

1. `map-repo` is `leaf_only`, tier haiku→sonnet, grants read-only
   (`fs.read`, `retrieval.api`) + scoped run rights for validation
   (`test.run_scoped`); `lintLibrary` passes with both types registered.
2. Per-category self-validation is deterministic and *executes* where the
   category demands: `architecture` → spot edge queries against a fresh
   scan agree with the artifact's claimed pointers; `stack` → claimed
   versions match manifest/lockfile parse; `conventions` → exemplar pointers
   exist at the artifact's SHA; `test-scaffold` → the declared test script
   actually runs green via `runScriptCheck`.
3. A `map-repo` artifact failing its self-validation cannot emit a passing
   report (the deterministic gate catches it — no judge consulted).
4. `deep-dive-region` outputs facts whose every claim carries `file:line`
   anchors at SHA; the deterministic check verifies anchor existence; facts
   enter project memory provisional.
5. Harness prompts teach the discovery loop (probe → learn → next probe) and
   pointers-not-bodies; scripted-brain runs produce valid artifacts
   end-to-end through the engine's existing leaf path.

## Build plan (approved)

- [x] **Type definitions + harness content** — extend
  `src/library/starter-types.ts` with both types (specs, grants, tiers,
  eval wiring) and their prompt content following the existing type-card
  style. Tests: `tests/library/registry.test.ts` extend (registration,
  lints — AC-1).
- [x] **Per-category validation checks** — `src/library/knowledge-checks.ts`:
  the four category validators as DeterministicChecks (consuming
  CheckContext for the executing ones) + the anchor-existence check for
  dives. Tests: `tests/library/knowledge-checks.test.ts` over fixture repos
  + synthetic artifacts (AC-2/3/4 deterministic halves).
- [x] **End-to-end through the engine (scripted)** — a scripted `map-repo`
  leaf produces an artifact, validation gates it, `knowledge-written` lands;
  a scripted dive produces anchored facts. Tests:
  `tests/engine/engine.test.ts` extend or a small new file (AC-3/5).

### Test strategy

Fixture repos in tmp dirs (reusing iteration-03 patterns), scripted brains
only, validation checks proven red AND green. No network. Per-chunk named
files; one typecheck + full suite at end.

## Implementation notes

Built as planned plus review repairs: one validation root for scan+existence, testScaffoldCheck delegates to runScriptCheck, version claims anchored to `version:<name>@<version>` notes. Post-review live evidence drove two amendments: packaging tolerance (fenced/single-file JSON) in the shared extractArtifactPayload, and map-repo default tier bumped haiku→sonnet (instrumented from four live runs).
