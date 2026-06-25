---
type: iteration
title: "Iteration 08 — Recursion (ADR-029): the strange loop proves its own thesis"
description: Comprehension is made to obey the split law — ADR-029 removes leafOnly so map-repo/deep-dive recurse; proven via live:self, which empirically demonstrated the thesis by failing because comprehension could not recurse.
tags: [iteration, recursion, adr-029, comprehension, leaf-only, live-self, strange-loop, comprehend-merge]
timestamp: 2026-06-20
status: landed-on-main
---

# Iteration 08 — Recursion (ADR-029): the strange loop proves its own thesis

**Date:** 2026-06-20 · **Status:** Landed on main (recursion mechanism proven and
landed; comprehension SCOPING deferred to iteration 09) · **Approach:**
commissioned through the factory's own front door (`live:self`), per the
self-hosting principle — corellia building the fix that lets corellia comprehend
corellia.

## What the self-build runs surfaced (7 fixes, all on main, all green)

The attempt to self-build ADR-029 drove the factory progressively deeper, one
real defect per run. Each was invisible to the scripted convergence suite (which
uses a deterministic brain that never emits malformed JSON, never picks a flaky
model, and never triggers a real multi-region coverage fan-out):

| Run | Reached | Blocker | Fix |
|---|---|---|---|
| 1 | engine split | brain split child missing `dependsOn` → `[...child.dependsOn]` crash | `539334a` parse-seam normalization |
| 2 | decide | unparseable decision threw uncaught → killed whole tree | `50e28f6` decide → block on parse failure |
| 3 | decide | decide/judge used `json_object` (valid JSON, any shape) | `5a71054` schema-constrain output + real-error re-ask + fence-tolerant parse |
| 4 | decide | **`qwen/qwen3-235b-a22b` broken on OpenRouter** (ECONNRESET / returns `{`) | `235d34e` high tier → `claude-sonnet-4` + transport retry on decide/judge |
| 5 | coverage gate | legitimate 12-child fan-out > `attempts:5` harness budget | `af0cf47` live:self budget → 20/3M/300 |
| 6 | coverage gate | injected comprehension shares pushed sum to 1.8 > 1 | `157e1a4` renormalize budgetShares after injection |
| 7 | **comprehension (real work)** | `map-repo`/`deep-dive` exhausted token budgets — **the ADR-029 wall** | hand-implement (below) |

**Key lesson (run 4):** I burned three commits theorizing about output *shape*
before probing the raw wire response, which revealed the true cause was a flaky
*model*. Capture the evidence before theorizing.

## Run 7 — the wall is the result ($0.73, 1.87M prompt tokens, 75% cache)

