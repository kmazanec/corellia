---
id: F-46
title: "Assembly: eyes wired + convergence"
iteration: 04-eyes
type: implement
intent: production
status: shipped
dependsOn: [F-41, F-42, F-43, F-44, F-45]
contracts: [ADR-019, ADR-020, ADR-021]
---

# Feature: Assembly — eyes wired + the convergence checks

**ID:** F-46 · **Iteration:** 04-eyes · **Status:** Shipped (build/04-eyes)
*(The lesson of iteration 03, pre-applied: integration has an explicit
owner with honest hard deps.)*

## What this delivers (before → after)

**Before:** five green modules — store, scanner, retrieval, learn types,
coverage gate — that nothing composes.
**After:** the sandbox assembly wires them: retrieval ToolImpls registered
in the broker, the knowledge projection + import scan supplied to the
coverage gate, comprehension children running through the real leaf path —
proven by a **scripted full-stack convergence test** and the **live
`npm run live:eyes` demo** against corellia itself plus a foreign-repo
mapping run.

## Reading brief

`docs/iterations/04-eyes/BUILD-PLAN-04-eyes.md` (frozen surfaces + resolved
decisions) · `src/engine/assembly.ts` (the iteration-03 composition root
this extends) · the five sibling specs' exported surfaces.

## Requirements traced (from the PRD)

AC-15, AC-16 end-to-end · the iteration done-when (ROADMAP) · early AC-3
evidence (foreign-repo mapping, read-only).

## Dependencies (must exist before this starts)

F-41..F-45 — genuine hard deps: this wires their implementations.
**Touches `src/engine/engine.ts` + `assembly.ts`** — serial after F-45.

## Acceptance criteria

1. Sandbox assembly extended with knowledge wiring: retrieval tools in the
   broker table (under `retrieval.api`), `projectKnowledge` + a current
   `ImportGraph` supplied to the coverage gate and checkpoints; knowledge
   wiring absent → byte-identical iteration-03 behavior.
2. **Scripted convergence** (zero network): a root intent on a fixture repo
   with NO artifacts → gate spawns `map-repo` children as dependencies →
   scripted map leaves write validated artifacts → the split proceeds → a
   code leaf **consults `impact()` through the broker before its first
   write** (assert tool-call event ordering) → SHA drift mid-run triggers
   validation + refresh (AC-16 path) → tree completes; knowledge events,
   gate-checked.missing, and cost totals all present.
3. **Live `npm run live:eyes`** (gated on OPENROUTER_API_KEY): pointed at
   corellia's own repo, a live model runs `map-repo` for the four
   categories; artifacts self-validate green; the printed report shows the
   artifact pointers, gate coverage before/after, and real token/dollar
   totals.
4. **Foreign-repo mapping** (the early iteration-6 evidence): the same live
   script accepts any repo path (`npm run live:eyes -- <path>`); run
   read-only (map + dive only, no make goals) against one real repo the
   operator names; artifacts validate against that repo's SHA.

## Build plan (approved)

- [x] **Knowledge wiring in the assembly** — extend `SandboxConfig` /
  `openSandboxAssembly` with the knowledge source (store-backed projection +
  scanner); register `retrievalTools` in the broker table; supply the
  gate/checkpoint query functions. Regression: knowledge-absent config
  byte-identical. Tests: `tests/engine/assembly.test.ts` extend.
- [x] **Scripted convergence test** — `tests/engine/convergence-eyes.test.ts`
  per AC-2, split into 2–3 focused tests if the mega-test gets brittle (the
  AC-16 drift path may be its own test). This is the done-when, scripted
  half.
- [x] **live:eyes** — `examples/live-eyes.ts` + package script per AC-3/4:
  repo-path argument (default: corellia's own root), read-only goal plan
  (map four categories + one dive), ceiling-bounded, prints artifacts/
  coverage/cost. Never run by builders or CI — the operator runs it.

### Test strategy

The scripted convergence is the load-bearing artifact — it pins every seam
the unit suites stubbed (real store, real scanner, real broker, real gate).
Live runs are operator-run evidence, never CI gates. Per-chunk named files;
one typecheck + full suite at end.

### Risks

- Live `map-repo` quality on a real repo is the iteration's open question —
  a weak artifact that still passes self-validation is possible (validation
  checks anchors/edges, not insight). Capture transcripts; that evidence
  feeds iteration 5's harness work. A failed live run is evidence, not a
  build failure.

## Implementation notes

Built green with one named escalation (no-worktree read-only mode needs an engine seam — deferred; live-eyes tears down completely instead, proven byte-identical on cats). Post-judge fixes: gitdir-aware exclude restore, tilde expansion. The live runs then exposed a CROSS-ITERATION bug all prior judges missed: the step transcript never carried the goal (models worked blind; live:hands had only succeeded because its task was discoverable from the fixture). Fixed in the engine with a prefix-stable harness message; pinned by test.
