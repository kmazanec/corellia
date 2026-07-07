---
type: issue
title: Reconcile tier semantics — low/mid/high capability bands vs GOAL-TYPES' haiku/sonnet/opus
description: The code resolves tiers as capability bands over an 11-model OpenRouter catalog while GOAL-TYPES.md still specifies literal haiku/sonnet/opus; one of them should be declared authoritative in an ADR.
tags: [brain, model-catalog, tiers, docs, adr-needed]
timestamp: 2026-07-07
status: open
kind: idea
severity: low
---

# Reconcile tier semantics — low/mid/high capability bands vs GOAL-TYPES' haiku/sonnet/opus

## Problem
GOAL-TYPES.md's tier map assigns literal model names (haiku/sonnet/opus) per
type; the engine implements tiers as `low/mid/high` capability bands resolved to
the cheapest satisfying model in an 11-model OpenRouter catalog, filtered by
needs (vision/context/tool-calling). The band design is arguably better — it
survives model churn and prices per call — but the divergence means the library
doc no longer describes the running system (e.g. map-repo runs mid, not haiku),
and future tier decisions have no single source of truth.

## Evidence
- capability-scout sweep (2026-07-07): "tiers are named low/mid/high (capability
  bands → cheapest-satisfying OpenRouter model), NOT literally haiku/sonnet/opus;
  the GOAL-TYPES.md tier map is not literally wired."
- GOAL-TYPES.md "Tier map" section.

## Proposed direction
A short ADR blessing the band abstraction as the authoritative semantics (the
likely call: bands are what ADR-era model churn demands; the haiku/sonnet/opus
table was always a proxy for "nothing to decide / determined / weighs
alternatives"), then amend GOAL-TYPES.md's tier map to speak in bands with the
assignment rule unchanged. The alternative — wiring literal model names — should
be recorded as considered and rejected (or chosen, if the operator disagrees).

## Acceptance hint
An accepted ADR names the authoritative tier semantics; GOAL-TYPES.md's tier map
matches the code's actual resolution behavior; no dangling references to literal
model-name tiers remain in the library docs.