The factory cleared every structural gate and did genuine comprehension work,
then blocked on exactly the signature ADR-029 was written to fix (from the
iteration-06 AC-2 root-cause): `map-repo: architecture` and
`deep-dive: src/engine/engine.ts` **exhausted their token budgets** trying to
comprehend the engine in a single un-splittable node — because the comprehend
family is still `leafOnly: true`, the very flag ADR-029 removes. The integration
eval confirmed no implementation landed ("leafOnly still true and no integration
merge logic"). No code was written; the run died in comprehension, before the
implementation step.

**The strange loop empirically proved its own thesis: comprehension must recurse
— demonstrated by comprehension failing because it cannot.** The factory cannot
bootstrap past this particular fix via `live:self`, by construction. No budget
bump escapes it (the iter-06 notes already proved 2M tokens exhaust; this run
burned 1.87M and died identically).

## Decision: hand-implement ADR-029 on main, then prove via live:self

Since the fix is the precondition for the factory self-building it, ADR-029 is
implemented directly on `main` (interactive/cleanup work per the branch rules),
offline-verified. `live:self` is then re-run on a SIMPLE feature to prove the
now-recursing factory can self-build — the AC-2 proof, decoupled from the
bootstrap paradox.

## ADR-029 implemented on main (92a00b7)

Hand-implemented (the factory can't bootstrap past its own missing recursion),
built in an isolated worktree by a Sonnet builder, reviewed and cherry-picked
onto main linearly. Three parts:

1. **comprehend.ts** — `leafOnly: false` on `map-repo` and `deep-dive-region`;
   harness prompts teach the split criterion (partition a too-large region into
   disjoint sub-regions covering the parent, each a child of the same type) and
   the integrate contract.
2. **engine.ts INTEGRATE + src/library/comprehend-merge.ts** — a structured
   merge replaces the generic `\n`-join for the comprehend family: child
   `KnowledgeArtifact`s merge into one (union pointers, min confidence,
   provisional, parent HEAD SHA); child `RegionFacts` merge into one (union
   anchored facts). The merged artifact is gated by the type's own
   `mapRepoCheck`/`diveAnchorCheck` and persisted via the same
   knowledge-written / knowledge-facts-written path a leaf uses. Gate failure
   blocks the split honestly; no valid child → graceful empty fallback.
3. **tests/engine/comprehend-recursion.test.ts** — proves both merges pass their
   gate and land exactly one parent knowledge event, plus the no-valid-child
   fallback.

Gates green on main: typecheck, lint, engine+brain+library suites (1109 passed).

**Open (Part 4, deferred):** `examples/live-foreign-eyes.ts` rewrite to a scoped
JIT intent (ADR-029 Decision 4) was out of the implementation scope. The AC-2
proof is the next step: re-run `live:self` on a SIMPLE feature to show the
now-recursing factory can self-build — decoupled from the bootstrap paradox.

## AC-2 proof runs after ADR-029 landed — recursion WORKS, but comprehension over-fires

Two `live:self` runs commissioning a TRIVIAL feature (a pure `formatDuration`
util in a brand-new empty `src/util/`) after ADR-029 landed. Budget raised to
80/5M/600 for the second to take budget arithmetic off the critical path.

**The success signal (recursion works):**
- A comprehension goal PASSED: `✓ [deep-dive-region] src/library/types/comprehend.ts`.
- Comprehension goals now SPLIT — the tree shows a `map-repo` for `conventions`
  with a nested `Map root /…` child. That nesting is ADR-029's recursion firing:
  a comprehension parent fanning out comprehension children, which `leafOnly`
  forbade before. The core thesis is validated end-to-end.

**The real problem exposed (architectural, not budget):** the run drowned in
~16 comprehension goals (map-repo ×6, deep-dive ×10) for a feature that touches
only a new isolated file and needs essentially NO comprehension. The coverage
gate demanded whole-repo maps (architecture, conventions) and deep-dives of
unrelated regions (`src/engine/engine.ts`, `knowledge-schemas.ts`). This
violates DESIGN.md's own JIT rule — "a region no goal touches is never mapped;
no comprehension is ever speculative." Cost ~$0.79, 1.88M prompt tokens, no PR.

This is exactly **ADR-029 Decision 2 + Decision 4** — scoped, split-gate-pulled
JIT comprehension and the `live-foreign-eyes`/commission rewrite — which were
NOT in the implemented scope (only the recursion mechanism, Decisions 1+3, was).
The mechanism recurses correctly; the layer that decides WHAT to comprehend
over-fires.

**Secondary decision-maker failure modes surfaced (good model, claude-sonnet-4):**
- `split decision missing children array` — model returned `{kind:"split"}` with
  no `children`. parseDecision throws → decide-fallback blocks. Candidate: tolerate
  (a childless split is a satisfy/block, not a hard error).
- A decide call emitted conversational prose ("Please provide the Codebase Summary
  Report…") instead of a decision — the comprehension decide prompt under-constrains
  output; the schema-constraint that fixed deliver-intent decide may not cover the
  comprehension decide path identically.
- Deep nesting still floors child attempts to 1 (`Fan-out of 7 > 1`) even at
  80 root attempts — subdivide's floor compounds with depth. Noted, not chased
  (budget is off the critical path by direction).

**Status:** ADR-029's recursion MECHANISM is proven working and landed. The next
real problem is comprehension SCOPING (over-firing / speculative whole-repo
comprehension), which is the unbuilt half of the ADR (Decisions 2+4) — a real
design iteration, not a knob. (Picked up in iteration 09.)
