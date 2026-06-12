/**
 * Tests for F-64 Chunk 3: costSummary cache-hit share projection.
 *
 * Verifies that cachedPromptTokens accumulates correctly across usage-bearing
 * events and that cacheHitShare = cachedPromptTokens / promptTokens is computed
 * per-goal and tree-wide (AC 5).
 *
 * This file focuses on the cache-specific behaviour. General costSummary
 * coverage lives in projections.test.ts; these tests extend it with the F-64
 * fields so the feature's acceptance criteria are explicitly exercised.
 */

import { describe, it, expect } from 'vitest';
import { costSummary } from '../../src/eventlog/projections.js';
import type { FactoryEvent } from '../../src/contract/events.js';
import type { Usage } from '../../src/contract/goal.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function usageWithCache(p: number, c: number, cached: number): Usage {
  return { promptTokens: p, completionTokens: c, cachedPromptTokens: cached };
}

function usageNoCache(p: number, c: number): Usage {
  return { promptTokens: p, completionTokens: c };
}

function stepEvent(goalId: string, at: number, usage: Usage): FactoryEvent {
  return { type: 'step', at, goalId, index: 0, outputKind: 'tool-calls', usage };
}

function producedEvent(goalId: string, at: number, usage: Usage): FactoryEvent {
  return { type: 'produced', at, goalId, usage };
}

// ---------------------------------------------------------------------------
// AC 5: cachedPromptTokens accumulation
// ---------------------------------------------------------------------------

