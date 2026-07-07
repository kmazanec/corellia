---
type: issue
title: Split-memo trust promotion has no production caller — the flywheel never pays off
description: Memos are recorded and consulted as provisional hints, but pattern-trust promotion (provisional → trusted, human signoff, trusted short-circuit) is dead code in a running system.
tags: [engine, flywheel, split-memo, pattern-trust, human-gate]
timestamp: 2026-07-07
status: open
kind: bug
severity: medium
---

# Split-memo trust promotion has no production caller — the flywheel never pays off

## Problem
The structure flywheel is half-wired: recurring splits are recorded and re-read as
provisional hints, but `pattern-trust.ts` — the provisional→trusted promotion, the
one-time human signoff DESIGN.md names as an authority-gap act, and the
trusted-memo short-circuit (walk verbatim, skip fresh derivation) — is called only
by its own test. No running system can ever promote a memo, so every matching
subtree pays full fresh-derivation cost forever and the design's central
cost/reproducibility payoff ("runtime chaos that proves itself becomes
determinism") never fires. The `promoted-to-trusted, signed_off_by` provenance
event exists in prose only.

## Evidence
- capability-scout sweep (2026-07-07): "provisional→trusted promotion has no
  production caller (src/engine/pattern-trust.ts called only by its test); the
  trusted-memo short-circuit is dead in a running system."
- DESIGN.md "Memoized splits — hybrid promotion authority" (autonomous →
  provisional; human signoff → trusted; demotion deliberate).
- The projectPatternTrust projection already exists (src/eventlog/projections.ts).

## Proposed direction
Wire the existing pieces end to end: recurrence detection over the event log
proposes promotion candidates (the `propose-pattern` type already exists);
promotion-to-trusted becomes an operator act through the front door (a brief or a
CLI `corellia trust <memo>` appending the signoff event — never automatic, per the
authority gap); the decide path consults trust state and walks a trusted memo
verbatim, emitting an event that records the short-circuit. Demotion on golden
divergence can wait for the calibration harness; a manual demote command is enough
to start.

## Acceptance hint
In a test (and then a live run): the same spec-shape run twice yields a
recurrence-backed promotion candidate; a signoff act promotes it with
`signed_off_by` in the log; a third run walks the trusted memo verbatim and the
log shows the skipped fresh derivation.
