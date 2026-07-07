---
type: issue
title: "frozen {file, anchor} acceptance criteria guess identifier names the implementation never promised"
description: Criteria are minted at round 0, before any code exists, so file/anchor checks encode guesses about identifiers ("live-view.ts contains EventStore", "the test contains follow"). A legitimate implementation that names things differently can then never pass — run 22 ended 9/11 with every goal green, blocked only by two such anchor mismatches.
tags: [engine, acceptance-criteria, milestone-loop, anchors, author-acceptance-criteria, adr-032]
timestamp: 2026-07-07
status: open
kind: bug
severity: medium
---

# Frozen {file, anchor} criteria guess identifier names the implementation never promised

## Problem

The ADR-032 done-condition freezes acceptance criteria at round 0 — before any
implementation exists. `{script}` criteria age well (the suite either passes or
it doesn't), but `{file, anchor}` criteria encode the author's GUESS about what
the not-yet-written code will name things. A legitimate implementation that
chooses different names then fails the criterion forever: the milestone loop
burns rounds "fixing" code that is not broken, or ends unmet.

## Evidence

Run 22 of the `observability-live-tail` commission (2026-07-07, events under
`out/commission-observability-live-tail/`): every goal in the tree passed —
criteria authored, implement, judge-acceptance, open-pr, plus a follow-up fix
round — and the run ended at 9/11 criteria with ZERO blocks. The two unmet:
`both-stores` required `src/eventlog/live-view.ts` to contain the string
`EventStore`, and `new-behavior-tested` required the test to contain `follow`.
The delivered code (1,376 insertions on `keep/live-tail-run22`) implements both
behaviors under different names.

## Proposed direction

(Rough, not committed.) Options, not mutually exclusive:
- Steer the author (skill text for `author-acceptance-criteria`) to prefer
  `{script}` checks and BEHAVIORAL anchors (a CLI flag in a usage string, a
  package.json script name — things the spec itself fixes) over implementation
  identifiers it cannot know.
- Let the milestone loop's re-decide propose an anchor CORRECTION when the
  claim is met but the anchor string is stale — a bounded, evented amendment
  rather than a violation of the freeze (the claim stays frozen; only the
  probe moves).

## Acceptance hint

A run whose implementation satisfies a criterion's CLAIM under different
identifier names converges — either because the minted anchors only reference
spec-fixed strings, or because the loop can amend a stale anchor without
weakening the claim.
