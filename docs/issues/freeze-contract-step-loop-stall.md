---
type: issue
title: "freeze-contract leaf reads instead of writing: emits an architecture map, never write_file, isomorphic-blocks"
description: The freeze-contract leaf spent all 13 steps reading (47 read/list/search calls, zero write_file) and emitted a map-repo-style architecture characterization instead of contract files. The gate correctly rejected it ("no implementation artifacts"); the identical retry produced the same rejection, escalating to an isomorphic block that cascaded and stopped delivery. A behavior bug (wrong output mode), not a tooling or budget gap.
tags: [engine, build, freeze-contract, output-mode, make-vs-comprehend, isomorphic-failure, split-scope, commission]
timestamp: 2026-06-27
status: open
kind: bug
severity: high
---

# freeze-contract leaf reads instead of writing, emits the wrong artifact kind, isomorphic-blocks

## Problem
With the commission harness fixed (real broker/sandbox), the
`visual-runtime-verification` commission decomposed correctly and `map-repo`
(`c1`) succeeded — but the next leaf, `freeze-contract` (`c2`), **never wrote a
file**. It spent its entire step loop reading the codebase and then emitted a
`map-repo`-style **architecture characterization** (a knowledge artifact of
`category:"architecture"` with `pointers` + `summary`) instead of the
interface/type files it was asked to create. The deterministic gate +
`critique-code` judge correctly rejected that ("No implementation artifacts
present — architecture characterization only"); the retry behaved identically, so
the engine saw a repeating failure signature (`step-loop:failed`), escalated to an
**isomorphic-failure block**, auto-denied (no human on a commission run), and the
block cascaded through every dependent, stopping delivery.

This is a **behavior bug — the leaf ran in the wrong output mode (comprehend, not
make)** — NOT the tooling/budget/context-thrash story first suspected. The leaf
had every tool it needed and used them freely.

## Evidence
`visual-runtime-verification` re-run (2026-06-27, broker-wired harness, $40
ceiling). `c2` = the `freeze-contract` leaf. Goal type is a real `make`/`build`
leaf (`src/library/types/build.ts`): `leafOnly`, grants `fs.read` + `fs.write`,
deterministic `[artifactPresent, filesWithinScope, processClean]`, judge
`critique-code`. Budget was generous: `toolCalls: 800`, `tokens: 2_000_000`.

Tool usage across 13 steps (47 calls, all `ran` except 2 dedup refusals):

| tool        | calls | outcome |
|-------------|------:|---------|
| read_file   | 22    | ran |
| list_dir    | 15    | ran |
| list_dir    | 2     | refused (1 empty-path, 1 F-64 duplicate-read guard) |
| search      | 8     | ran |
| **write_file** | **0** | — |

Every one of the 13 `step` events had `outputKind: tool-calls`; **none was
`artifact`** until the final forced emit. Per-step prompt tokens grew 3.5K → 22K
(steady reading) while completion tokens stayed tiny (12–386), i.e. terse tool
calls, never composing file bodies. The emitted artifact was the architecture
map, not files. c2 step-loop cost ~$0.064; whole re-run ~$0.23 (far under $40).

The block brief: *"Goal ... is repeating the same failure (signature:
'step-loop:failed'). Needs human resolution"* → auto-resolved `deny` (30s
deadline, no human). Final report blocker:
`Isomorphic failure detected (signature: step-loop:failed) — escalating to block`.

### Secondary finding: the split hallucinated scope paths
`c2`'s declared scope named **files that do not exist** —
`src/library/capture-engine.ts` and `src/library/goal-types.ts` — whereas the
real homes are `src/engine/` and `src/library/types/<family>.ts`. The split
invented plausible-but-wrong paths. This likely *reinforced* the read-loop: the
leaf could not find its scoped files, so it kept exploring to locate them instead
of writing. (Same family as
[out-of-scope-edit-enforcement](out-of-scope-edit-enforcement.md) /
[dive-anchor-hallucination-blocks-region](dive-anchor-hallucination-blocks-region.md):
hallucinated paths/anchors derailing a leaf.)

## Why it happened (hypotheses, now narrowed)
1. **Output-mode confusion (primary).** A `make` leaf produced a comprehend-shaped
   artifact. The model treated "freeze the contract" as "characterize the
   contract surface" and emitted a map. The make step-loop prompt / type skill is
   not strongly steering a contract-freezing leaf to *write declaration files*.
2. **Hallucinated scope paths (contributing).** Non-existent scoped files
   (`capture-engine.ts`, `goal-types.ts`) gave the leaf nothing to open, feeding
   the read loop instead of a write.
3. **Identical retry → isomorphic block (amplifier).** The retry re-ran the same
   prompt and produced the same wrong-mode artifact, so the no-progress detector
   fired. The detector is working as designed; the upstream behavior is the bug.

## Proposed direction
- Steer the `freeze-contract` (and `make`-family) leaf to **write declaration
  files**: tighten the type skill / step-loop preamble so a freeze leaf's success
  is "files created/modified under scope", and consider a deterministic nudge when
  many reads accrue with zero writes ("you have read N files and written none;
  emit the artifact").
- Fix the split so scoped paths are **real** (validate scope paths against the
  repo at split time, or have the freeze leaf create the declared file even when
  it does not pre-exist rather than searching for it).
- On retry after a wrong-output-mode rejection, **vary the prompt** with the
  judge's reason ("no implementation artifacts present — write the files") so the
  retry is not isomorphic. (Overlaps
  [error-signature-repair-hints](error-signature-repair-hints.md).)
- Secondarily, a salvage rung so a partial set of frozen files emits rather than
  zero. (Overlaps [salvage-on-repeated-failure](salvage-on-repeated-failure.md).)

## Acceptance hint
Re-running `visual-runtime-verification` gets a `freeze-contract` leaf that calls
`write_file` and emits contract-declaration files under real scoped paths — not an
architecture map — and the tree proceeds past `c2`. Failing that, a wrong-mode
rejection feeds a non-identical retry (carrying the judge's reason) instead of an
immediate isomorphic block.
