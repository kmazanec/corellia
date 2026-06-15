# Status — Corellia

**Updated:** 2026-06-15 · **Roadmap:** [ROADMAP.md](./ROADMAP.md)

## Now

Iteration 07 (Layered conventions) shipped (F-68/F-69 converged). Iteration 08
(Recursion — ADR-029) is the next build: it removes `leafOnly` from the
comprehend family so comprehension can split, the named root cause of AC-2's
1/5. It is being commissioned **through the factory's own front door**
(`live:self`) — the strange loop building the fix that makes the loop converge.

## Iterations

| # | Iteration | Status | Build batch | Notes |
|---|-----------|--------|-------------|-------|
| 01 | Walking skeleton | Shipped | — | engine, evals, budgets, event log (PR #1) |
| 02 | Substrate + live brain | Shipped | — | Postgres, gates, listener, flywheel, OpenRouter (PR #2) |
| 03 | Hands | Shipped (PR #3) | — | 555 tests; live convergence run green at $0.07 |
| 04 | Eyes | Shipped (PR #4) | — | 826 tests; scripted convergence green; live mapping partial (debt → 05) |
| 05 | Taste | Shipped | — | 1076 tests; 19 types; live best 4/5 at ~$2; four real bugs fixed by live runs |
| 06 | Self-hosting | Shipped | — | 1345 tests; loop closes; AC-2 1/5 (comprehension can't recurse → iter 08) |
| 07 | Conventions | Shipped | — | 1335 tests; F-68/F-69 layered conventions (ADR-028) |
| 08 | Recursion | Building (via live:self) | — | ADR-029; comprehend family stops being leafOnly; unblocks AC-2/3/4 |

## What's next

Commission iteration 08 (comprehension recursion) through `live:self` — the
factory builds the fix on its own repo, producing a corellia PR. If the
self-build stalls on the very comprehension limit it is fixing, fall back to a
tightly-scoped commission (the engine change is localized: two `leafOnly`
removals + a structured integrate merge + the harness-prompt split criterion).
Then re-verify AC-2 live and record the honest result in the build notes.
