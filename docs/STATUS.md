# Status — Corellia

**Updated:** 2026-06-11 · **Roadmap:** [ROADMAP.md](./ROADMAP.md)

## Now

Iteration 04 (Eyes) built and under review; live mapping evidence in the
build notes.

## Iterations

| # | Iteration | Status | Build batch | Notes |
|---|-----------|--------|-------------|-------|
| 01 | Walking skeleton | Shipped | — | engine, evals, budgets, event log (PR #1) |
| 02 | Substrate + live brain | Shipped | — | Postgres, gates, listener, flywheel, OpenRouter (PR #2) |
| 03 | Hands | Shipped (PR #3) | — | 555 tests; live convergence run green at $0.07 |
| 04 | Eyes | Built (PR open) | — | 826 tests; scripted convergence green; live mapping partial (harness debt → 05) |
| 05 | Taste | Arc only | — | after 04 |
| 06 | Self-hosting | Arc only | — | after 05; closes the PRD's success bar |

## What's next

Review and merge the iteration-04 PR. Iteration 05 (Taste) owns the named
harness debt: structured-output artifact emission, per-type skill bundles,
carried exploration across attempts.
