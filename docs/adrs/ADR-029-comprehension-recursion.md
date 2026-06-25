---
type: adr
title: "ADR-029: Comprehension must recurse — the comprehend family obeys the split law"
description: The comprehend family stops being leaf-only and obeys the split law, so comprehension goals that scale with repo size can decompose instead of swallowing the whole job in one node.
tags: [adr, comprehension, recursion, split-law, scaling]
timestamp: 2026-06-24T01:53:16-05:00
---

# ADR-029: Comprehension must recurse — the comprehend family obeys the split law

**Status:** Accepted · **Date:** 2026-06-15 · **Stretch:** no · **Contract:** yes
**Supersedes:** none · **Superseded by:** none

## Context

The factory's central law (DESIGN.md): *any goal too big for one node splits.*
Every family obeys it through the engine's decide path — receive → decide
(satisfy | split | block) → integrate → emit — **except one.** The comprehend
family (`map-repo`, `deep-dive-region`) is hard-coded `leafOnly: true`
(`src/library/types/comprehend.ts:41,80`). The engine enforces leaf-only
structurally: a `leafOnly` type skips the decide/split path and goes straight to
the attempt loop (`engine.ts:632`), and a `leafOnly` type that returns a split
decision is a hard error (`engine.ts:702`). So a comprehension goal **cannot
decompose** — it must swallow its entire job in one node's context.

This is the family whose work scales directly with repo size, and it is the one
family forbidden to recurse. The contradiction is not theoretical — it is the
**named root cause of iteration 06's AC-2 failure** (the factory delivering a
real feature to its own repo: 1/5). The live evidence (build notes,
2026-06-12):

- Whole-repo `map-repo` goals (architecture, stack) on cats explored until they
  exhausted even a **2M-token** budget without ever converging to an emit. The
  lever is **not** bigger budgets — 2M still exhausted.
- The **scoped** `deep-dive:src` goal **passed** — not because scope helped, but
  because cats's `src` happened to fit under the single-leaf ceiling the
  unbounded goals blew through. On a larger subsystem it would exhaust
  identically.
- Tier was not the wall: both types already escalate `mid → high` on retry;
  "isomorphic failure" means high failed identically to mid. The single-node
  ceiling, not the model, is the wall.

AC-2 failing blocks AC-3 and AC-4 (deliver-to-self, deliver-to-foreign) — the
PRD's Desired Outcome, both halves. The loop closed *structurally* in iteration
06 but does not *converge* on any non-trivial repo until comprehension can split.

DESIGN.md §"Discovery is just-in-time" already states the intended posture:
comprehension is *pulled by the split gate* — "map enough to split THIS intent,"
"a region no goal touches is never mapped," "no comprehension is ever
speculative." The whole-repo eyes checkpoint violates this on its own terms
(speculative, unbounded). But scoping the checkpoint is not the whole fix: even a
scoped comprehension goal can exceed one node on a large subsystem. The deeper
fix is to make comprehension obey the recursion law like every other family.

## Options considered

- **Bigger budgets / better prompting only** — rejected. 2M tokens still
  exhausted; this is the lever iterations 5 and 6 already tried and named as
  carried debt. The ceiling is structural (one node), not a budget shape or a
  model-quality problem.
- **Scope the checkpoint only** (`live:foreign-eyes` commissions narrow regions)
  — necessary but insufficient. It hides the defect on small subsystems and
  reproduces it on large ones. A bounded node still has a single-node ceiling.
- **Remove `leafOnly` from the comprehend family and let it take the decide
  path** — chosen. A comprehension goal that finds its region too large to
  comprehend in one node SPLITS: it fans out child comprehension goals over
  sub-regions and integrates their artifacts at the parent edge — the same
  satisfy/split/block decision every other node makes.

## Decision

**1. The comprehend family is no longer `leafOnly`.** Remove the flag from
`map-repo` and `deep-dive-region`. They take the engine's decide path: the brain
returns satisfy (region fits one node — emit the artifact directly), split
(region too large — fan out child comprehension goals over sub-regions), or block
(per the existing law). The `leafOnly` split-is-a-hard-error guard
(`engine.ts:702`) no longer fires for them.

