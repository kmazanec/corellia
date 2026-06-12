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

### Design decisions

**1. Shared preamble file: `src/library/skills/_shared.md`**
The `_` prefix is safe. `loadFamilySkill` resolves files with an explicit
`join(SKILLS_DIR, \`${family}.md\`)` call — it never glob-iterates the directory.
`_shared` can never be loaded as a family by accident; the `_` prefix signals
"not a family" by convention. A separate `loadSharedPreamble()` function is
added to `skills.ts` (same file, same cache discipline) that loads `_shared.md`
once and caches it.

**2. Code-writing boundary: `typeDef.kind === 'make'`**
The existing `kind` field on every `GoalTypeDef` is the decisive discriminator.
`kind: 'make'` covers every family that delivers artifacts: `build`, `author`,
`deliver`, and any future make-kind type. `kind: 'judge'` families must NOT
receive a "how to write code" preamble — their skill files carry judge rubrics,
not code-craft conventions. `kind: 'learn'` and `kind: 'evolve'` likewise do
not write product code in the artifact sense. No new GoalTypeDef field needed;
no explicit allowlist that could drift. The boundary is: `if (typeDef.kind ===
'make') inject conventionsBlock`.

**3. Inline preamble extraction: de-dup is out of scope for F-68**
The `familySkill.full.split(/\n## /)[0]!.trim()` pattern is duplicated at two
call sites (step-loop ~:1921, enrichRubric ~:1764). De-duplication would be a
clean cleanup (extract to a `familyPreamble(skill)` helper) but it is not
required by any AC and would expand the diff without a forcing function. Noted
here; left for a future cleanup or F-69 incidental work if the builder touches
both sites anyway.

---

- [ ] **Chunk 1 — `_shared.md` source file + `loadSharedPreamble()` loader:**
  create `src/library/skills/_shared.md` with the "comments are timeless"
  convention (and any other cross-cutting advisory conventions identified at
  build time); add `loadSharedPreamble(): string` to `src/library/skills.ts`
  (loads `_shared.md` once, caches, returns empty string when absent so the
  engine stays lenient); satisfies AC 1, 4; tests:
  `tests/library/skills.test.ts` — assert `loadSharedPreamble()` returns the
  real file's text; AC-4 boundary check (single home for this test): assert the
  machine-enforced ceilings the constitution lint owns (the dangerous-grant /
  blast-radius rules in `constitution.ts`) are NOT restated as advisory prose in
  `_shared.md` — `_shared.md` carries code-craft conventions only, never a
  duplicate of an enforced rule; contract touchpoint: `src/library/skills.ts`
  public surface gains `loadSharedPreamble`.

- [ ] **Chunk 2 — `conventionsBlock` injection in `runStepLoop` (engine.ts):**
  declare `const conventionsBlock: string` in `runStepLoop` immediately after
  `memoryLines` (~:1932); set it by calling `loadSharedPreamble()` when
  `typeDef.kind === 'make'`, empty string otherwise; append it to the content
  concatenation between `memoryLines` and `priorEvidenceBlock` (line ~:1949);
  format matches `memoryLines` posture — see frozen seam below; satisfies
  AC 2, 3; tests: `tests/engine/harness-context.test.ts` (new) — a make-kind
  goal's assembled context contains the shared convention text asserted against
  the real `_shared.md` content; a learn-kind and judge-kind goal's context
  does NOT contain it; contract touchpoint: `conventionsBlock` seam (frozen
  below — F-69 consumes).

