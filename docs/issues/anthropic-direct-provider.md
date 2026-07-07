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
