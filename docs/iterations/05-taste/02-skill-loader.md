---
id: F-52
title: Skill loader + family files for the existing library
iteration: 05-taste
type: implement
intent: production
status: not-started
dependsOn: []
contracts: [ADR-022]
---

# Feature: Skill loader + family markdown files (existing 10 types)

**Before:** harness content is template strings in starter-types.ts; the
generic-prompt ceiling caused the live variance.
**After:** `src/library/skills/<family>.md` files (family preamble +
per-type sections) loaded by a cached loader; the engine injects family
skill + type section into the immutable harness message; starter-types is
refactored into per-family modules (deliver/contract/implement/characterize/
comprehend/arbiter/critique/curate) so later features own disjoint files;
every existing type gains `family` and a ported+upgraded skill section
seeded from the GOAL-TYPES seed table (the dotmaz field data: batched
rhythm, six-dimension rubric, vertical-slice discipline, contract barrier,
discovery loop economy/pointers-not-bodies/message protocol).

## Acceptance criteria
1. Loader resolves family → markdown (cached); registered type with a
   missing family file fails the constitution lint.
2. Engine harness message contains the family skill + type section (pin via
   captured transcript, mirroring the existing harness-context test).
3. starter-types refactor is behavior-preserving: full suite green; the
   public starterTypes() surface unchanged.
4. The map-repo/dive skill sections encode the iteration-04 lessons
   (economy bounds, protocol, pointers-not-bodies) — currently living only
   in examples/live-eyes.ts spec text; live-eyes slims to rely on them.

## Build plan (approved)
- [ ] Loader + family field wiring + lint (tests/library/registry).
- [ ] Refactor starter-types into family modules (no behavior change).
- [ ] Port + upgrade skill content for all 10 existing types; engine
  injection pin; live-eyes spec-text slimming.

Worktree feature; folds back before the type-family features start.
