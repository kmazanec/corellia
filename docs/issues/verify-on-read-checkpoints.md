---
type: issue
title: Verify-on-read fires at only the split checkpoint — decide and integrate deferred
description: DESIGN's checkpoint consistency re-reads depended-on facts at decide, split, AND integrate; today only the split checkpoint verifies, and lesson memories get no verify-on-read at all.
tags: [engine, knowledge, memory, verify-on-read, consistency]
timestamp: 2026-07-07
status: open
kind: future-work
severity: medium
---

# Verify-on-read fires at only the split checkpoint — decide and integrate deferred

## Problem
Corellia's named consistency model is checkpoint consistency: "every goal re-reads
the facts it depends on at each decide / split / integrate checkpoint … never
silently wrong at a moment of trust." In code, knowledge freshness fires only at
the split checkpoint; the decide and integrate checkpoints are explicitly deferred
(src/engine/options.ts:102-104), and lesson memories get no verify-on-read
anywhere. The integrate edge is the costliest place to act on a stale fact — it is
where verdicts are rendered — and it currently trusts whatever the split saw,
however long ago. This also weakens lateral coordination: a sibling's mid-tree
write is only noticed if a split happens to occur afterward.

## Evidence
- capability-scout sweep (2026-07-07): "Verify-on-read fires at only 1 of 3
  checkpoints — decide/integrate deferred (options.ts:102-104); lesson memories
  get no verify-on-read."
- DESIGN.md "Branches coordinate through shared state, by pull — checkpoint
  consistency."

## Proposed direction
Extend the existing split-checkpoint mechanism to decide and integrate — same
freshness query, same targeted-refresh-on-failure, no new machinery. Keep it
cheap: verify only the facts the checkpoint actually consumes (the artifact
categories in the goal's coverage set), and dedupe by SHA so an unchanged repo
costs one head check. Lesson-memory verify-on-read can follow as a second step
(facts with a file:line anchor re-check the anchor; anchorless lessons are
suggestions and stay label-only).

## Acceptance hint
A test that moves the repo SHA (or rewrites a depended-on fact) between a split
and its integrate sees the integrate checkpoint catch the drift and trigger
refresh/re-decision instead of judging against the stale fact.

---

> **Fixed (2026-07-07, branch `issue/verify-checkpoints`; pending live proof).**
> The existing split-checkpoint verify-on-read now fires at the decide and
> integrate checkpoints too, so all three of DESIGN's consistency checkpoints
> re-read the facts they depend on. No new machinery: both new checkpoints compose
> the same `checkpointVerifyArtifacts` the split gate already uses (per-artifact SHA
> short-circuit → self-validate the drifted → mint the same refresh child on
> failure).
>
> **What was built.**
> - A shared primitive `src/engine/checkpoint-verify.ts`
>   (`verifyKnowledgeAtCheckpoint`) wraps `checkpointVerifyArtifacts` with the cheap
>   head-SHA fast path the issue asks for: one per-tree `Map<repoRoot, sha>` memo
>   (`CheckpointShaMemo`), keyed by repoRoot (unique per tree's worktree, so a new
>   tree starts cold automatically). When HEAD equals the last-reconciled SHA, the
>   checkpoint returns after a single `headSha` call — no artifact query, no
>   self-validation. The memo advances once a HEAD is *processed* (clean, or its
>   drift handed to a refresh), so a later checkpoint at the same HEAD never
>   re-mints the same refresh — "bounded staleness, each HEAD reconciled once."
> - **Decide checkpoint** (`src/engine/decision/phase.ts`, `verifyKnowledgeAtDecide`):
>   fires before the decision is derived, for non-leaf goals. A caught drift is
>   evented (`knowledge-checked`, `checkpoint: 'decide'`) and its refresh is
>   sequenced ahead of fan-out by the split gate that follows, so the decomposition
>   is planned against fresh facts. For a leaf that satisfies (no split gate), this
>   is the verify-on-read it otherwise never got.
> - **Integrate checkpoint** (`src/engine/integrate-checkpoint.ts`,
>   `refreshDriftedKnowledgeBeforeIntegrate`, wired in `split-round.ts`'s
>   `integrateWithRepair`): fires before `judge-integration` renders its verdict. A
>   drift that fails self-validation spawns and runs its refresh comprehension child
>   — evented and scheduled exactly like the repair rung's fixer — so the verdict is
>   rendered against refreshed knowledge, not the stale fact. Self-validation is the
>   guard against churn: a map whose anchors still resolve after the tree's own edits
>   reads `stale-validated` and proceeds, so the tree's in-flight commits do not
>   trigger a wasteful whole-repo re-map.
> - The `knowledge-checked` event gained an optional `checkpoint: 'decide' | 'split'
>   | 'integrate'` discriminator (`src/contract/events.ts`, validated in
>   `event-parser.ts`) so the trace shows where a drift was caught; unlabelled events
>   read as the original split wiring.
>
> **Threading.** `createRecursiveRunner` builds one memo per tree and threads it,
> plus the freshness slice of the knowledge gateway (`checkpointGatewayFrom`), to
> both the decide phase and the split runner → split round. Absent knowledge wiring,
> every checkpoint is a no-op, so a run without knowledge is byte-identical to
> before (regression guard: gates.test's "fresh knowledge does not add brain calls
> vs no-wiring baseline" stays green).
>
> **Lesson-memory verify-on-read: left out of scope (as the issue permits).** The
> anchored case did not compose cheaply: `MemoryPointer.content` is unstructured
> free text ("what to recall and where to look"), with no typed `file:line` anchor
> field and no existing anchor-extraction primitive — so re-checking an anchor at
> decide/integrate would mean a new content-parser plus fs access threaded through
> two more call sites (new machinery, which the issue asks to avoid). The
> knowledge-artifact pointers ALREADY carry typed anchors and self-validate through
> `validate()`, and that is what the three checkpoints now verify. Anchored
> lesson-memory verify-on-read remains open follow-on: add a typed anchor to
> `MemoryPointer` (or a parser) first, then reuse `verifyKnowledgeAtCheckpoint`'s
> shape.
>
> **Tests (all green; tsc + lint clean).** `tests/engine/checkpoint-verify.test.ts`
> proves the unchanged-SHA fast path (one head check, no re-query/validate) and the
> handled-drift memoization. `tests/engine/checkpoint-integrate-decide.test.ts`
> proves (a) decide-checkpoint drift is caught and evented before the decision, (b)
> integrate-checkpoint drift spawns and runs the refresh BEFORE the integration
> judge sees the artifact (run-order asserted), and the absent-gateway no-op. The
> existing split-gate corpus (`gates.test.ts`, `coverage-checkpoint.test.ts`,
> `coverage-split-gate.test.ts`, `repair-integration.test.ts`) stays green. Full
> engine + contract suite: 957/957 on a clean run (the `convergence*` git-heavy
> files flake only under full-suite parallel load, per
> `docs/issues/test-suite-parallel-load-timeouts.md`; each passes in isolation). A
> live run catching real lateral drift between a split and its integrate is the
> confirming proof.