**2. The split criterion is region size, pulled by the split gate.** A
comprehension goal carries a region (already `spec.region` / `spec.scope`). The
brain splits when the region is too large to comprehend faithfully in one node's
context, partitioning into sub-regions whose union covers the parent region and
whose children are themselves comprehension goals of the same category. The
harness prompt for the comprehend family must teach this criterion explicitly —
*when* to split (region exceeds one node) and *how* to partition (disjoint
sub-regions covering the parent).

**3. Comprehension integration produces ONE valid artifact — a structured merge,
not the generic text join.** This is the load-bearing design point. The engine's
default integrate path concatenates child `files` artifacts or `\n`-joins child
`text` artifacts (`engine.ts:2851-2873`). Comprehension artifacts are structured
JSON (`KnowledgeArtifact` for `map-repo`, `RegionFacts` for `deep-dive-region`)
gated by `mapRepoCheck` / `diveAnchorCheck`. A naive `\n`-join of child JSON blobs
is **not a valid single artifact** and would fail the parent's deterministic gate.
The comprehend family therefore needs a **structured integration merge**: child
`KnowledgeArtifact`s merge into one parent `KnowledgeArtifact` (union of pointers,
merged summary, `status: provisional`, `generatedAtSha` = the parent's HEAD SHA,
confidence = the conservative min across children); child `RegionFacts` merge into
one `RegionFacts` (union of anchored facts, every anchor re-validated at the
parent SHA). The merged artifact must pass the same deterministic gate a leaf
artifact passes. The merge runs at the comprehension parent's integrate edge,
before the integration eval and the `knowledge-written` / `knowledge-facts-written`
event.

