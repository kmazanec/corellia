---
type: adr
title: "ADR-039: explore-then-emit is one bounded shape (not comprehend-private), and scope is load-bearing"
description: Three independent audits found one root cause behind a string of step-loop stalls — an explore-then-emit leaf (outputSchema + read grants, no writes) reads the repo endlessly because its force-emit backstop and read-economy teaching were built comprehend-private by accident of implementation order, compounded by scope never being made load-bearing (empty scope = allow-all, the retrieval API ignores scope, the split eval never checks it). Re-key the bound off the type's shape, lift the teaching into shared skill, collapse the redundant step-loop patches, and make scope a real per-region bound.
tags: [adr, engine, step-loop, explore-then-emit, scope, comprehend, author, research, simplification, granularity]
timestamp: 2026-06-26T12:00:00-05:00
---

# ADR-039: explore-then-emit is one bounded shape (not comprehend-private), and scope is load-bearing

**Status:** Accepted · **Date:** 2026-06-26 · **Stretch:** no · **Contract:** yes
**Supersedes:** none · **Amends:** ADR-023 (two-phase emission), ADR-029 (comprehension recursion), ADR-036 (working-memory bound)

## Context

A single failure mode recurred across many `live:self` slice-C runs: a leaf reads
the repo and never emits — ballooning the transcript (run #8, 117K tokens →
truncation), or emitting a malformed/truncated tool-call (run `481afacb`), or
read-looping 140 files until a step times out (run `9e035402`). Each incident got a
*targeted* engine fix: ADR-036 (working-memory eviction), a `MalformedStepError`
recovery, the mustDecompose re-decide, ADR-037 (dependency cascade). The factory
walked one wall further each run and hit the next — a sign the fixes were treating
symptoms, not the disease.

Three independent audits (goal-type library, engine step-loop, scope/split-quality)
were run and **converged on one root cause**, which is strong evidence it is real:

### Finding 1 — "explore-then-emit" is one harness shape worn by six types across three families

