---
type: issue
title: Behavioral fixture library — the deterministic floor is one fixture deep
description: The runtime-capture fixture (ADR-042 invoice) is the only test proving the deterministic gate catches a real defect in produced software; there is no library of goal-type × defect fixtures.
tags: [tests, eval, fixtures, deterministic-gate]
timestamp: 2026-07-07
status: open
kind: future-work
severity: medium
---

# Behavioral fixture library — the deterministic floor is one fixture deep

## Problem
The strongest "did the produced software actually work?" check in the repo is the
runtime-capture fixture: one invoice, correct vs transposed, proving the same
`{capture}` criterion passes and fails appropriately. That pattern — a small
fixture repo, a known-good and a known-defective variant, and an assertion that
the deterministic floor catches the defect — exists exactly once. The factory
claims to gate many failure shapes (scope escape, process-pollution, criteria
anchors, contract exhaustiveness, regression via impacted tests) but has no
per-shape fixture proving each gate rejects a real instance of what it guards.

## Evidence
- eval-scout sweep (2026-07-07): fixtures/runtime-capture/ +
  tests/library/runtime-capture-fixture.test.ts is the sole behavioral fixture.
- DESIGN.md "Deterministic before judge, always" — the floor carries the trust;
  an unproven floor is a judge with extra steps.

## Proposed direction
Grow fixtures/ deliberately, one defect class at a time, reusing the
runtime-capture shape: each fixture = minimal repo + a defect variant + a test
asserting the relevant gate/check flags the defective one and passes the clean
one. Seed from failure classes already seen live (anchor mismatch, out-of-scope
write, process-language in comments, non-exhaustive consumer of a frozen shape).
Prefer fixtures distilled from real failed runs over invented ones — the event
log knows which defects actually occur.

## Acceptance hint
At least four distinct gates each have a fixture pair proving catch-the-defect /
pass-the-clean, running in the normal vitest suite, with a short fixtures/README
naming which gate each pair pins.
