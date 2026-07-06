import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SPEND_CEILING_USD,
  WORST_CASE_PRICE_PER_TOKEN,
  createTreeState,
  debitTreeState,
  hasReachedSpendCeiling,
  hasReachedTreeDeadline,
} from '../../src/engine/tree-spend.js';

describe('tree spend accounting', () => {
  it('creates a tree state with the default ceiling and no deadline', () => {
    expect(createTreeState()).toEqual({
      spentUsd: 0,
      ceilingUsd: DEFAULT_SPEND_CEILING_USD,
      deadline: Number.POSITIVE_INFINITY,
    });
  });

  it('uses reported dollar cost when available', () => {
    const state = createTreeState(1);

    debitTreeState(state, { promptTokens: 100, completionTokens: 200, costUsd: 0.42 });

    expect(state.spentUsd).toBe(0.42);
  });

  it('falls back to conservative token pricing for cost-silent usage', () => {
    const state = createTreeState(1);

    debitTreeState(state, { promptTokens: 30, completionTokens: 10 });

    expect(state.spentUsd).toBe(40 * WORST_CASE_PRICE_PER_TOKEN);
  });

  it('reports when the shared tree ceiling has been reached', () => {
    const state = createTreeState(0.1);

    debitTreeState(state, { promptTokens: 0, completionTokens: 0, costUsd: 0.1 });

    expect(hasReachedSpendCeiling(state)).toBe(true);
  });
});

describe('tree wall-clock deadline (ADR-046)', () => {
  it('defaults to an unreachable deadline when none is set', () => {
    const state = createTreeState();
    expect(hasReachedTreeDeadline(state, Number.MAX_SAFE_INTEGER)).toBe(false);
  });

  it('reports not-reached while now is before the shared deadline', () => {
    const state = createTreeState(DEFAULT_SPEND_CEILING_USD, 5_000);
    expect(hasReachedTreeDeadline(state, 4_999)).toBe(false);
  });

  it('reports reached once now meets or passes the shared deadline', () => {
    const state = createTreeState(DEFAULT_SPEND_CEILING_USD, 5_000);
    expect(hasReachedTreeDeadline(state, 5_000)).toBe(true);
    expect(hasReachedTreeDeadline(state, 6_000)).toBe(true);
  });
});
