---
type: iteration
title: "Iteration 02 — Substrate, gates, listener, flywheel, live brain"
description: Postgres substrate, risk/authority gates, the listener daemon, the split-memo flywheel + terraced scan, and the first wired live brain.
tags: [iteration, substrate, postgres, risk-gates, listener, flywheel, terraced-scan, live-brain, openrouter]
timestamp: 2026-06-10
status: shipped
---

# Iteration 02 — Substrate, gates, listener, flywheel, live brain

**Date:** 2026-06-10 · **Status:** Shipped

Built by the same process: gate brief (substrate + provider decisions) →
contract-v2 barrier → wave 1 fan-out (substrate-pg, risk gates, listener,
live brain) → wave 2 serialized on the engine-file overlap (flywheel + scan)
→ six-dimension review (4 gating findings) → repair rung → full suite.

## What was added

| Module | What it is |
| --- | --- |
| contract v2 | async EventStore/MemoryView (the Postgres consequence), PatternStore/SplitMemo, RiskClass/SensitivityFact, GoalTypeDef.gated/scan, BrainContext.lens/patternHint, six new event members |
| `src/substrate/` | PgEventStore + PgPatternStore (parameterized SQL, idempotent schema), InMemoryPatternStore, docker-compose; pg integration tests skip cleanly without DATABASE_URL |
| risk gates | constitution lint at Engine construction; classifyRisk over scope at entry and over actual artifact paths at emission; authority gate (type ∨ instance), fail-safe denied |
| `src/listener/` | scope-disjoint admission (overlap queues, disjoint runs concurrently), park releases the reservation immediately, TTL tick sweep (caller owns the clock), answer/resume as a checkpoint |
| flywheel + scan | specShape signatures; trusted memos walk verbatim (derivation skipped, judgment never); provisional memos arrive as hints; lens-diverse terraced scan ranked by judge-split, losers recorded as "alternatives considered" findings |
| live brain | openRouterConfig (models endpoint-verified defaults, env overrides), LlmBrain typeCatalog + strict-JSON prompts, examples/live.ts (`npm run live`) |

## Decisions made autonomously (with why)

1. **Asyncified the frozen EventStore/MemoryView** — the direct consequence of
   the human's Postgres decision; carried by the barrier with every consumer
   updated in one commit.
2. **Brief seam: the Listener owns the brief.** Review escalated the
   uncoordinated Engine-onBrief/Listener-inference seam; since neither surface
   is in `src/contract/`, this was judged an engine-internal fix, not a
   frozen-contract change: the Listener installs its handler as the engine's
   active brief authority per run and records parks synchronously. The post-hoc
   event scan survives only as a fallback for scripted test engines.
3. **'medium' risk is recorded, not gated** — prototype policy, marked as
   policy in the code; 'high' and `gated` types hit the authority gate
   (default-denied without a handler).
4. **The engine never self-trusts a pattern** — `promote(shape,'trusted')`
   exists only as the API the human ceremony calls.
5. **Decide-phase brain calls (incl. the k-candidate scan) are not budget-
   debited** — consistent with the existing decide path; recorded as a known
   gap rather than silently half-fixed.

## Blocker-report outcomes (the improvement loop, run by hand)

- Listener seam friction → confirmed by review, fixed (decision 2 above).
- "deliver-intent missing from registry" → **disproven** by review; the claim
  was a builder misreading. No action.
- Terraced-scan losers as `decided` events → confirmed; losers are now report
  findings ("alternatives considered"), exactly one `decided` per node.

## Known sharp edges (documented, not fixed)

- `classifyRisk` substring matching over-gates (`author.md` matches `auth`) —
  conservative direction, tuning pass welcome.
- `specShape` collisions could walk a wrong trusted memo; the split eval is the
  safety net (judgment never skipped).
- Decide-phase spend is unmetered (decision 5).

## Saved questions for the commissioner

1. Export `OPENROUTER_API_KEY` and run `npm run live` — the first real-brain
   run is wired and waiting; expect a small tree at haiku/sonnet-class cost.
2. The pattern-trust ceremony: `PatternStore.promote(shape, 'trusted')` exists —
   what surface should the human signoff get (CLI? PR-style review?)
3. Risk sensitivity defaults: tune now or after live-run evidence?
