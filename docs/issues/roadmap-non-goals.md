---
type: issue
title: "Roadmap non-goals and deferred items"
description: The roadmap's out-of-scope and deferred list, preserved so the deferred items are not lost when ROADMAP.md is deleted.
tags: [roadmap, non-goals, deferred]
timestamp: 2026-06-25
status: open
kind: idea
severity: low
---

# Roadmap non-goals and deferred items

## Problem
`ROADMAP.md` (being deleted) carried a "Non-goals and deferred" section mirroring
PRD §4. The deferred items in particular are work that might one day be picked up;
they are captured here so deleting the roadmap does not lose them.

**Out of scope (non-goals):** team surfaces · hosted operation · dashboards ·
factory-factory · dangerous grants.

**Deferred (could resurface):** per-language adapters · signal-minted roots ·
semantic retrieval · full replay tooling.

## Evidence
the roadmap (now folded into docs/iterations/index.md + docs/issues/) "Non-goals and deferred" section (mirrors PRD §4). Some deferred
items overlap with the ride-along items issue (semantic retrieval ≈ pgvector
retrieval; full replay tooling ≈ replay harness).

## Proposed direction
Treat the non-goals as deliberate boundaries (revisit only via a PRD/scope change).
Treat the deferred items as candidates that can graduate into a future iteration or
their own issue when motivated.

## Acceptance hint
The deferred items remain discoverable after the roadmap is deleted; a future scope
decision to pick one up can cite this issue instead of a lost roadmap section.
