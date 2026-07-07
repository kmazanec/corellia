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
