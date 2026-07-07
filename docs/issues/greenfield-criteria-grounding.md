---
type: issue
title: "author-acceptance-criteria cannot ground criteria for a greenfield/empty-scope deliverable and explores unboundedly"
description: For a goal whose scope is an empty directory (greenfield CLI), the criteria leaf reads the host repo 50-90+ steps searching for anchors that cannot exist yet, never emits, and runs out the tree deadline — six daemon proof runs, zero criteria frozen, while the implement leaf built and judge-passed the same deliverable in ~2 minutes. Criteria authoring needs a greenfield mode grounded in the spec, not the repo.
tags: [engine, acceptance-criteria, milestone-loop, greenfield, anchors, explore-economy, deliver-intent]
timestamp: 2026-07-07
status: open
kind: bug
severity: high
---

# author-acceptance-criteria cannot ground greenfield criteria and explores unboundedly

## Problem

ADR-032 acceptance criteria are verify-on-read: each criterion anchors to a
file, script, or capture. For a **greenfield** deliverable — a CLI to be created
in an empty scope directory — there is nothing to anchor to at authoring time.
The criteria leaf responds by surveying the HOST repo for grounding it can never
find: 50–92 read-class tool calls across 27–32 minutes, never emitting, until
the ADR-046 tree deadline kills it. Its null artifact then cascade-blocks
judge-acceptance and the PR leaf, and the milestone loop never gets a
done-condition (`0/0` criteria in every round).

The prompt-pressure mechanisms all fired and were insufficient: the make-goal
read-without-write nudge (once, at 12 reads, ignored for 78 more); the
`_explore-economy` skill's scope-anchoring guidance; and the new two-stage
read-without-emit steer never fires for this type at all — the type carries a
write grant, so it is not explore-then-emit shaped under ADR-039's key.

Meanwhile the IMPLEMENT leaf for the same goal builds the CLI and passes its
judge in ~2 minutes — the factory can do the work; it cannot freeze a greenfield
done-condition.

## Evidence

Daemon proof runs, 2026-07-07 (events under `out/corellia/events.jsonl`,
intents `proof-word-count-{1..6}`):

- Run 4 (deepseek pins): round-0 implement emitted a working `wc.mjs` and
  passed `critique-code`; the round-1 "Mint acceptance criteria" leaf ran 8.9
  min to the tree deadline. 0/7 → 0/0 criteria.
- Run 5b (defaults + 300s high-band timeout): criteria leaf made ~50 reads over
  32 min — reading `src/library/skills/*`, engine sources, docs — never emitted.
- Run 6 (with the read-without-emit steer landed): implement PASSED at 2.4 min;
  the criteria leaf made 92 reads over 27 min, never emitted. The steer did not
  apply (write grant → not explore-then-emit shaped).

Contrast: the live-tail commission (runs 18–22, a brownfield goal with a real
scope) minted 11 runnable criteria first-try — grounding existed, so authoring
converged. Related: [frozen-anchor-criteria-guess-identifiers](frozen-anchor-criteria-guess-identifiers.md)
is the same grounding disease at a later stage (criteria that DID emit but
guessed identifier anchors the implementation legitimately named differently).

## Proposed direction

(Rough, not committed.) A **greenfield mode** for criteria authoring, selected
mechanically when the goal's scope is empty/nonexistent at authoring time:

- Ground criteria in the SPEC, not the repo: behavioral criteria expressed as
  `{script}` / `{capture}` checks the factory will run against the deliverable
  once it exists (e.g. "node wc.mjs 'a b c' prints 3"), plus `{file}` existence
  anchors under the scope. No repo survey — the spec is the only ground truth a
  greenfield goal has.
- Possibly sequence criteria AFTER a walking-skeleton round (the anchors then
  exist), which is also the natural fix for the anchor-guessing issue — at the
  cost of a round-0 without a frozen done-condition (ADR-031/032 tension to
  resolve deliberately, not by patch).
- Widen the read-without-emit steer's trigger to any outputSchema leaf
  regardless of write grant, as a cheap backstop either way.

## Acceptance hint

A greenfield deliver-intent (empty scope dir) freezes runnable acceptance
criteria within a bounded number of reads (no host-repo survey), the milestone
loop assesses non-0/0 rounds, and the tree converges to a collected worktree /
PR — proven via a daemon commission like proof-word-count.
