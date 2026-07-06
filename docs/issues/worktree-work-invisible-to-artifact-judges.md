---
type: issue
title: "work delivered in the worktree is invisible to artifact-reading judges and to the merged artifact"
description: An attempt's write_file output (including work salvaged from a wall-clock-denied sibling) lives in the tree worktree, but the merged files artifact only carries what a later attempt happened to re-emit — so judge-acceptance failed a run for "missing" files that were sitting, real and correct, in the worktree.
tags: [engine, artifact, worktree, salvage, judge, acceptance, milestone-loop, integrate-merge]
timestamp: 2026-07-01
status: fixed-pending-live-proof
kind: bug
severity: high
---

# Work delivered in the worktree is invisible to artifact-reading judges and to the merged artifact

## Problem

There are two records of what a tree delivered: the **worktree** (where every
`write_file` lands, including work preserved by worktree salvage when an attempt
blocks) and the **emitted `files` artifact** (what the model's structured
emission happened to list). They diverge — and everything downstream that reads
the artifact instead of the worktree then under-credits real work:

1. **The merged root artifact drops files.** A goal denied on wall-clock leaves
   its files in the shared worktree (salvage works), but no later emission
   credits them, so the root's merged `files` artifact omits the actual
   implementation.
2. **`judge-acceptance` reads the artifact, not the worktree.** It failed a run
   with "package.json is missing from the artifact — no CLI command is
   discoverable or wired" while the worktree contained the modified
   `package.json`, the CLI script, the module, and tests.

The deterministic half of this ({file} acceptance criteria checking the artifact
list) was fixed on 2026-07-01 (`sandboxFileContains` reads the round's worktree,
per ADR-031 §4.3). The judge half and the merged-artifact crediting remain open.

## Evidence

Commission run `observability-live-tail` (2026-07-01, $2.17, events under
`out/commission-observability-live-tail/`). Goal `impl-live-view` wrote
`scripts/view-run.ts`, `src/eventlog/tail.ts`, `tests/eventlog/tail.test.ts`,
then was denied on wallClockMs; the files stayed in worktree
`observability-live-tail-286fcc5a`. The retry goal `impl` succeeded but its
emission listed only its own docs work + one test file. Root merged artifact: 5
files, none of the implementation. `judge-acceptance` FAIL on "missing" files
that existed in the worktree.

> **Update (2026-07-01, third live-tail run).** A sharper variant: worktree
> salvage attaches only the UNCOMMITTED diff, so when the milestone loop has
> already committed round work to the tree branch, a subsequently-blocked goal's
> report carries `artifact: null` even though 1,089 lines (tailer, renderer,
> tests, a round-0 `feat` commit) sit committed on the branch. Dependents then
> block with "dependency failed without producing any usable artifact" — while
> the usable artifact is one `git diff base..HEAD` away. The salvage/crediting
> path must consider the branch diff against the tree's base sha, not just
> `git status`.

> **Update (2026-07-05, run 7 — the strongest evidence yet).** With the
> deterministic floor fixed (file criteria read the worktree), run 7 reached
> 6/7 acceptance criteria and its branch carried the COMPLETE deliverable —
> live-tail module, CLI, tests, and the OKF close-out (iteration record,
> log.md entry, issue update) across three round commits. The integration
> judge still failed the root with "OKF close-out not present in artifact"
> because it judges the emitted artifact, which no longer reflects the branch.
> The deterministic floor and the judge now read DIFFERENT worlds; the judge
> must be given the branch diff (or a worktree-derived artifact), same
> direction as proposed below.

> **Fixed (2026-07-06, commit 2fe149c) — pending live proof.** For a sandboxed
> tree the merged files artifact is now derived from the worktree's changed
> files vs the base sha (committed rounds + uncommitted + untracked, one
> authoritative content per path) in `runSplitRound`, so the integration and
> acceptance judges assess the delivered state. Run 9's judge-integration
> passed on exactly this input.

## Proposed direction

(Rough, not committed.) Make the worktree the source of truth for a sandboxed
tree's delivered files: derive the merged `files` artifact (or at least augment
it) from the worktree diff against the base sha — the same diff the collect/PR
boundary already computes — rather than from what emissions happened to list.
Then artifact-reading judges see what was actually delivered, and salvage is
credited by construction.

## Acceptance hint

A run in which one attempt writes files and blocks, and a later attempt
completes, produces a merged artifact (and a judge-acceptance subject) that
contains the blocked attempt's salvaged files. No judge failure names a file
"missing" that exists in the tree worktree.
