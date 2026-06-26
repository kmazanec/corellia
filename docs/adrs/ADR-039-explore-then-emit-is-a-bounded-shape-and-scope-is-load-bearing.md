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

The audit's first read was that, with the bound generalized, the seven mechanisms
collapse to roughly three. A conservative pre-refactor pass (decision 3) found this
over-optimistic: the mechanisms each own a distinct behavior (count-bound vs
byte-bound vs format-incident) and are not made redundant by the upstream fix — what
the upstream fix removes is the *family-accident*, not the downstream enforcement. The
big collapse is deferred; see decision 3.

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
is a FAILURE, not thoroughness") moves into a shared `_explore-economy.md`, injected
by the SAME shape test that earns the ceiling (`isExploreThenEmit`), regardless of
family/kind. (Note `_shared.md` is injected only for `kind:'make'`, so it could not
reach the learn-kind comprehend/research leaves — the shape-injected path reaches all
of them.) `comprehend.md` keeps a pointer plus its comprehend-specific craft
(pointers-not-bodies, anchor validity, the split law).

### 2. Scope is load-bearing — as a per-type contract property, not a universal rule

Scope-requirement is **declared on the type** — a new `requiresScope` field on
`GoalTypeDef`, alongside `leafOnly` / `mustDecompose` / `outputSchema`. A type that
declares `requiresScope: true` is rejected at `validateSplit` when its child carries
an empty scope. This is the design's own pattern ("capability is the type",
GOAL-TYPES.md): the scope contract is a property of the type, enforced generically by
the engine — not a hard-coded universal check that guesses which children need scope.

The types that declare it are the **region-anchored producing leaves**:
`implement`, `freeze-contract`, `characterize` (build leaves that write within a
region), `deep-dive-region` (a dive of a *region* with no region is a contradiction),
and `author-acceptance-criteria` (criteria characterize "done" for a region — the
live failure). The types that do **not** declare it are correctly exempt:
`map-repo` (whole-repo, no single region), `research-external` (web, no repo region),
`deliver-intent`/`investigate` (planners that refine scope downward), and every judge.

This is strictly better than a universal `validateSplit` rule: it broke zero existing
tests (a universal check broke 71 occurrences across 10 files), because each type
opts in by its own contract — and it is more honest, since "needs a region" genuinely
varies by type.

We deliberately do **not** make `isInScope` reject reads outside scope, and we do
**not** bias the retrieval API to scope (an earlier draft of this ADR proposed the
latter). DESIGN.md bounds *writes* by scope (`diff ⊆ scope`); the bound on *reading*
is the discovery-loop economy (decision 1) plus `requiresScope` giving the leaf a
real region to anchor to. Once a leaf has a non-empty scope and the force-emit
ceiling, it self-bounds — re-keying the retrieval API to filter reads by scope would
be redundant machinery and risks the "I can't access the repo, please paste it"
failure the comprehend skill warns against. The canonical fix (a real region + an
economy bound) makes the retrieval-scope plumbing unnecessary.

### 3. Simplify the step loop where it is provably behavior-preserving — and DEFER the big collapse

The original framing of this ADR (and the engine audit) said the seven step-loop
mechanisms collapse to ~3 once the root cause is fixed. **On close pre-refactor
inspection, that was too optimistic, and we deliberately did NOT do the big collapse.**
What looked like "a patch guarding a patch" is, on inspection, three mechanisms each
owning a *distinct, load-bearing* behavior that the upstream fix does not make dead:

- **The read-ceiling** bounds the *count* of reads (force emit after N).
- **The malform-recovery** is NOT redundant with it: it does **truncation-pre-eviction**
  — the only eviction that runs before a forced emit on the size-truncation path,
  because the forced-emit block runs before the top-of-loop eviction — AND it owns the
  distinct `step-loop:malformed` failure signature that *prevents* a format incident
  from colliding with a logical `step-loop:failed` in the isomorphic detector.
