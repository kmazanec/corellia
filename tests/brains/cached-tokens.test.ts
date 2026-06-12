/**
 * Tests for cached-token surfacing in readUsage (F-56 chunk 4).
 *
 * readUsage reads provider cached-token fields into Usage.cachedPromptTokens:
 *   - OpenRouter/OpenAI shape: usage.prompt_tokens_details.cached_tokens
 *   - DeepSeek shape:          usage.prompt_cache_hit_tokens
 *
 * costSummary aggregates cachedPromptTokens and derives cacheHitShare
 * (cached / prompt) per tree.
 */

import { describe, it, expect } from 'vitest';
import { readUsage } from '../../src/brains/llm.js';
import { costSummary } from '../../src/eventlog/projections.js';
import type { FactoryEvent } from '../../src/contract/events.js';
import type { Usage } from '../../src/contract/goal.js';

// ── readUsage ──────────────────────────────────────────────────────────────

describe('readUsage: OpenRouter/OpenAI provider shape', () => {
  it('reads cached_tokens from prompt_tokens_details into cachedPromptTokens', () => {
    const data = {
      usage: {
        prompt_tokens: 1000,
        completion_tokens: 200,
        prompt_tokens_details: { cached_tokens: 400 },
      },
    };
    const usage = readUsage(data);
    expect(usage.promptTokens).toBe(1000);
    expect(usage.completionTokens).toBe(200);
    expect(usage.cachedPromptTokens).toBe(400);
  });

  it('omits cachedPromptTokens when prompt_tokens_details is absent', () => {
    const data = {
      usage: {
        prompt_tokens: 500,
        completion_tokens: 100,
      },
    };
    const usage = readUsage(data);
    expect(usage.cachedPromptTokens).toBeUndefined();
  });

  it('omits cachedPromptTokens when cached_tokens inside details is absent', () => {
    const data = {
      usage: {
        prompt_tokens: 500,
        completion_tokens: 100,
        prompt_tokens_details: {},
      },
    };
    const usage = readUsage(data);
    expect(usage.cachedPromptTokens).toBeUndefined();
  });

  it('handles cached_tokens: 0 (cache present but empty hit)', () => {
    const data = {
      usage: {
        prompt_tokens: 100,
        completion_tokens: 50,
        prompt_tokens_details: { cached_tokens: 0 },
      },
    };
    const usage = readUsage(data);
    expect(usage.cachedPromptTokens).toBe(0);
  });
});

describe('readUsage: DeepSeek provider shape', () => {
  it('reads prompt_cache_hit_tokens flat field into cachedPromptTokens', () => {
    const data = {
      usage: {
        prompt_tokens: 800,
        completion_tokens: 150,
        prompt_cache_hit_tokens: 300,
      },
    };
    const usage = readUsage(data);
    expect(usage.cachedPromptTokens).toBe(300);
    expect(usage.promptTokens).toBe(800);
  });

  it('omits cachedPromptTokens when prompt_cache_hit_tokens is absent', () => {
    const data = {
      usage: {
        prompt_tokens: 800,
        completion_tokens: 150,
      },
    };
    const usage = readUsage(data);
    expect(usage.cachedPromptTokens).toBeUndefined();
  });
});

describe('readUsage: provider shape precedence', () => {
  it('prefers prompt_tokens_details.cached_tokens over prompt_cache_hit_tokens when both present', () => {
    // OpenRouter shape takes precedence (it is checked first via ??)
    const data = {
      usage: {
        prompt_tokens: 1000,
        completion_tokens: 200,
        prompt_tokens_details: { cached_tokens: 600 },
        prompt_cache_hit_tokens: 999, // should be ignored
      },
    };
    const usage = readUsage(data);
    expect(usage.cachedPromptTokens).toBe(600);
  });
});

// ── costSummary cacheHitShare ──────────────────────────────────────────────

function producedEvent(usage: Usage, goalId = 'g1'): FactoryEvent {
  return {
    type: 'produced',
    at: 1000,
    goalId,
    artifact: { kind: 'text', text: 'output' },
    usage,
  };
}

describe('costSummary: cacheHitShare', () => {
  it('cacheHitShare is undefined when no cached tokens are present', () => {
    const events: FactoryEvent[] = [
      producedEvent({ promptTokens: 1000, completionTokens: 200 }),
    ];
    const summary = costSummary(events);
    expect(summary.tree.cacheHitShare).toBeUndefined();
  });

  it('cacheHitShare is undefined when there are no prompt tokens', () => {
    const events: FactoryEvent[] = [];
    const summary = costSummary(events);
    expect(summary.tree.cacheHitShare).toBeUndefined();
  });

  it('cacheHitShare = cached / prompt for OpenRouter-style usage', () => {
    const events: FactoryEvent[] = [
      producedEvent({ promptTokens: 1000, completionTokens: 200, cachedPromptTokens: 400 }),
    ];
    const summary = costSummary(events);
    expect(summary.tree.cacheHitShare).toBeCloseTo(0.4);
  });

  it('cacheHitShare accumulates across multiple events correctly', () => {
    // Two produced events: 500 + 500 = 1000 prompt, 200 + 100 = 300 cached
    const events: FactoryEvent[] = [
      producedEvent({ promptTokens: 500, completionTokens: 100, cachedPromptTokens: 200 }),
      producedEvent({ promptTokens: 500, completionTokens: 150, cachedPromptTokens: 100 }),
    ];
    const summary = costSummary(events);
    expect(summary.tree.cachedPromptTokens).toBe(300);
    expect(summary.tree.cacheHitShare).toBeCloseTo(0.3);
  });

  it('cacheHitShare for a goal without cached tokens is undefined', () => {
    const events: FactoryEvent[] = [
      producedEvent({ promptTokens: 1000, completionTokens: 200 }, 'g-no-cache'),
    ];
    const summary = costSummary(events);
    expect(summary.byGoal['g-no-cache']?.cacheHitShare).toBeUndefined();
  });

  it('per-goal cacheHitShare is computed independently', () => {
    const events: FactoryEvent[] = [
      producedEvent({ promptTokens: 1000, completionTokens: 200, cachedPromptTokens: 500 }, 'g1'),
      producedEvent({ promptTokens: 400, completionTokens: 100, cachedPromptTokens: 100 }, 'g2'),
    ];
    const summary = costSummary(events);
    expect(summary.byGoal['g1']?.cacheHitShare).toBeCloseTo(0.5);
    expect(summary.byGoal['g2']?.cacheHitShare).toBeCloseTo(0.25);
    // tree = 1400 prompt, 600 cached => 600/1400 ≈ 0.4286
    expect(summary.tree.cacheHitShare).toBeCloseTo(600 / 1400);
  });

  it('events with cachedPromptTokens: 0 do not affect cacheHitShare as undefined', () => {
    const events: FactoryEvent[] = [
      producedEvent({ promptTokens: 1000, completionTokens: 200, cachedPromptTokens: 0 }),
    ];
    const summary = costSummary(events);
    // 0/1000 = 0 (it IS defined, just 0)
    expect(summary.tree.cacheHitShare).toBeCloseTo(0);
    expect(summary.tree.cachedPromptTokens).toBe(0);
  });
});
