---
type: issue
title: Event-log conformance checker — extend the constitution from structure to conduct
description: The constitution lints goal-type definitions at PR time, but nothing replays a real run's event log to assert the runtime invariants held (deterministic-before-judge, judges never wrote, budget monotonicity).
tags: [eventlog, constitution, eval, replay, projections]
timestamp: 2026-07-07
status: open
kind: idea
severity: medium
---

# Event-log conformance checker — extend the constitution from structure to conduct

## Problem
`src/library/constitution.ts` guards the library's *shape* (grant ceilings,
judge-no-write, on_timeout presence) at lint time. Whether a *run* actually obeyed
the invariants — every judge verdict preceded by its deterministic checks, no
write event attributable to a judge-kind goal, spend monotone and under ceiling,
every blocked touchpoint carrying a deadline, park always releasing scope — is
asserted nowhere except one scripted e2e tree. The event log contains everything
needed to check conduct after the fact; the factory just never reads it back for
that purpose. As live runs multiply, a conformance pass over each log is the
cheapest possible audit: pure projection code, no model calls.

## Evidence
- eval-scout sweep (2026-07-07): constitution is structural only
  (src/library/constitution.ts); ordering asserted once in
  tests/e2e/greeting.test.ts against a scripted tree.
- DESIGN.md "The event log — the substrate under everything": every other view is
  a projection; a conformance verdict is just one more projection.

## Proposed direction
A `checkConformance(events)` projection returning typed violations, plus a
`corellia conform <log>` CLI and a vitest that runs it over the fixture/e2e logs.
Start with four or five cheap invariants (deterministic-before-judge per goal;
no judge-authored writes; monotone spend ≤ ceiling; briefs carry deadlines;
worktree events well-nested) and grow by evidence. Run it opportunistically over
every live run's log; violations file issues, not fixes.

## Acceptance hint
`corellia conform out/<run>/events.jsonl` prints PASS or a typed violation list;
a deliberately corrupted log (judge write injected, gate reordered) is caught in
a unit test.
