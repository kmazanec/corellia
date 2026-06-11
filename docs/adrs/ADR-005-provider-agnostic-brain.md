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