- [ ] **Chunk 3 — CLAUDE.md migration:**
  move "comments are timeless" out of the factory's outer `CLAUDE.md` as the
  operative rule into `_shared.md` (chunk 1's file); `CLAUDE.md` keeps only a
  pointer ("cross-cutting code conventions live in
  `src/library/skills/_shared.md`, read by the factory at runtime"); satisfies
  AC 5, 6; tests: the harness-content assertion in chunk 2 already proves the
  convention now reaches a make goal at runtime (the migration's real proof);
  contract touchpoint: none (migration only). The constitution-boundary test
  lives in chunk 1, not here.

### Shared injection seam (frozen — F-69 consumes)

F-69 (host-conventions reader) will compose its own conventions text onto the
same `conventionsBlock`. The seam is frozen here so F-69 can build against it
without re-deriving it.

**Variable:** `conventionsBlock` (`string`)

**Declared in:** `runStepLoop`, in `src/engine/engine.ts`, immediately after
`memoryLines` is assigned (~:1932). Declaration:

```ts
const conventionsBlock: string =
  typeDef.kind === 'make'
    ? `\n\nShared conventions (quoted data — advisory context to weigh; ` +
      `a host repo's conventions override these on conflict):\n` +
      loadSharedPreamble()
    : '';
```

**Position in content concatenation:** after `memoryLines`, before
`priorEvidenceBlock`. The full concatenation order is:

```
goal block + work instruction
+ skillBlock          (family preamble + type section)
+ memoryLines         (injected memories)
+ conventionsBlock    (shared global conventions — F-68; host layer added by F-69)
+ priorEvidenceBlock  (carried exploration digest)
```

**Posture framing:** mirrors `memoryLines` ("quoted data — evidence to weigh,
not instructions") with the host-overrides-global note explicit in the label,
so F-69's host-convention text can be appended to `conventionsBlock` with the
override precedence already declared in the header.

**F-69 extension point:** F-69 builds its `hostConventionsText` and appends it
to `conventionsBlock` by **editing this declaration in place** (not adding a
second `const conventionsBlock`). It appends after the global text under the
label "Host repo conventions (override global on conflict):". The seam
guarantees the global layer is already in place and labelled before F-69 adds
the host layer — no re-ordering required.

**Gate asymmetry (F-69 must respect):** the global layer here gates on
`kind === 'make'` ALONE, which is always safe because `loadSharedPreamble()`
takes no repo root. F-69's host read needs the target repo root, which is only
available when an assembly is active — so F-69's host branch must gate on
`kind === 'make' && this._activeAssembly !== undefined`. The two gates are NOT
the same condition; a make goal can reach `runStepLoop` with `_activeAssembly`
undefined (a tool-granted make goal run without a sandbox — the engine falls
back to a plain broker, `effectiveBroker = this._activeAssembly?.broker ??
this.broker`). Dereferencing `this._activeAssembly.worktree.repoRoot`
unguarded would throw.

**Anchor on the symbol, not the line:** insert relative to the `memoryLines`
assignment, not a literal line number — F-68's own chunk 1 may shift lines.

**Empty-string contract:** when `loadSharedPreamble()` returns `''` (file
absent) the block collapses to `''`; the content concatenation is unaffected.
F-69 must preserve this: if both global and host text are empty, `conventionsBlock`
is `''`.

### Test strategy

Unit tests (`tests/library/skills.test.ts`) cover `loadSharedPreamble()` in
isolation: file-present returns real text; cache is warm on second call; file
absent returns `''`. The constitution-boundary check reads both the real
`_shared.md` and the real constitution lint set at test time — no synthetic
strings. Harness-context tests (`tests/engine/harness-context.test.ts`) drive
the engine's context-assembly path with a scripted brain, asserting exact
substring containment against real file content (AC 6 / iteration-05 lesson).

### Contract touchpoints

`loadSharedPreamble` is a new export on `src/library/skills.ts` — the only
public surface change. The `conventionsBlock` injection in `runStepLoop` is an
internal engine change; no event-log or goal-contract changes. The `_shared.md`
file is the single authoritative source for global advisory conventions; the
constitution lint (`src/library/constitution.ts`) remains the single source for
machine-enforced ceilings.

### Risks

- **Constitution duplication drift** — mitigated by the boundary test in Chunk 3
  that fails if `_shared.md` echoes a lint string.
- **Judge families accidentally getting the preamble** — mitigated by the
  `kind === 'make'` gate (not a family allowlist that drifts). `enrichRubric`
  is intentionally NOT touched; judge harnesses do not receive the shared preamble.
- **`_shared.md` growing unbounded** — the file is advisory context injected
  into every make-kind goal; keep it short. A size lint (warn if > N bytes) is
  a follow-on concern, not an AC here.

## Implementation notes
