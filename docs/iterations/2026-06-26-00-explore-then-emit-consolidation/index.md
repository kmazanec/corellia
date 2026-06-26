---
type: iteration
title: "Iteration 15 — Explore-then-emit consolidation (ADR-039): one root cause behind a string of slice-C stalls, found by three audits and proven live"
description: A recurring slice-C stall (a leaf reads the repo forever) was traced by three independent audits to ONE root cause — explore-then-emit's read bound and economy teaching were comprehend-private by accident, compounded by scope never being load-bearing. Fixed at the design's own altitude (shape-keyed bound, per-type requiresScope), plus five downstream robustness fixes surfaced by driving slice C live. Run 5 proved it: the author leaf that read 140 files to a timeout now bounds at exactly 16 reads.
tags: [iteration, adr-039, explore-then-emit, scope, requiresScope, step-loop, robustness, mustDecompose, liveness, transport, slice-c, audit]
timestamp: 2026-06-26
status: landed-on-main
---

# Iteration 15 — Explore-then-emit consolidation (ADR-039)

**Date:** 2026-06-26 · **Status:** Landed on main (consolidation + 5 robustness fixes;
proven live by run `live-self-6060bbf1`). Slice C itself still unbuilt — the factory
is now structurally sound for it and was knocked out only by a slow provider endpoint.

This iteration is the result of stopping to ask, after a string of slice-C live runs
each dying at a new wall, **"are these the right goal types? did we overcorrect and
overcomplicate? is the engine bending around a deeper flaw?"** Three independent
subagent audits (goal-type library, engine step-loop, scope/split-quality) converged
on **one root cause**, which is itself strong evidence it was real.

## The root cause (ADR-039)

An **explore-then-emit** leaf (a type with an `outputSchema` and no write grant —
it explores the repo with read tools, then emits one structured artifact) read the
repo endlessly instead of emitting, then ballooned / malformed / timed out. Every
prior per-incident engine fix (ADR-036 eviction, the malformed-step recovery, the
mustDecompose re-decide, ADR-037) was a **downstream symptom-patch**. The disease:

1. The **force-emit read-ceiling** and the **read-economy teaching** existed only for
   `family === 'comprehend'` — by accident of implementation order — so `author` and
   `research` explore-then-emit leaves (same shape, same failure) had neither.
2. **Scope was never load-bearing**: the brain gave a producing leaf `scope: []` and
   nothing rejected it; `isInScope` treats empty scope as allow-all; the split eval
   never checked scope. So a leaf had no region anchor for "I've read enough."

See **[ADR-039](../../adrs/ADR-039-explore-then-emit-is-a-bounded-shape-and-scope-is-load-bearing.md)**.

## What landed on main

**The consolidation (ADR-039):**
- **Force-emit ceiling keyed off SHAPE, not family** (`isExploreThenEmitLeaf`:
  `outputSchema && no write grant`) — generalizes the bound to author/research,
  excludes build leaves honestly by the write-grant test. (`9ed5d31`)
- **Read-economy teaching lifted to a shape-injected shared skill**
  (`_explore-economy.md`), reaching every explore-then-emit leaf regardless of
  family/kind (`_shared.md` is make-only and could not reach the learn-kind ones).
  (`abaaddd`)
- **Scope is load-bearing via a per-type `requiresScope` contract property**
  (your steer — surgical, *zero* test churn, vs a universal `validateSplit` rule that
  broke 71 occurrences). Declared on the region-anchored producing leaves:
  `implement`, `freeze-contract`, `characterize`, `deep-dive-region`,
  `author-acceptance-criteria`. (`95266bf`)
- **Safe step-loop dedup; the big collapse DEFERRED** — a conservative pre-refactor
  audit found the "7 mechanisms → 3" framing too optimistic: the read-ceiling
  (count-bound), the malform-recovery (truncation-pre-eviction + the distinct
  `step-loop:malformed` signature), and the eviction (byte-bound) each own a distinct
  load-bearing behavior. The root-cause fix bounds the *cause*; these mechanisms
  *enforce* the bound and are not redundant. Did only the provably-safe dedup. (`60dbaee`)

**Five robustness fixes surfaced by driving slice C live (runs 4–5):**
- **A re-decided `satisfy` after a rejected split no longer bypasses the
  mustDecompose guard** — the `requiresScope` rejection forced a re-decide whose
  `satisfy` broke out of the split loop and ran the `deliver-intent` root as a leaf,
  bypassing the once-only guard. (`1f99137`)
- **The decide prompt tells the model to scope producing children** — the upstream
  half: keep the split valid the first time. (`b043bbb`)
- **Liveness: the malform-reprompt fetch got the abort timeout it was missing** — the
  one fetch site without it could wedge the run at 0% CPU. (`a5e9ad0`)
- **A timed-out step is a transport incident, not a logical `step-loop:failed`** — a
  typed `StepTransportError` + a distinct `step-loop:transport` signature, so a flaky
  endpoint doesn't isomorphic-block a leaf. (`b1ed347`)

## The live proof (run `live-self-6060bbf1`, $0.92, 3 rounds)

| Pathology | Prior runs | Run 5 |
|---|---|---|
| Root won't decompose (satisfy-bypass) | died here (run 4) | ✅ split into scoped children |
| Producing children spawned with empty scope | caused the cascade | ✅ all non-empty |
| `author-acceptance-criteria` reads forever | **140 files → timeout** (run 3) | ✅ **bounded at exactly 16 reads** (ceiling fired) |
| Process wedges on hung fetch | infinite hang (run 4) | ✅ bounded retry, **recovered** (round 1→2→3) |

**Every disease this session targeted is cured.** The remaining wall was narrower and
provider-side: the author leaf's forced-emit step **timed out** against a slow
(32%-cache) endpoint and was terminal-blocked — which the last fix (`b1ed347`) now
reclassifies as a transient transport incident. Slice C is unbuilt, but the factory is
now structurally sound for it; it was knocked out by endpoint flakiness, not a design
pathology.

## Resolved + filed

- **Resolved:** `author-leaf-first-step-failure` (the author-family instance of the
  explore-then-emit disease) — proven fixed (bounded at 16 reads); deleted per the
  ephemeral-issue rule, folded here.
- The `comprehension-region-wallclock-exhaustion` issue remains the comprehend-side
  relative; ADR-039 generalizes its mitigation but the dive-tests-engine
  `step-loop:failed` in run 5 suggests a comprehend dive can still hit the same
  transport-timeout wall (now reclassified by `b1ed347`).

## The methodological note

Two near-overcorrections were caught by stopping to investigate rather than patching:
the universal scope check (→ per-type `requiresScope`) and the step-loop collapse
(→ deferred after finding the mechanisms load-bearing). The design was right; the
implementation under-built two invariants and patched the symptoms family-by-family.
The fix restored those at the correct altitude — a net deletion of *accidental*
complexity, not a rewrite. And reading the raw event logs (not theorizing) is what
found the three downstream bugs.