- **The eviction (ADR-036)** bounds the *bytes* already read — orthogonal to the count
  ceiling.

The isomorphic-detector "guards" cannot be removed without removing the mechanisms
they live in, and those mechanisms carry unique behavior. The full "one bounded
explore→emit primitive" rewrite is justified by *readability, not correctness* — the
mechanisms are correct today — so it is a **RISKY-DEFER**, to be done (if at all) as
one deliberate, test-green restructure, never piecemeal.

What we DID do, because it is genuinely behavior-preserving: dedup the redundant
`this.registry.get(goal.type)` re-fetches inside `runStepLoop` to the single bound
`typeDef`, and fix the forced-emit nudge so it does not claim "you have read enough
(0 read-class calls)" when the force was reached via the malform path at read 0.
The lesson recorded here: the root-cause fix bounds the *cause* (unbounded explore),
but the downstream mechanisms are precisely what *enforce* the bound — they are not
made redundant by fixing the cause. Deleting them to lower a mechanism count would
lose real behavior. The deletion of complexity in this ADR is the family-accident
removal (decision 1) and the per-type scope contract (decision 2), not a step-loop
rewrite.

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

It is also a net *deletion* of complexity — but a precise one: the deletion is the
family-accident (decision 1) and the per-type scope contract replacing a would-be
universal check (decision 2), NOT a rewrite of the step loop. A conservative pass
(decision 3) found the step-loop mechanisms are correct and each load-bearing, so the
discipline was to simplify only what is provably behavior-preserving and leave the
rest correct — the right cut removes accidental coupling without churning a working
hot path.

## Tradeoffs & Risks

- **A generalized read-ceiling could cut short a leaf that legitimately needs many
  reads.** Mitigated: the cap is a correctness backstop set well above the 6–8 the
  skill asks for (the current comprehend value is 16); the eviction (ADR-036) means
  bounded reads never balloon; and the cap only *forces the emit*, it does not block —
  a genuinely-incomplete artifact still faces its deterministic + judge gate.
- **`requiresScope` could block a legitimate whole-region producing leaf.** Mitigated:
  the property is *declared per type*, so only types whose contract genuinely needs a
  region carry it; a type that legitimately spans broadly (map-repo) simply does not
  declare it. If a real broad case appears for a `requiresScope` type, the brain
  declares a broad-but-explicit scope rather than `[]`, which is more honest anyway.
- **The step-loop collapse touches a hot path.** Mitigated: done incrementally, suite
  green at each step; the collapse removes branches rather than adding them.

## Consequences for the Build

- **`src/engine/engine.ts`**: re-key the read-ceiling guard from `family ===
  'comprehend'` to a shape test (`isExploreThenEmitLeaf`: `outputSchema && no write
  grant`); inject the `_explore-economy.md` block by the same shape test; pass a
  type resolver into `validateSplit` so a `requiresScope` child with empty scope is
  rejected; fold `malformRecoveryUsed`/`forceEmitNext` into one explore→emit
  transition and remove the isomorphic-detector guards that only suppress
  over-read/malform (the collapse — a later step).
- **`src/contract/goal-type.ts`**: add the `requiresScope?` contract property.
- **`src/library/types/*`**: declare `requiresScope: true` on the region-anchored
  producing leaves (`implement`, `freeze-contract`, `characterize`,
  `deep-dive-region`, `author-acceptance-criteria`). No new types, no merges.
- **`src/library/skills/_explore-economy.md`** (new): the read-economy discipline,
  shape-injected; `comprehend.md` keeps a pointer + comprehend-specific craft.
- **`docs/issues/author-leaf-first-step-failure.md`**: resolved by this ADR (the
  author-family instance of the shared failure); deleted per the ephemeral-issue rule,
  folded into the iteration record.
- **Tests**: a shape-keyed read-ceiling test (author leaf forces emit), the
  economy-injection tests, the `requiresScope` rejection + exemption tests, and the
  existing suite green through the collapse.
