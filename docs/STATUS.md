# Status — Corellia

**Updated:** 2026-06-11 · **Roadmap:** [ROADMAP.md](./ROADMAP.md)

## Now

Iteration 04 landed on local main; iteration 05 (Taste) planned and
awaiting approval; tier models re-bound to deepseek-v4 + kimi-k2.6.

## Iterations

| # | Iteration | Status | Build batch | Notes |
|---|-----------|--------|-------------|-------|
| 01 | Walking skeleton | Shipped | — | engine, evals, budgets, event log (PR #1) |
| 02 | Substrate + live brain | Shipped | — | Postgres, gates, listener, flywheel, OpenRouter (PR #2) |
| 03 | Hands | Shipped (PR #3) | — | 555 tests; live convergence run green at $0.07 |
| 04 | Eyes | Shipped (PR #4) | — | 826 tests; scripted convergence green; live mapping partial (debt → 05) |
| 05 | Taste | Planned (awaiting approval) | — | ADR-022..024; F-51..F-57; tiers re-bound (deepseek/kimi) |
| 06 | Self-hosting | Arc only | — | after 05; closes the PRD's success bar |

## What's next

Push main (closes PRs #3 and #4 as merged). Approve BUILD-PLAN-05-taste.md,
then build by the established direct process.
