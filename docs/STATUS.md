# Status — Corellia

**Updated:** 2026-06-10 · **Roadmap:** [ROADMAP.md](./ROADMAP.md)

## Now

Foundation docs landed (PRD, ARCHITECTURE, ADR-001..018, iteration-3 specs).
Next up: plan iteration 03-hands.

## Iterations

| # | Iteration | Status | Build batch | Notes |
|---|-----------|--------|-------------|-------|
| 01 | Walking skeleton | Shipped | — | engine, evals, budgets, event log (PR #1) |
| 02 | Substrate + live brain | Shipped | — | Postgres, gates, listener, flywheel, OpenRouter (PR #2) |
| 03 | Hands | Planned + approved | A | 7 features: F-31..F-36 fan out behind one barrier; F-37 (assembly) wires them, last |
| 04 | Eyes | Arc only | — | gate brief + specs after 03 ships (JIT) |
| 05 | Taste | Arc only | — | after 04 |
| 06 | Self-hosting | Arc only | — | after 05; closes the PRD's success bar |

## What's next

Build iteration 03 from the approved BUILD-PLAN-03-hands.md: barrier commit
first (incl. mechanical compile-true propagation), then F-31/F-33/F-36 in
worktrees + F-32 → F-35 → F-34 on the trunk, then F-37 (assembly +
convergence) last. Launch is operator-triggered.
