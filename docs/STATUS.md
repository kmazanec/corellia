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
| 03 | Hands | Specified | A | 6 features, zero hard deps — one barrier, full fan-out |
| 04 | Eyes | Arc only | — | gate brief + specs after 03 ships (JIT) |
| 05 | Taste | Arc only | — | after 04 |
| 06 | Self-hosting | Arc only | — | after 05; closes the PRD's success bar |

## What's next

Plan iteration 03: freeze the barrier contracts (concrete signatures per the
roadmap's contracts table, consistent with ADR-014..018), then build — all
six features fan out behind one barrier (mind the `engine.ts` overlap note
for F-32/F-34/F-35).
