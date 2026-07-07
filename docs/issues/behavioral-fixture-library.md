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

---

> **Fixed (2026-07-07, branch `issue/fixture-library`).** Grew `fixtures/` from
> one behavioral pair to five, four beyond `runtime-capture`. Each new pair is a
> minimal artifact/repo + a defective twin + a vitest asserting the relevant
> DETERMINISTIC gate flags the defective one and passes the clean one, wired into
> the normal vitest suite (fast, parallel-safe — only `anchor-mismatch` touches a
> temp worktree, and it uses no real git). A `fixtures/README.md` table names the
> gate each pair pins.
>
> The four gates pinned (each a real deterministic check that runs before any
> judge; failure classes preferred from those seen live):
> - **scope escape** → `filesWithinScope` (diff ⊆ scope, `src/library/checks.ts`).
>   `fixtures/scope-escape/` — an artifact writing one file outside the declared
>   scope is rejected; the in-scope twin passes.
> - **process pollution** → `scanDiffForProcessLanguage` (process-clean grep,
>   `src/engine/process-clean.ts`). `fixtures/process-pollution/` — a unified diff
>   leaking a `tree/…` goal-id ref and `improve-factory` process language is
>   rejected; the clean twin passes.
> - **anchor mismatch** → `sandboxFileContains` (worktree `{file, anchor}` check,
>   `src/library/checks.ts`). `fixtures/anchor-mismatch/` — a criterion whose
>   anchor was reworded away fails against the worktree; the true-anchor twin
>   passes.
> - **dead criterion** → `criteriaWellFormed` (criteria ship gate,
>   `src/library/acceptance-criteria.ts`). `fixtures/dead-criterion/` — a
>   `{script}` check naming a raw command line instead of a declared script name
>   is rejected at author-time (the "dead on arrival" failure from live-tail run
>   18); the declared-name twin passes.
>
> **Deviation from the acceptance hint's fourth pair (secret-value leak /
> vault-ref scan):** no deterministic value-shaped secret scanner exists in the
> repo. `src/library/risk.ts` classifies risk by PATH, not by value, and there is
> no vault-ref/secret-value gate to pin — that judgement is judge-side, not a
> deterministic floor. Rather than invent a gate to pin (the pin would be
> circular), the fourth pair swaps to `dead-criterion` → `criteriaWellFormed`, a
> real deterministic gate guarding a failure class actually seen live. Noted in
> `fixtures/README.md` "Note on the fourth gate".
>
> Verification: the six relevant test files (five fixtures + the existing
> `process-clean-gate.test.ts`) are green (35 tests); `npx tsc --noEmit` clean;
> `npm run lint` clean; `tests/library` fully green (692); `tests/engine` green
> except the documented parallel-load flake in `convergence.test.ts`
> (`test-suite-parallel-load-timeouts.md`), which passes when rerun solo. No
> existing source or test files were modified — only new fixtures and tests added.