Six types are *explore-then-emit*: `outputSchema` present, read grants, ~no write
grants — explore the repo with the tool loop, then make one dedicated emit call
(ADR-023). They are `map-repo`, `deep-dive-region` (comprehend); `write-prd`,
`design-arch`, `author-acceptance-criteria` (author); `research-external`
(research). Under the granularity rule (GOAL-TYPES.md: "a type earns existence when
its harness differs materially — tool grant, eval, contract shape, or tier") these
six **legitimately remain distinct types** — each has a different `outputSchema`, a
different deterministic eval, and in one case a different grant axis (web vs repo).
They do **not** merge.

But they share an identical **execution harness**, and that harness has one
dominant failure mode: read endlessly instead of emitting. The factory built two
mitigations for it and scoped them inconsistently:

- The **`note` scratchpad + transcript eviction** (ADR-036) is *family-agnostic* —
  available to every leaf. Correct altitude.
- The **force-emit read-ceiling** (`COMPREHEND_READ_CEILING`, force the emit after N
  read-class calls) is hard-coded to `family === 'comprehend'` (`engine.ts`). The
  `author` and `research` explore-then-emit leaves — same shape, same failure — get
  no backstop.
- The **read-economy teaching** ("read 6–8 well-chosen files, then EMIT; over-reading
  is a FAILURE") lives only in `comprehend.md`. `author.md` and `research.md` teach
  no read discipline at all.

The scoping to comprehend was incidental: the ceiling was built for an AC-4
*comprehension* run before the author/research explore-then-emit failures surfaced.
The code comment even admits it — "scoped to the comprehend (discovery) family
only … deliver/implement leaves are untouched (they legitimately re-read many
times)." That rationale correctly excludes the **build** family (write leaves that
legitimately read-write-reread), but it never considered author/research, which are
**not** write leaves — they are pure explore-then-emit, exactly like comprehend.

### Finding 2 — the step-loop accreted 7 overlapping mechanisms, 3 of which undo bad upstream decisions

`runStepLoop` (~626 lines) holds seven mechanisms that each bound or recover a
looping leaf: the comprehend read-ceiling + `forceEmitNext`, `MalformedStepError`
recovery, ADR-036 eviction, the duplicate-read guard, the warn-only tool-call
backstop, the two-phase emit, and the dollar ceiling — plus the isomorphic-failure
detector outside the loop. They overlap badly:

- The read-ceiling, the malform-recovery, and the two-phase emit are **the same
  force-emit funnel reached three ways** (malform-recovery sets `forceEmitNext`; the
  ceiling sets `forceEmitNext`; both drive the two-phase emit).
- **Two of the mechanisms exist only to stop a *third* (the isomorphic detector)
  from misfiring**: the read-ceiling comment says it exists because over-reading
  "trips the isomorphic-failure detector into a block"; the malform-recovery exists
  because a malformed call "would isomorphic-block the leaf." Patches guarding a
  patch.
- Three decide-path conditionals exist only to **undo a bad upstream decision**:
  coerce a comprehend `block`→`satisfy`, re-decide a mustDecompose `satisfy`, and
  force an emit when the leaf won't self-bound. Each is the engine cleaning up after
  an under-constrained call.

If the explore-then-emit leaf were one *bounded primitive* — a hard, family-agnostic
read-class cap feeding the existing eviction, then a deterministic transition to the
emit phase — the seven mechanisms collapse to roughly three (the bounded
explore→emit primitive; eviction + dup-guard; the dollar ceiling), and the
isomorphic detector returns to catching genuine logical non-convergence.

### Finding 3 — scope was never made load-bearing

The compounding cause: the brain's split gave `author-acceptance-criteria`
`scope: []`, and nothing rejected it. Worse:

- `isInScope` returns **`true` for empty scope** (`checks.ts`: "empty scope = allow
  all") — empty scope is *allow-everything*, by construction.
- The typed **retrieval API ignores `goal.scope` entirely** (`retrieval.ts`:
  `find_symbol`/`conventions_for`/`impact` walk the whole repo root; the `_goal`
  arg is discarded). DESIGN.md's "context cost is paid **per touched region, never
  per goal re-learning the repo**" was never implemented — the intended
  bounded-consumption mechanism exists but consumes the whole repo.
- `validateSplit` never reads scope; `judge-split` has `grants: []` and a one-line
  rubric that never mentions scope. The "highest-leverage check" (DESIGN.md) degraded
  to structural well-formedness only (ids, cycles, budget-shares).
- DESIGN.md's termination premise — "independent sub-goals **shrink the goal** —
  each is a strictly smaller piece" — is unenforced; it survives only on the
  orthogonal `leafOnly` floor and the dollar/wall-clock ceilings.

So the leaf with `scope: []` had no region to anchor to, no signal for "I've read
enough," no backstop to force the emit, and no teaching to self-bound — and it read
140 files until it timed out.

## Decision

Two coupled corrections, plus the simplification they enable.

### 1. The explore-then-emit bound is a property of the type's SHAPE, not its family

A leaf is *explore-then-emit* when its type has an `outputSchema` and **no write
grant** (`fs.write`/`fs.write_test_dirs`). This is readable straight off the type
definition. For every such leaf — comprehend, author, research alike — the engine
applies the force-emit read-ceiling: once read-class calls cross the cap, force the
two-phase emit. The **build** family is excluded by the *write-grant* test (an
honest property: a write leaf legitimately reads-writes-rereads), not by a family
string. This mirrors how ADR-036 correctly built eviction as a universal leaf
mechanism rather than a comprehend flag.

The **read-economy teaching** ("read a few well-chosen files, then EMIT; over-reading
is a FAILURE, not thoroughness") moves from `comprehend.md` into the shared skill
preamble (`_shared.md`), since it is cross-subject, outcome-only-validatable craft —
exactly the kind GOAL-TYPES.md says climbs into shared skill. `comprehend.md` keeps
only comprehend-specific craft (pointers-not-bodies, anchor validity, the split law).

### 2. Scope is load-bearing

- A **make-leaf with empty scope is rejected** at `validateSplit` — a child that
  will produce a product must declare the region it touches. (Planner/learn/judge
  types that legitimately have no region are exempt; the check is keyed to the
  shape that needs it.)
- The **typed retrieval API honors `goal.scope`**: consumption is biased to the
  declared region first, so DESIGN.md's "per touched region, never re-learning the
  repo" becomes real. (Reads outside scope are not forbidden — a leaf may need to
  read a caller to write correctly within scope — but the region is the leaf's
  anchor and default surface, which is the self-bounding signal a leaf needs.)

We deliberately do **not** make `isInScope` reject reads outside scope. DESIGN.md
bounds *writes* by scope (`diff ⊆ scope`) and intends reads to be *biased* to the
region (the retrieval API "per touched region"), not *forbidden* outside it — a leaf
may legitimately read a caller or a shared type before writing within scope. The
bound on reading is the discovery-loop economy (decision 1), not a hard read-scope
gate. Making reads hard-fail outside scope would re-introduce the "I can't access
the repo, please paste it" failure the comprehend skill warns against.

### 3. Collapse the redundant step-loop mechanisms

With the bound generalized: `MalformedStepError` recovery and the read-ceiling both
become the same explore→emit transition; `forceEmitNext` folds into that edge; and
the two isomorphic-detector guards (which only existed to stop it misfiring on
over-read/malform) are removed, returning the detector to genuine non-convergence.
The net is fewer mechanisms doing clearer work — the simplification is part of the
decision, not a follow-on.

## Alternatives Considered

### (A) Just generalize the read-ceiling (the minimal fix)

**Rejected as the whole answer.** Re-keying the ceiling off shape fixes the immediate
author/research stall, but leaves the `scope: []` decomposition defect (the leaf still
has no anchor region) and the 7-mechanism overlap (the accidental complexity that
made each prior fix a symptom-patch). The audits showed the disease has two coupled
causes; fixing one leaves the other to resurface. Kept as the *first step* of the
full fix.

### (B) Merge comprehend + author + research into one family

**Rejected.** They share the explore-then-emit *harness*, but their subject-matter
skills genuinely differ (repo cartography vs PM-interview craft vs source
corroboration) and their `kind` differs (`author` is `make`; the other two are
`learn`), which changes the grant ceiling. A family is a shared skill + skeleton; the
shared part here is the *bound and the read-economy*, which we lift to `_shared.md`
instead. The families stay; the discipline stops being one family's private property.

### (C) Make reads hard-fail outside scope (`isInScope` rejects out-of-scope reads)

**Rejected** (see Decision 2). It contradicts DESIGN.md's read/write asymmetry and
re-introduces the "repo unreachable" misread. Scope *biases* reads (via the retrieval
API) and *bounds* writes; the read bound is economy, not a gate.

### (D) Keep patching per-incident

**Rejected** — this is the status quo that produced the 7-mechanism overlap. The
audits make the cost legible: three of the seven mechanisms exist only to undo other
decisions, and two only to stop a third from misfiring. Continuing would deepen the
debt.

## Rationale

DESIGN.md is right; the implementation under-built two load-bearing invariants and
then patched the symptoms family-by-family. The fix *restores the design's own
intent* at the correct altitude: the explore-then-emit economy is a shape property
(like ADR-036's eviction), and scope is the per-region bound DESIGN.md always
described ("per touched region, never re-learning the repo"). Keying the bound off
the type's shape — not a family string — is the same principle as the granularity
rule itself: behavior follows the material harness property, not the label.

It is also a net *deletion* of complexity, which is the strongest evidence it is the
right cut: a correct root-cause fix makes the surrounding patches unnecessary.

## Tradeoffs & Risks

- **A generalized read-ceiling could cut short a leaf that legitimately needs many
  reads.** Mitigated: the cap is a correctness backstop set well above the 6–8 the
  skill asks for (the current comprehend value is 16); the eviction (ADR-036) means
  bounded reads never balloon; and the cap only *forces the emit*, it does not block —
  a genuinely-incomplete artifact still faces its deterministic + judge gate.
- **Rejecting empty make-leaf scope could block a legitimate whole-repo make-leaf.**
  Mitigated: a make-leaf that truly touches the whole repo is almost always a
  decomposition smell (it should split); and the check is scoped to make-leaves, so
  planner/learn/judge types are unaffected. If a real whole-repo make-leaf case
  appears, it declares a broad-but-explicit scope rather than `[]`.
- **Threading scope into retrieval changes retrieval results.** Mitigated: scope
  *biases*, not *filters-hard* — out-of-region results still surface when in-region
  ones are absent, preserving correctness while paying region-first cost.
- **The step-loop collapse touches a hot path.** Mitigated: done incrementally, suite
  green at each step; the collapse removes branches rather than adding them.

## Consequences for the Build

- **`src/engine/engine.ts`**: re-key the read-ceiling guard from `family ===
  'comprehend'` to a shape test (`outputSchema && no write grant`); fold
  `malformRecoveryUsed` and `forceEmitNext` into one explore→emit transition; remove
  the two isomorphic-detector guards that only suppress over-read/malform; reject an
  empty-scope make-leaf in `validateSplit`.
- **`src/library/retrieval.ts`**: thread `goal.scope` into `find_symbol`,
  `conventions_for`, `impact`, etc. — region-first consumption.
- **`src/library/skills/_shared.md`**: add the read-economy discipline; trim it from
  `comprehend.md`.
- **`src/library/types/*`**: no new types, no merges. The granularity rule is
  satisfied as-is.
- **`docs/issues/author-leaf-first-step-failure.md`**: resolved by this ADR (the
  author-family instance of the shared failure); deleted per the ephemeral-issue rule,
  folded into the iteration record.
- **Tests**: a shape-keyed read-ceiling test (author leaf forces emit), an
  empty-scope-make-leaf rejection test, a scope-biased retrieval test, and the
  existing step-loop suite green through the collapse.
