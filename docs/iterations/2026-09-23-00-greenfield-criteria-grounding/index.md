---
type: iteration
title: "Iteration 22 — Greenfield criteria grounding: stop contradicting the criteria leaf, show it its check vocabulary, re-ground it in the spec"
description: Hand-built fix for the stuck point of daemon proof runs 4-6 — author-acceptance-criteria never emitted for an empty-scope (greenfield) deliverable. Root cause was three compounding context defects, not model stubbornness alone; each is fixed mechanically in the step loop.
tags: [iteration, factory, acceptance-criteria, greenfield, explore-then-emit, step-loop, bootstrap]
timestamp: 2026-09-23
status: landed on main; live proof pending
---

# Iteration 22 — Greenfield criteria grounding

## Source

The stuck point recorded by daemon proof runs 4-6 (2026-07-07,
`proof-word-count-{4,5b,6}`), filed as
[greenfield-criteria-grounding](../../issues/greenfield-criteria-grounding.md):
for a greenfield CLI whose scope directory does not exist yet, the implement
leaf built and judge-passed the deliverable in ~2 minutes, but the
`author-acceptance-criteria` leaf read 50-92 host-repo files until the tree
deadline and never emitted — 0/0 criteria in every round, so the milestone loop
had no done-condition. This blocks
[milestone-loop-step-7-prove-live](../../issues/milestone-loop-step-7-prove-live.md).
Hand-built per the bootstrap loop; to be re-proven through the daemon.

## Diagnosis — why the leaf could not emit

Reading the leaf's assembled context end to end showed the model was being
asked for things it could not do, and denied the one fact it needed:

1. **It was told to write files it had no tool for.** `author-acceptance-criteria`
   is `kind: 'make'` with grants `fs.read` + `retrieval.api` and an
   `outputSchema` — an explore-then-emit leaf (ADR-039). But the step-loop
   context keyed its "make goal" guidance on `kind` alone, so the leaf was told
   "your deliverable is the FILES you create… use write_file/edit_file… do NOT
   deliver by printing", plus the shared code-craft conventions and code-shape
   evidence. At 12 reads the read-without-write nudge then fired: "stop
   exploring and write the file(s) the spec names now". It had no write tools.
   (The issue's note that the read-without-emit steer was skipped because "the
   type carries a write grant" is not borne out by the type definition — it has
   no write grant. The steer did apply; it was one voice against three
   contradicting ones.)
2. **It was never told which check names were legal.** `criteriaWellFormed`
   rejects any `{ script }` / `{ capture }` name outside the tree's declared set,
   but that set lives in the tree's configuration, not in any file. The leaf
   could only discover it by reading — which it did, across the host repo — or
   by being rejected. Under the daemon the set is empty (`declaredScripts: {}`),
   so the only legal shape was `{ file, anchor? }`, which nothing told it.
3. **Nothing told it the scope did not exist.** The explore-economy skill says
   "anchor to your declared scope"; for an absent scope that anchor is empty, and
   the leaf fell back to surveying the host repo for grounding that cannot exist.

## What shipped

- **`src/engine/leaf-grounding.ts`** (new): `groundScope(root, scope)` classifies
  a leaf's scope mechanically — `greenfield` when every entry is absent or an
  empty (placeholder-only) directory, else `grounded`. `checkVocabularyFrom` /
  `checkVocabularyBlock` render the tree's declared script and capture names as
  an authoritative, complete list (or forbid the shape when none are declared).
  `greenfieldScopeBlock` tells a greenfield leaf the spec is its only ground truth.
- **Emit-shaped make leaves get emit guidance, not file guidance.** In
  `step-loop-context.ts`, the make-artifact block, shared conventions, and
  code-shape evidence render only for leaves that deliver files (`make` and not
  explore-then-emit). `shouldNudgeReadWithoutWrite` skips explore-then-emit leaves.
- **`GoalTypeDef.mintsAcceptanceChecks`** (contract): a type-level capability
  flag; `author-acceptance-criteria` sets it, and the attempt loop threads the
  check vocabulary from the tree's `CheckContext` into that leaf's step loop.
- **Greenfield steer threshold.** `readWithoutEmitSteer` fires at 6 / 12 reads
  (vs 16 / 32) for a greenfield leaf, and says why reading cannot help.
- **Skill.** The `author-acceptance-criteria` section of `author.md` now names all
  three check shapes (it omitted `{ capture }`), points at the CHECK VOCABULARY
  block, and gives the greenfield rule: `{ file }` checks for files the spec
  names; anchors only for literals the spec itself fixes, never guessed
  identifiers (which also narrows
  [frozen-anchor-criteria-guess-identifiers](../../issues/frozen-anchor-criteria-guess-identifiers.md)).

Deliberately not taken: sequencing criteria after a walking-skeleton round. It
would weaken ADR-031/032's frozen round-0 done-condition, and the fixes above
remove the reasons authoring could not converge without it.

## Verification

Focused tests: `tests/engine/leaf-grounding.test.ts` (classification, vocabulary,
blocks), `make-progress-nudge.test.ts` (no write-nudge for emit-shaped leaves;
greenfield steer threshold), `step-loop-session.test.ts` (a greenfield criteria
leaf's context carries the greenfield and vocabulary blocks and none of the
file-writing guidance). Typecheck, constitution lint, docs lint, and the full
suite run before landing.

## Still open

- **Live proof**: re-run `proof-word-count` through the daemon; success is a
  frozen non-0/0 checklist in round 0 within a bounded number of reads.
- **The daemon declares no scripts**, so daemon trees can only mint
  `{ file }` criteria and no behavioral `{ script }` check is possible — filed as
  [daemon-declared-scripts](../../issues/daemon-declared-scripts.md).
