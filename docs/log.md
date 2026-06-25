---
type: log
title: Corellia change log
description: Reverse-chronological log of Corellia's build. Completed work references an iteration or ADR; undone work lives in docs/issues/.
timestamp: 2026-06-25
---

# Corellia log

OKF change log — newest first. Each entry is terse: **completed** work points at
the [iteration](iterations/index.md) or [ADR](adrs/index.md) that owns the detail;
**undone** work lives as an [issue](issues/index.md) and is not narrated here.

This file replaces the former `STATUS.md`. Forward strategy is no longer a
standalone roadmap — it lives as open issues.

## 2026-06-25

- **decide-json-robustness fixed** (`src/brains/llm.ts`). A large free-text root
  intent no longer blocks the tree at decision #1: the goal spec is rendered as
  readable labeled text in the decide/produce/judge prompt instead of an escaped
  JSON blob the model echoed back malformed, plus a meaning-preserving JSON-repair
  pass before any re-ask. Clears the named blocker on commissioning large
  factory-self-modification intents through `live:self`. The issue was implemented
  and deleted (ephemeral); 1482 tests green.
- **Docs reorganized to OKF.** Iterations became date-prefixed migration-style
  dirs with a catalog ([iterations/index.md](iterations/index.md)); an ephemeral
  [issues/](issues/index.md) backlog was stood up (21 issues seeded from the
  tiutni gap audit, the roadmap's future work, and the milestone-loop's unbuilt
  steps); `STATUS.md` → this log; `ROADMAP.md`, `gaps-from-tiutni.md`,
  `milestone-loop-SPEC.md`, and `prototype-build-notes.md` were folded into
  iterations/issues and deleted. See
  [corellia: docs OKF migration](iterations/2026-06-24-03-milestone-loop/index.md)
  context.

## 2026-06-24

- **Milestone loop steps 1–6 + ADR-033 landed on main.** `deliver-intent` gains a
  re-enterable split body (the four-guard halt); budget reframed as a non-steering
  safeguard; a signature-less split re-decide now terminates as non-convergence.
  Steps 7 (live proof) and 8 (slice-nesting) remain open —
  [step-7](issues/milestone-loop-step-7-prove-live.md),
  [step-8](issues/milestone-loop-step-8-slice-nesting.md). Detail:
  [iteration 13](iterations/2026-06-24-03-milestone-loop/index.md),
  [ADR-031](adrs/ADR-031-milestone-iteration.md),
  [ADR-032](adrs/ADR-032-acceptance-criteria-verify-on-read.md),
  [ADR-033](adrs/ADR-033-budget-is-a-non-steering-safeguard.md).
- **The `commission` front door shipped and was proven** end to end (a dogfood run
  also reproduced the milestone-loop block in ~$0.20 single-file form). Detail:
  [iteration 12](iterations/2026-06-24-02-commission-frontdoor/index.md).
- **Gap audit from driving tiutni** (an external greenfield product) through the
  factory. Captured as the [issues backlog](issues/index.md). Detail:
  [iteration 11](iterations/2026-06-24-01-gap-audit-tiutni/index.md).
- **AC-4 PROVEN** — the factory delivers to a FOREIGN repo (cats) and opens a
  clean PR autonomously ([PR #3](https://github.com/kmazanec/cats/pull/3), $0.13,
  no `.venv` leak, did not self-merge). 9 live runs, each buying one engine/harness
  fix. Detail: [iteration 10](iterations/2026-06-24-00-deliver-foreign/index.md).
- **AC-3 PROVEN — the strange loop is closed.** The factory built a feature on its
  OWN repo and opened a real PR ([PR #6](https://github.com/kmazanec/corellia/pull/6),
  $0.39). This was the named blocker on AC-3/AC-4 since iteration 06. Detail:
  [iteration 09](iterations/2026-06-23-00-comprehension-scoping/index.md).

## 2026-06-23

- **AC-2 PROVEN LIVE** — a scoped intent converged end-to-end on a real foreign
  repo (cats), $0.59. Comprehension scoping (ADR-029 Decisions 2+4) + soft budgets
  (ADR-030) + transport timeout + decide-skill injection + `head_sha` + comprehend
  hardening + native tracing. 1409 tests green. Detail:
  [iteration 09](iterations/2026-06-23-00-comprehension-scoping/index.md),
  [ADR-029](adrs/ADR-029-comprehension-recursion.md),
  [ADR-030](adrs/ADR-030-soft-budgets-until-proven.md).

## 2026-06-20

- **Recursion landed on main** (ADR-029 Decisions 1+3): `leafOnly` removed so
  comprehension obeys the split law; a structured integrate-merge composes child
  artifacts. Mechanism proven live; comprehension-over-fires finding deferred to
  iteration 09. Detail: [iteration 08](iterations/2026-06-12-21-recursion/index.md).

## 2026-06-12

- **Iteration 07 — Conventions** shipped: layered global + host conventions
  (ADR-028). 1335 tests. [Detail](iterations/2026-06-12-13-conventions/index.md).
- **Iteration 06 — Self-hosting** shipped: hosted front door + improvement loop;
  the loop closes (AC-2 1/5 — comprehension can't yet recurse → iter 08). 1345
  tests. [Detail](iterations/2026-06-12-01-loop/index.md).

## 2026-06-11

- **Iteration 05 — Taste** shipped: all 19 goal types, structured emission, intent
  dial, golden capture, learning retries. 1076 tests.
  [Detail](iterations/2026-06-11-17-taste/index.md).
- **Iteration 04 — Eyes** shipped (PR #4): brownfield comprehension + impact-aware
  splitting. 826 tests. [Detail](iterations/2026-06-11-14-eyes/index.md).

## 2026-06-10

- **Iteration 03 — Hands** shipped (PR #3): agentic leaf execution; live
  convergence at $0.07. 555 tests. [Detail](iterations/2026-06-10-21-hands/index.md).
- **Iteration 02 — Substrate** shipped (PR #2): Postgres, gates, listener,
  flywheel, live brain. [Detail](iterations/2026-06-10-10-substrate/index.md).
- **Iteration 01 — Walking skeleton** shipped (PR #1): engine, evals, budgets,
  event log. [Detail](iterations/2026-06-10-01-walking-skeleton/index.md).