describe('costSummary — cachedPromptTokens accumulation (AC 5)', () => {
  it('accumulates cachedPromptTokens across step events for the same goal', () => {
    const events: FactoryEvent[] = [
      stepEvent('g1', 100, usageWithCache(1000, 100, 400)),
      stepEvent('g1', 200, usageWithCache(1000, 100, 600)),
    ];
    const result = costSummary(events);
    expect(result.byGoal['g1']?.cachedPromptTokens).toBe(1000);
    expect(result.tree.cachedPromptTokens).toBe(1000);
  });

  it('accumulates cachedPromptTokens across produced and step events', () => {
    const events: FactoryEvent[] = [
      producedEvent('g1', 100, usageWithCache(800, 80, 200)),
      stepEvent('g1', 200, usageWithCache(400, 40, 150)),
    ];
    const result = costSummary(events);
    expect(result.byGoal['g1']?.cachedPromptTokens).toBe(350);
    expect(result.tree.cachedPromptTokens).toBe(350);
  });

  it('accumulates cachedPromptTokens across multiple goals for tree total', () => {
    const events: FactoryEvent[] = [
      stepEvent('g1', 100, usageWithCache(1000, 100, 300)),
      stepEvent('g2', 200, usageWithCache(2000, 200, 700)),
    ];
    const result = costSummary(events);
    expect(result.byGoal['g1']?.cachedPromptTokens).toBe(300);
    expect(result.byGoal['g2']?.cachedPromptTokens).toBe(700);
    expect(result.tree.cachedPromptTokens).toBe(1000);
  });

  it('cachedPromptTokens is 0 in the output when no usage reports cached tokens', () => {
    // When hasCached is false, cachedPromptTokens stays 0 and cacheHitShare is undefined.
    const events: FactoryEvent[] = [
      stepEvent('g1', 100, usageNoCache(1000, 100)),
    ];
    const result = costSummary(events);
    expect(result.byGoal['g1']?.cachedPromptTokens).toBe(0);
    expect(result.tree.cachedPromptTokens).toBe(0);
  });

  it('cachedPromptTokens does not accumulate from events without the field', () => {
    // Mix of events with and without cached tokens — only events with the field contribute.
    const events: FactoryEvent[] = [
      stepEvent('g1', 100, usageWithCache(1000, 100, 400)),
      stepEvent('g1', 200, usageNoCache(500, 50)),
    ];
    const result = costSummary(events);
    // Only the first step's 400 cached tokens should count
    expect(result.byGoal['g1']?.cachedPromptTokens).toBe(400);
    expect(result.tree.cachedPromptTokens).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// AC 5: cacheHitShare computation
// ---------------------------------------------------------------------------

describe('costSummary — cacheHitShare computation (AC 5)', () => {
  it('computes cacheHitShare = cachedPromptTokens / promptTokens when cache data is present', () => {
    const events: FactoryEvent[] = [
      stepEvent('g1', 100, usageWithCache(1000, 100, 400)),
    ];
    const result = costSummary(events);
    // 400 / 1000 = 0.4
    expect(result.byGoal['g1']?.cacheHitShare).toBeCloseTo(0.4);
    expect(result.tree.cacheHitShare).toBeCloseTo(0.4);
  });

  it('cacheHitShare is undefined when no usage event reports cachedPromptTokens', () => {
    const events: FactoryEvent[] = [
      stepEvent('g1', 100, usageNoCache(1000, 100)),
      stepEvent('g1', 200, usageNoCache(500, 50)),
    ];
    const result = costSummary(events);
    expect(result.byGoal['g1']?.cacheHitShare).toBeUndefined();
    expect(result.tree.cacheHitShare).toBeUndefined();
  });

  it('cacheHitShare is undefined when promptTokens is 0 (guard against division by zero)', () => {
    // Zero prompt tokens with cached tokens reported — share is undefined
    const events: FactoryEvent[] = [
      stepEvent('g1', 100, usageWithCache(0, 0, 0)),
    ];
    const result = costSummary(events);
    expect(result.byGoal['g1']?.cacheHitShare).toBeUndefined();
    expect(result.tree.cacheHitShare).toBeUndefined();
  });

  it('cacheHitShare computed correctly across a multi-step run', () => {
    // 3 steps: 500 cached out of 2000 prompt = 0.25
    const events: FactoryEvent[] = [
      stepEvent('g1', 100, usageWithCache(1000, 100, 100)),
      stepEvent('g1', 200, usageWithCache(600, 60, 200)),
      stepEvent('g1', 300, usageWithCache(400, 40, 200)),
    ];
    const result = costSummary(events);
    expect(result.byGoal['g1']?.promptTokens).toBe(2000);
    expect(result.byGoal['g1']?.cachedPromptTokens).toBe(500);
    expect(result.byGoal['g1']?.cacheHitShare).toBeCloseTo(0.25);
    expect(result.tree.cacheHitShare).toBeCloseTo(0.25);
  });

  it('cacheHitShare is 1.0 when all prompt tokens are cached', () => {
    const events: FactoryEvent[] = [
      stepEvent('g1', 100, usageWithCache(1000, 50, 1000)),
    ];
    const result = costSummary(events);
    expect(result.byGoal['g1']?.cacheHitShare).toBeCloseTo(1.0);
    expect(result.tree.cacheHitShare).toBeCloseTo(1.0);
  });

  it('tree cacheHitShare aggregates across goals (pool total cached / pool total prompt)', () => {
    // g1: 400/1000 cache; g2: 0/500 cache (no cached field — only mix with events)
    // Tree: 400 cached / 1500 prompt = ~0.267
    const events: FactoryEvent[] = [
      stepEvent('g1', 100, usageWithCache(1000, 100, 400)),
      // g2 also reports cached tokens (needed for hasCached to be true on tree acc)
      stepEvent('g2', 200, usageWithCache(500, 50, 0)),
    ];
    const result = costSummary(events);
    expect(result.tree.promptTokens).toBe(1500);
    expect(result.tree.cachedPromptTokens).toBe(400);
    expect(result.tree.cacheHitShare).toBeCloseTo(400 / 1500);
  });

  it('cacheHitShare is additive — partial cache across mixed events is correct', () => {
    // Some steps have cache data, some do not — the goal-level share uses the
    // accumulated total, not just the events that reported it.
    const events: FactoryEvent[] = [
      stepEvent('g1', 100, usageWithCache(800, 80, 400)),
      stepEvent('g1', 200, usageNoCache(400, 40)),  // no cached field
      stepEvent('g1', 300, usageWithCache(800, 80, 200)),
    ];
    const result = costSummary(events);
    // Total prompt: 800 + 400 + 800 = 2000
    // Total cached: 400 + 200 = 600
    // Share: 600 / 2000 = 0.3
    expect(result.byGoal['g1']?.promptTokens).toBe(2000);
    expect(result.byGoal['g1']?.cachedPromptTokens).toBe(600);
    expect(result.byGoal['g1']?.cacheHitShare).toBeCloseTo(0.3);
  });
});

// ---------------------------------------------------------------------------
// AC 5: integration — cache share in all usage-bearing event types
// ---------------------------------------------------------------------------

describe('costSummary — cachedPromptTokens folded from all usage-bearing event types (AC 5)', () => {
  it('folds cachedPromptTokens from judge-verdict event', () => {
    const events: FactoryEvent[] = [
      {
        type: 'judge-verdict',
        at: 100,
        goalId: 'g1',
        judgeType: 'code-review',
        verdict: { pass: true, findings: [] },
        tier: 'mid',
        usage: usageWithCache(500, 50, 200),
      },
    ];
    const result = costSummary(events);
    expect(result.byGoal['g1']?.cachedPromptTokens).toBe(200);
    expect(result.byGoal['g1']?.cacheHitShare).toBeCloseTo(200 / 500);
  });

  it('folds cachedPromptTokens from repair-applied event', () => {
    const events: FactoryEvent[] = [
      {
        type: 'repair-applied',
        at: 100,
        goalId: 'g1',
        prescriptions: ['fix types'],
        usage: usageWithCache(400, 40, 100),
      },
    ];
    const result = costSummary(events);
    expect(result.byGoal['g1']?.cachedPromptTokens).toBe(100);
    expect(result.byGoal['g1']?.cacheHitShare).toBeCloseTo(0.25);
  });

  it('folds cachedPromptTokens from decided event', () => {
    const events: FactoryEvent[] = [
      {
        type: 'decided',
        at: 100,
        goalId: 'g1',
        decision: { kind: 'satisfy' },
        usage: usageWithCache(600, 60, 300),
      },
    ];
    const result = costSummary(events);
    expect(result.byGoal['g1']?.cachedPromptTokens).toBe(300);
    expect(result.byGoal['g1']?.cacheHitShare).toBeCloseTo(0.5);
  });
});
