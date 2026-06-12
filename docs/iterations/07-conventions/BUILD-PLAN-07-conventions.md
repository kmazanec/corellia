# Build plan — Layered conventions

**Status:** Draft (pending human approval) · **Iteration goal:** a code-writing
goal carries the factory's global conventions AND the relevant slice of the host
repo's `AGENTS.md`/`CLAUDE.md`, with the host overriding global on conflict;
"comments are timeless" reaches the factory at runtime via the shared preamble. ·
**Iteration slug:** `07-conventions`

Planned by following Corellia's own recursive model (not the planning workflow):
the root goal "plan iteration 07" split into a comprehension leaf (map the
injection seams), two author leaves (one build plan per feature, F-68 also
freezing the shared seam), and two judges — `judge-split` refereed the
decomposition, an opus `critique` refereed the drafted plans. The critique found
one gating defect (below); it is fixed in the specs.

## How to use this

1. A human reviews this index + the per-feature "Build plan (approved)" sections
   in each spec and approves it in conversation. The assistant flips Status to
   "Approved".
2. When ready, build: implement the frozen seam first (F-68 defines it), then
   F-68's remaining chunks, then F-69 (which edits the seam in place), reviewing
   and testing per the build conventions.

## Blockers

- None.

## Frozen contract (the shared injection seam)

| Contract | Source of truth | Frozen signature | Consumers |
|---|---|---|---|
| Convention-injection seam | ADR-028 / F-68 | `conventionsBlock: string` declared in `runStepLoop` (`src/engine/engine.ts`) after the `memoryLines` assignment, appended in the content concatenation between `memoryLines` and `priorEvidenceBlock`. Global layer gates on `kind === 'make'`; host layer gates on `kind === 'make' && this._activeAssembly !== undefined`. Posture mirrors `memoryLines` (data to weigh, not instructions); host text appended after global with the "override global on conflict" label. Empty-string contract: no global + no host ⇒ `conventionsBlock === ''`. | F-68 (defines), F-69 (edits in place) |

The seam is documented in full in `01-shared-preamble.md` (§"Shared injection
seam") and consumed in `02-host-conventions.md` (§"Consumes F-68's seam").

## Features & build order

| Feature | Spec | After | Tier |
|---|---|---|---|
| F-68 Shared skill preamble (global layer) | [01](01-shared-preamble.md) | — (defines the seam) | sonnet builder |
| F-69 Host-conventions reader (repo layer + override) | [02](02-host-conventions.md) | F-68 (hard: edits the frozen seam in place) | sonnet builder |

Serial: F-68 lands the seam + global layer; F-69 edits the seam to add the host
layer and the reader. One opus reviewer over both at the end, per build
conventions.

## Reconciliation self-review

1. **The shared seam has one owner (F-68) and one consumer (F-69)** — F-69 edits
   F-68's declaration in place, it does not redeclare. Stated in both specs.
2. **Gate asymmetry is explicit:** the global layer needs no repo root and gates
   on `kind === 'make'` alone; the host read needs the repo root and additionally
   gates on `this._activeAssembly !== undefined`. The critique proved a make goal
   can reach `runStepLoop` with `_activeAssembly` undefined (non-sandboxed,
   `effectiveBroker` falls back to `this.broker`); the unguarded dereference would
   throw — fixed in F-69's frozen snippet and Chunk 2.
3. **No new contract barrier:** the only public surface additions are
   `loadSharedPreamble` (F-68) and `loadHostConventions` (F-69); no event-log,
   goal-contract, or grant-map change.
4. **Advisory vs enforced:** the shared preamble is advisory; the constitution
   lint stays the single source for machine-enforced ceilings. F-68's AC-4 test
   pins that `_shared.md` does not restate an enforced rule as prose.
5. **Trust:** a foreign repo's convention file is injected as data to weigh and
   can shape but never command — no grant/tool/operational instruction is derived
   from it (F-69 AC-5, pinned by test). The operational-section strip is
   noise-reduction, not a security boundary; the data-not-instructions posture is
   the real safeguard.

## Critique record (the plan's own review gate)

The opus critique that refereed these plans found:
- **1 GATING (fixed):** F-69's frozen seam dereferenced `this._activeAssembly`
  unguarded — a guaranteed `TypeError` for non-sandboxed make goals (including
  F-69's own tests). Fixed: the host branch gates on `_activeAssembly !==
  undefined`, baked into the seam.
- **1 GATING (fixed):** F-69 must *edit* F-68's `conventionsBlock` declaration in
  place, not append a second `const`. Stated in the seam + Chunk 2.
- **Non-gating (folded in):** harden `loadHostConventions` against
  unreadable/binary/oversized/symlinked files (lenient `''` on any failure);
  read the source repo root (`worktree.repoRoot`), not the worktree copy;
  consolidate F-68's constitution-boundary test into one chunk and sharpen it to
  the enforced-ceilings-not-restated invariant; anchor the seam on the
  `memoryLines` symbol, not a line number.
- F-68 verdict: accept with polish (applied). F-69 verdict: revise (applied).

## Sibling thread (separate scope decision)

The comprehension-must-recurse structural fix (recorded in
`docs/prototype-build-notes.md` from the AC-2 eyes-on-cats result) is an
independent candidate for this iteration or its own. Not planned here; the human
decides its scope before building.
