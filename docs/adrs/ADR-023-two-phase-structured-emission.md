---
type: adr
title: "ADR-023: Artifact-emitting leaves explore, then emit via structured outputs"
description: Artifact-emitting leaves run a two-phase pattern — a tool loop to explore, then one dedicated emit call with a JSON-schema response format — so large artifacts are packaged reliably.
tags: [adr, leaves, structured-outputs, emission, two-phase]
timestamp: 2026-06-11T17:57:41-05:00
---

# ADR-023: Artifact-emitting leaves explore, then emit via structured outputs

**Status:** Accepted · **Date:** 2026-06-11 · **Stretch:** no · **Contract:** yes
**Supersedes:** none · **Superseded by:** none

## Context

Iteration-04 live evidence: models reliably work the tool loop but
unreliably package a large JSON artifact as their final chat message —
fences, prose preambles, missing fields; prompt hardening did not fix it.
All current tier models support provider-side structured outputs.

## Options considered

- **Two-phase leaf: tool loop explores, then one dedicated emit call with
  `response_format: json_schema`** — chosen.
- response_format on every step request — rejected: would forbid the
  conversational tool-calling the loop needs.
- Keep prompt discipline + packaging tolerance only — rejected by evidence.

## Decision

`GoalTypeDef` gains optional `outputSchema` (a JSON-Schema object for the
type's artifact). When present, the engine treats the loop's artifact-kind
output as the *exploration-complete* signal, then makes one additional
metered `step` call with `BrainContext.outputSchema` set and a final context
message ("emit the artifact now"); the adapter translates that into
`response_format: { type: 'json_schema', … }`, so well-formedness is the
provider's guarantee. The deterministic checks remain the semantic gate;
this fixes packaging, not truth. Types without `outputSchema` behave exactly
as today.

## Tradeoffs & risks

- One extra model call per emitting leaf — cheap (the transcript prefix is
  cached) and bounded by the existing budgets.
- Providers vary in json_schema strictness; the packaging-tolerant parser
  stays as the fallback layer.

## Consequences for the build

- Barrier: `outputSchema?` on `GoalTypeDef` + `BrainContext` (additive);
  adapter support in `LlmBrain.step`; engine two-phase seam in the loop.
- Learn types adopt it first (their artifacts are the largest); judge
  verdicts are next candidates.