**4. `live:foreign-eyes` is rewritten to test the design as written.** It
commissions a real **scoped intent** against cats and lets the split gate pull
JIT comprehension of only the relevant regions — which may themselves recurse —
rather than speculatively commissioning four whole-repo categories. Success is
asserted on the scoped intent's convergence, with the honest record kept either
way (the iteration's own AC-2 retest is the live proof, operator-run).

The two-phase structured-emit hardening (a long exploration transcript still
yielding a clean structured artifact, `engine.ts:2085/2119`) is a **symptom of
the single-node ceiling**: once recursion keeps each node's transcript short, the
emit is unlikely to bite. It is in scope only as a lower-priority guard, not the
primary fix.

## Tradeoffs & risks

- **Structured merge is family-specific code, not free with the flag flip.** The
  flag flip alone routes comprehension through an integrate edge that produces an
  invalid artifact. The merge (decision 3) is the real work; the flag is the
  trigger. The brief and specs must scope the merge as a first-class deliverable.
- **Partition quality is a model judgment.** A bad partition (overlapping or
  gap-leaving sub-regions) yields a merged artifact with double-counted or missing
  pointers. v1 relies on the harness prompt's partition discipline plus the
  parent's deterministic gate; a mechanical coverage check over the partition is a
  candidate refinement, not v1.
- **Anchor re-validation cost at merge.** Re-validating every child `RegionFacts`
  anchor at the parent SHA is the correct verify-on-read posture (ADR-019) but
  costs reads. Acceptable: it is bounded by the fact count and runs once per
  parent integrate.
- **Recursion depth.** A pathological partition could recurse deeply. The existing
  budget subdivision and the split eval's structural validation (`validateSplit`)
  bound depth the same way they do for every other family; no new guard is needed
  beyond confirming they apply once `leafOnly` is gone.

## Consequences for the build

- `src/library/types/comprehend.ts`: remove `leafOnly` from both types; extend
  the harness prompts with the split criterion (when/how to partition a region)
  and the integrate contract (children are sub-region comprehensions).
- Engine integrate path: a comprehend-family structured merge for
  `KnowledgeArtifact` and `RegionFacts` (decision 3), gated by the existing
  deterministic checks, emitting the existing `knowledge-written` /
  `knowledge-facts-written` events. This is the one contract-touching change —
  the comprehension integrate edge.
- `examples/live-foreign-eyes.ts`: rewrite to commission a scoped intent pulled
  by the split gate (decision 4).
- Re-verify AC-2 live (operator-run) and record the honest result; AC-3/AC-4
  unblock only on AC-2 passing.
- Builds in iteration 08 (recursion). The contract barrier touched is the
  comprehension integrate edge (structured artifact merge); no change to the tool,
  brain, or event-base contracts beyond reusing the existing knowledge events.

## Amendment (2026-06-24) — Decision 2 extended to scoped brownfield adds

Decision 2 ("comprehension is JIT, pulled by the split gate, bounded by the
regions the goal touches") originally suppressed the whole-repo
architecture/conventions/stack maps only for **greenfield** scope (every touched
region brand-new). The AC-4 cats deliver (build notes, AC-4 run #3) exposed the
missing half: a **tightly-scoped brownfield add** to EXISTING dirs (a pure helper
into `src/cats/agents/common/`) still pulled the whole-repo `architecture` +
`conventions` maps, and mapping cats' 259-file repo timed out in its subdivided
wall-clock slice — so a one-file feature could never reach implementation.

The JIT rule applies identically whether the touched region is new or existing:
*a region no goal touches is never mapped*. So the carve-out is generalized:

- A **code-emitting leaf with non-empty scope** requires the **region dives of its
  touched (existing) regions ONLY** — NOT a whole-repo architecture/conventions
  map. The region dives ARE its comprehension. (Greenfield is now the special case
  where those regions also happen to be new, so no dive is pulled either.)
- A **scope-less** code leaf (a genuine unscoped / whole-repo edit) still requires
  the whole-repo maps — there is no region to bound comprehension to.
- **Characterize/test** work is unchanged: it genuinely reads the wider codebase
  to write tests, so it keeps the whole-repo categories even when scoped.

Implemented in `src/library/coverage.ts` (`isScopedCodeLeaf` branch). Pure policy
change; no contract touched. Tests in `tests/library/coverage.test.ts`.

A companion robustness fix (not a policy change): the `comprehend` skill's
satisfy-vs-split guidance is sharpened so a whole-repo `map-repo` over a LARGE
repo (many subsystems) splits into per-subsystem sub-region maps UP FRONT rather
than attempting one node and exhausting the budget — defense for the genuine
whole-repo-map case the carve-out does not cover.

## Amendment (2026-06-24, part 2) — Decision 2 extended to the SCOPED ROOT SPLIT

The part-1 carve-out covered the code-emitting **leaf**. AC-4 cats run #6 (build
notes) exposed that the *deliver-intent ROOT split itself* still demanded whole-repo
maps: a scoped deliver intent (scope = `src/cats/agents/common/`, `tests/unit/` —
both existing) hit `gate-checked: missing [architecture, stack]` and minted a
whole-repo `map-repo: architecture` of cats' 259-file tree, which cannot be built
faithfully in a bounded read budget (its claimed pointers fail the deterministic
anchor gate). The leaf carve-out never got a say because the root's split pulled
the whole-repo maps first.

The JIT rule applies to the decomposition intent too: *a scoped intent is bounded
to the regions it touches whether it is a leaf or a split.* So:

- A **root split with non-empty scope** (brownfield OR greenfield) pulls the
  **region dives of its touched (existing) regions ONLY** — NOT a whole-repo
  architecture/stack map. (Greenfield stays the special case where those regions
  are also new, so no dive is pulled either.)
- A **scope-less root split** (a genuine whole-repo intent — e.g. "map this repo")
  still requires the whole-repo architecture + stack maps; there is no region to
  bound to.

Implemented in `src/library/coverage.ts` (`isScopedRootSplit` branch; the region-
dive check is no longer gated on `!isRootSplit`). Pure policy change; no contract
touched. Tests in `tests/library/coverage.test.ts`.

A second companion robustness fix (Decision 1 / the recursion, made to actually
fire): the genuine whole-repo `map-repo` case now gets a **factual repo-size
signal** at decide time. The engine computes a cheap top-level-dir / file count
for a scope-less `map-repo` and injects it as `ctx.repoShape` (new optional
`BrainContext` field) into the decide call, so the skill's "8+ subsystems → split"
rule fires on real data instead of a blind guess (run #6: the architecture map
chose satisfy and then could not converge). The brain weighs it, never obeys it.
Implemented in `src/engine/engine.ts` (`repoShapeHint`) + `src/brains/llm.ts`
(decide prompt). Tests in `tests/brains/llm.test.ts`.
