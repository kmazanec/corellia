---
type: issue
title: Anthropic-direct brain provider — OpenRouter is a single point of failure
description: OpenRouter is the only wired provider; a direct Anthropic adapter would add provider redundancy and unlock prompt caching and batch pricing for the models the factory leans on hardest.
tags: [brain, provider, anthropic, resilience, cost]
timestamp: 2026-07-07
status: open
kind: idea
severity: medium
---

# Anthropic-direct brain provider — OpenRouter is a single point of failure

## Problem
Every model call routes through OpenRouter (src/brains/); an OpenRouter outage,
rate limit, or account issue halts the factory entirely — the
provider-timeout-isomorphic-block issue already showed transient provider
failures getting misread as goal failures. Beyond resilience, the direct
Anthropic API offers prompt caching and batch pricing the factory can't touch
through the aggregator, and the high band leans on Anthropic models anyway.

## Evidence
- capability-scout sweep (2026-07-07): "OpenRouter is the only wired provider (no
  Anthropic-direct; Anthropic reached by id through OpenRouter)."
- docs/issues/provider-timeout-isomorphic-block.md (the failure mode a second
  provider would soften; its mechanical fix landed, the fragility remains).

## Proposed direction
A second BrainProvider speaking the Anthropic Messages API, selected per catalog
entry (each model row names its provider; Anthropic-family rows prefer direct
when `ANTHROPIC_API_KEY` is set, falling back to OpenRouter otherwise). Same
injected-fetch test pattern as the OpenRouter adapter. Prompt caching for the
stable prompt prefix (skills, contracts) is the follow-on payoff once the adapter
exists; keep it a separate step.

## Acceptance hint
With ANTHROPIC_API_KEY set, catalog rows marked anthropic-direct resolve and run
against api.anthropic.com (proven by unit tests with injected fetch plus one live
smoke); unset, everything falls back to OpenRouter unchanged.

---

> **Fixed (2026-07-07, branch `issue/anthropic-provider`; live smoke with a real
> key is the operator's proof, so this stays open).** A second BrainProvider now
> speaks the Anthropic Messages API, selected per catalog row, feeding the same
> measured usage/cost stream (ADR-017) the OpenRouter path feeds. Absent
> `ANTHROPIC_API_KEY` nothing changes — every model still resolves through
> OpenRouter.
>
> **The seam — a provider-wire codec, not a cloned brain.** `LlmBrain` had the
> OpenAI chat-completions wire format baked into its two fetch sites (`callCompletions`,
> `postStepRequest`) plus `buildStepRequest`/`translateStepResponse`/`readUsage`.
> Cloning the whole 2000-line brain (prompt builders, JSON repair, non-delivery
> recovery, malformed-step retry) to speak a second dialect would have been the
> wrong boundary. Instead a `ProviderWire` interface (`src/brains/provider-wire.ts`)
> captures exactly the per-provider surface — URL, headers, request encode, response
> decode, usage read — and nothing else. The retry/timeout/backoff loop, prompt
> text, and recovery all stay in the brain and are shared byte-for-byte across
> providers. Two codecs implement it: `openai-wire.ts` (the default dialect, the
> current shape extracted verbatim so unpinned behaviour is unchanged) and
> `anthropic-wire.ts` (POST /v1/messages, `x-api-key` + `anthropic-version` headers,
> required `max_tokens`, system lifted out of `messages`, `tool_use`/`tool_result`
> content blocks, `usage.{input,output}_tokens`). A resolved `ModelSpec` carries a
> `wire` tag; the brain reads its codec off the target and delegates.
>
> **Provider selection** lives in `src/brains/anthropic-provider.ts`
> (`applyAnthropicDirect`), applied by `openRouterConfig` after `assembleCatalog`.
> With the key set, Anthropic-family rows (`anthropic/…`) are rewritten to `wire:
> 'anthropic'` + an api.anthropic.com endpoint and the direct model id
> (`anthropic/claude-opus-4.8` → `claude-opus-4-8`); pins that named a rewritten id
> are remapped in lockstep. A row with its own `endpoint`/`wire` (an operator
> override) is left untouched. Absent the key it is a no-op (same object reference
> back).
>
> **Judgment calls, recorded:**
> - *Provider preference is a per-row catalog tag (`wire?: 'openai' | 'anthropic'`),
>   independent of `endpoint`* — "which dialect" is orthogonal to "which URL", and a
>   spec already had the `endpoint` seam for the URL. This keeps the OpenRouter
>   fallback automatic: no key → no `wire` rewrite → the row is an ordinary OpenAI
>   row.
> - *`anthropic-version` pinned to the stable `2023-06-01` constant* — a fixed
>   adapter needs a fixed version, not a model-gated one; no thinking/effort/beta
>   surface is used (this adapter only routes text + tool calls).
> - *Cost tags unchanged* — the catalog's Anthropic rows already carry the published
>   direct pricing (haiku 1/5, sonnet 3/15, opus 5/25 per Mtok), so direct and
>   aggregated pricing coincide; nothing to re-tag. (Verified against the current
>   rows in `model-catalog.ts`.) Measured spend still comes from provider usage
>   accounting regardless, so the tags only affect within-band ranking.
> - *Direct id translation is `strip anthropic/ + dots→dashes`* — covers the three
>   present rows exactly; a future row follows the same convention.
> - *Prompt caching is OUT of scope (a follow-on)* — no `cache_control` breakpoints
>   are emitted; `cache_read_input_tokens` is still READ back into
>   `Usage.cachedPromptTokens` so a warmed cache is credited if caching is added.
> - *`max_tokens` default 32k* — the Messages API requires it and the brain's
>   completion path carries no cap; the tree deadline (ADR-046) and per-request
>   timeout are the real runaway bounds, so a generous ceiling is safe.
>
> Files: `src/brains/provider-wire.ts`, `src/brains/openai-wire.ts`,
> `src/brains/anthropic-wire.ts`, `src/brains/anthropic-provider.ts` (new);
> `src/brains/llm.ts` (codec seam at both fetch sites, OpenAI wire extracted),
> `src/brains/model-catalog.ts` (`ModelSpec.wire`), `src/brains/openrouter.ts`
> (applies the direct rewrite), `.env.example` (documents `ANTHROPIC_API_KEY`).
> Tests: `tests/brains/anthropic-wire.test.ts` (encode/decode/usage),
> `anthropic-provider.test.ts` (selection + fallback, key present/absent),
> `anthropic-step.test.ts` (step tool-call round trip, 429 retry, timeout retry,
> terminal 401) — all injected-fetch, never live. All 244 pre-existing
> `tests/brains/` tests pass unchanged; `tsc` and library lint clean. A live run
> against api.anthropic.com with a real key is the confirming proof.
