---
type: adr
title: "ADR-005: One Brain interface, provider-agnostic, OpenRouter as default endpoint"
description: A single provider-agnostic Brain interface fronted by an OpenAI-compatible adapter, with OpenRouter as the default endpoint, realizing one brain, many harnesses.
tags: [adr, brain, provider-agnostic, openrouter, llm]
timestamp: 2026-06-11T17:19:44-05:00
---

# ADR-005: One Brain interface, provider-agnostic, OpenRouter as default endpoint

**Status:** Accepted · **Date:** 2026-06-10 (decided iteration 2 gate brief; recorded retroactively) · **Stretch:** no · **Contract:** yes
**Supersedes:** none · **Superseded by:** none

## Context

The design's central theorem is one brain, many harnesses. The prototype
needed a live brain without binding the factory to a vendor. Operator
amendment, verbatim intent: the adapter "should be able to work with ANY
model, claude, openAI, openrouter models, etc."

## Options considered

- One `Brain` interface + an OpenAI-compatible chat-completions adapter,
  OpenRouter as the default endpoint — chosen.
- Per-provider adapters (Anthropic SDK + OpenAI SDK + …) — rejected for v1:
  more surface, and OpenRouter already fronts all of them.
- A provider-routing library — rejected (ADR-001: own the seam).

## Decision

`Brain` (`src/contract/brain.ts`: decide/produce/judge/repair) is the only
seam the engine knows. `LlmBrain` implements it over OpenAI-compatible chat
completions against any `baseUrl`; `openRouterConfig` supplies defaults
(haiku/sonnet-class for work, opus-class for judging) with per-tier env
overrides (`CORELLIA_MODEL_*`). `ScriptedBrain` implements the same interface
deterministically for tests and demos.

## Rationale

The chat-completions shape is the industry lingua franca — one adapter reaches
every major provider through OpenRouter today and any compatible endpoint
(including direct vendor endpoints) tomorrow. Tier-as-configuration keeps
"specification quality picks the tier" a policy, not a code change.

## Tradeoffs & risks

- Lowest-common-denominator API: provider-specific powers (prompt caching,
  native structured outputs, batch APIs) are unused until justified. Accepted
  for v1.
- Tool-calling support is not yet in the adapter — iteration 3's central
  pending decision (where the agentic loop lives) lands here.

## Consequences for the build

- **Source of truth:** `src/contract/brain.ts` (frozen), `src/brains/llm.ts`,
  `src/brains/openrouter.ts`.
- Engine code must never import a provider; everything reaches models through
  `Brain`.
- Memories are passed quoted-as-data in prompts (use/mention discipline);
  retries carry prior verdicts via `BrainContext` — both are interface
  obligations, not adapter conveniences.

## Amendment — 2026-06-11: cost-optimized default tier bindings

Live-run cost evidence (≈$21 across the iteration-04 mapping runs, dominated
by prompt tokens on long tool transcripts) prompted a re-binding of the
default tier models, researched against the live OpenRouter catalog and
current agentic/coding rankings:

| Tier label | Was | Now | $/M in/out |
| --- | --- | --- | --- |
| haiku (low) | anthropic/claude-haiku-4.5 ($1/$5) | deepseek/deepseek-v4-flash | $0.098/$0.197 |
| sonnet (mid) | anthropic/claude-sonnet-4.6 ($3/$15) | deepseek/deepseek-v4-pro | $0.435/$0.87 |
| opus (high) | anthropic/claude-opus-4.8 ($5/$25) | moonshotai/kimi-k2.6 | $0.67/$3.39 |

Selection criteria: tools + structured-output support on OpenRouter, current
agentic-board ranking at or above the replaced model, 200k+ context, and
vendor diversity across tiers. The contract's `Tier` union keeps its
historical labels (haiku/sonnet/opus = low/medium/high); only the bindings
changed, and `CORELLIA_MODEL_*` env overrides are untouched. The decision is
config, not architecture — revisit freely as the catalog moves.
