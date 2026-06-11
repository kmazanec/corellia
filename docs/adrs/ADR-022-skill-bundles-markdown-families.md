# ADR-022: Skill bundles are markdown family files, loaded into the harness

**Status:** Accepted · **Date:** 2026-06-11 · **Stretch:** no · **Contract:** yes
**Supersedes:** none · **Superseded by:** none

## Context

GOAL-TYPES: families share skills as factory code, never memory; the seed
table imports the kmaz pipeline's skills. Today harness content is template
strings inside `starter-types.ts` — unreviewable as prose, and the live
iteration-04 variance traced directly to thin generic prompts (the named
quality ceiling).

## Options considered

- **Markdown family files** (`src/library/skills/<family>.md`, per-type
  sections), loaded at registration — chosen (operator decision).
- Embedded template strings (status quo) — rejected: prompt prose buried in
  code; the improvement loop would edit code strings instead of prose.
- Hybrid — rejected: two places to look.

## Decision

Each family gets one markdown skill file with a family preamble plus
per-type sections. `GoalTypeDef` gains `family: string` (additive, barrier);
a loader resolves and caches the file and the engine injects the family
skill + the type's section into the step-loop harness message (immutable
prefix position). Skill files are factory code: versioned, PR-reviewed,
exactly what `improve-factory` later edits.

## Tradeoffs & risks

- Prompt content one hop from the type definition; mitigated by the family
  field making the link explicit and lint-checkable (a registered type whose
  family file is missing fails the constitution lint).
- Longer harness messages cost prompt tokens — bounded by pointers-not-bodies
  discipline inside the skills themselves.

## Consequences for the build

- **Source of truth:** `src/library/skills/*.md`, loader in `src/library/`,
  `family` on `GoalTypeDef` (`src/contract/goal-type.ts`, barrier).
- Seed content ports from the GOAL-TYPES seed table (the dotmaz pipeline's
  field data), not invented fresh.
