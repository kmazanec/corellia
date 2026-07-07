---
type: issue
title: Improvement envelope counts trees, not dollars
description: The standing budget envelope that guarantees improvement work never starves product work accounts += 1 per tree instead of USD, so the guarantee is not cost-true.
tags: [listener, budget, improvement-loop, cost]
timestamp: 2026-07-07
status: open
kind: bug
severity: low
---

# Improvement envelope counts trees, not dollars

## Problem
The improvement loop's admission carve-out is justified by its standing budget
envelope: improvement goals auto-admit because they "consume only factory
resources within a fixed allowance." The envelope's accounting is nominal —
`+= 1` per tree (src/listener/listener.ts:786) — while real trees vary by orders
of magnitude in spend. One expensive improvement tree can cost what the envelope
meant to allow for many, so "the loop can never starve product work" is not yet
a property of the mechanism, just of current low volume.

## Evidence
- capability-scout sweep (2026-07-07): "Standing budget envelope: IMPLEMENTED but
  nominal cost accounting (+=1 per tree, not USD — listener.ts:786)."
- DESIGN.md "The improvement loop" (standing budget envelope); tree-wide USD
  spend already exists per tree (src/engine/tree-spend.ts) — the envelope just
  doesn't read it.

## Proposed direction
Charge the envelope in USD from the same spend stream the per-tree dollar ceiling
uses: on tree completion (or incrementally), add the tree's actual spend to the
envelope's consumed total; admission of a new improvement root checks remaining
dollars, not remaining slots. Envelope size becomes a configured USD allowance
per window.

## Acceptance hint
A test where one improvement tree spends most of the envelope's USD allowance
sees the next improvement root deferred, while product commissions are unaffected;
the envelope's consumed/remaining totals are visible in status/projections.

---

> **Fixed (2026-07-07, branch `issue/small-fixes`; pending live proof).** The
> envelope now charges MEASURED USD, not `+= 1` per tree. On improvement-tree
> completion (`Listener.runImprovementIntent`, `src/listener/listener.ts`) the
> tree's actual dollar spend is read back from the event log — via a new
> `treeSpendUsd(store, rootId)` helper that folds `costUsd` over every event in
> the tree (the tree's goals all share the root id as a prefix, children being
> `${parent.id}/${localId}`) through the same `costSummary` projection the cost
> report uses — and added to `envelopeSpentUsd`. This is the same spend stream the
> per-tree dollar ceiling debits (ADR-017: measured, never estimated). A failed
> run still charges whatever it burned before failing.
>
> Admission (`hasEnvelopeHeadroom`) now checks REMAINING DOLLARS. With the new
> optional `StandingEnvelope.perTreeCeilingUsd`, the gate RESERVES a tree's worth
> of dollars: a new improvement root is admitted only when remaining >=
> perTreeCeilingUsd, and the admitted tree runs bounded by `min(perTreeCeilingUsd,
> remaining)`, so no single tree can overrun the window. Consumed/remaining/
> allowance are surfaced in `Listener.status()` and the `FrontDoorStatus`
> projection (GET /status).
>
> **Backward compatibility.** `perTreeCeilingUsd` is optional; absent it, the gate
> admits while any dollars remain (`consumed < allowance`) and the tree runs under
> the engine default ceiling — the prior shape, so existing `STANDING_*` configs
> and tests keep working. `spendCeilingUsd` was already USD-denominated in config,
> so no config migration is needed. New env var `STANDING_PER_TREE_CEILING_USD`
> (documented in `.env.example`).
>
> **Judgment call — where the reserve lives.** "Spends most of the allowance
> defers the next" is only expressible if admission reserves a tree's worth of
> dollars up front; a bare `consumed < allowance` check would still admit a tree
> when only $1 of a $10 window remains. The per-tree reserve (opt-in, so no
> behaviour change for configs that don't set it) is the minimal mechanism that
> makes the guarantee cost-true. Cost-silent endpoints report no `costUsd` and
> count as $0 — the envelope under-charges rather than over-charges spend it
> cannot see, erring toward admitting (noted at the helper).
>
> Unit-proven: `tests/listener/envelope-admission.test.ts` — one $9 tree against a
> $10 window with a $5 reserve defers the next improvement root while product runs
> freely; consumed/remaining are exposed in status. `tests/daemon/standing-envelope.test.ts`
> — the config builder parses the total allowance and the optional per-tree
> reserve. A live improvement window that actually defers a second root on real
> spend is the confirming proof.
