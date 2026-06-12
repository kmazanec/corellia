---
id: F-68
title: "Shared skill preamble (global convention layer)"
iteration: 07-conventions
type: implement
intent: production
status: Not started
dependsOn: []
contracts: [ADR-028, ADR-022]
---

# Feature: Shared skill preamble (global convention layer)

**ID:** F-68 · **Iteration:** 07-conventions · **Status:** Not started

## What this delivers (before → after)
**Before:** global factory conventions can only live in per-family skill files
(`src/library/skills/<family>.md`); a cross-cutting rule would have to be copied
into every family, and "comments are timeless" lives only in the outer-harness
`CLAUDE.md` the factory never reads.
**After:** a single shared skill slot every code-writing family inherits at
runtime; a cross-cutting convention is written once and injected into every
relevant goal's step-loop context. "Comments are timeless" lives there.

## Reading brief
- ADR-028 (layered conventions — layer 1)
- ADR-022 (skill bundles as markdown families)
- `src/library/skills.ts` — `loadFamilySkill`, `sectionFor`, the preamble split
  (everything before the first `## heading`)
- `src/engine/engine.ts` — the step-loop harness (`~:1916`) and the judge harness
  (`~:1758`) where `loadFamilySkill` is injected; the `skillBlock` assembly
- `src/library/skills/*.md` — the existing family files
- `src/library/constitution.ts` — the machine-enforced subset (the lint), to keep
  the advisory/enforced split clean

## Contracts touched
- Skill bundle shape (source of truth: ADR-022 / ADR-028) — a shared preamble is
  resolved and prepended to a family's injected context. The `loadFamilySkill`
  result gains the shared text; consumers that inject the family preamble must
  inject the shared preamble ahead of it.

## Acceptance criteria
1. A shared skill source exists (e.g. `src/library/skills/_shared.md`) carrying
   cross-cutting, code-writing conventions; "comments are timeless" is in it.
2. `loadFamilySkill` (or the injection sites) prepend the shared preamble to the
   family preamble for code-writing families, so a goal's step-loop context
   contains the shared conventions ahead of the family-specific content.
3. The shared preamble is injected for the families that write code
   (build/deliver/improve/author as applicable); families where it does not
   apply are unaffected — no blind injection into every type.
4. The advisory/enforced split holds: the shared preamble is advisory context;
   nothing in it duplicates a constitution lint rule (the lint stays the single
   source for machine-enforced ceilings).
5. "Comments are timeless" is removed from the outer-harness `CLAUDE.md` as the
   *operative* home (CLAUDE.md may still reference that conventions live in the
   skills) and now reaches the factory at runtime via the shared preamble.
6. Prompt-content tests assert against the REAL shared skill file, never a
   synthetic stand-in (the iteration-05 lesson).

## Testing requirements
- Unit: `loadFamilySkill` returns the shared preamble prepended for a
  code-writing family; absent/non-applicable families unchanged.
- Harness-content: a code-writing goal's assembled step-loop context contains the
  shared convention text, asserted against the real `_shared` file.
- Constitution boundary: a test that the shared preamble does not re-state a lint
  rule (no duplicated source of truth).

## Build plan (approved)
*(to be drafted by the planner — kmaz-plan-iteration)*

## Implementation notes
