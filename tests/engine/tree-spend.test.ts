import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SPEND_CEILING_USD,
  WORST_CASE_PRICE_PER_TOKEN,
  createTreeState,
  debitTreeState,
  hasReachedSpendCeiling,
} from '../../src/engine/tree-spend.js';

describe('tree spend accounting', () => {
  it('creates a tree state with the default ceiling', () => {
    expect(createTreeState()).toEqual({
      spentUsd: 0,
      ceilingUsd: DEFAULT_SPEND_CEILING_USD,
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
