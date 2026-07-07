/**
 * buildStandingEnvelope reads the improvement loop's USD window from the
 * environment (ADR-027): the total allowance and the optional per-tree reserve.
 * Both budget + ceiling must be present to activate; the per-tree ceiling is
 * optional and backward-compatible (omitting it preserves admit-while-any-remain).
 */

import { describe, it, expect, afterEach } from 'vitest';
import { buildStandingEnvelope } from '../../src/daemon/config.js';

const KEYS = ['STANDING_BUDGET_JSON', 'STANDING_SPEND_CEILING_USD', 'STANDING_PER_TREE_CEILING_USD'] as const;
const SAVED = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));

function clear(): void {
  for (const k of KEYS) delete process.env[k];
}

afterEach(() => {
  clear();
  for (const k of KEYS) {
    if (SAVED[k] !== undefined) process.env[k] = SAVED[k];
  }
});

const budgetJson = JSON.stringify({ usd: 5, tokens: 2_000_000, toolCalls: 500, wallClockMs: 1_800_000 });

describe('buildStandingEnvelope', () => {
  it('returns undefined when the required vars are absent', () => {
    clear();
    expect(buildStandingEnvelope()).toBeUndefined();
  });

  it('builds a USD envelope from budget + ceiling, with no per-tree reserve by default', () => {
    clear();
    process.env['STANDING_BUDGET_JSON'] = budgetJson;
    process.env['STANDING_SPEND_CEILING_USD'] = '12.5';
    const env = buildStandingEnvelope();
    expect(env?.spendCeilingUsd).toBe(12.5);
    expect(env?.perTreeCeilingUsd).toBeUndefined();
  });

  it('reads the optional per-tree ceiling when set', () => {
    clear();
    process.env['STANDING_BUDGET_JSON'] = budgetJson;
    process.env['STANDING_SPEND_CEILING_USD'] = '12.5';
    process.env['STANDING_PER_TREE_CEILING_USD'] = '3';
    const env = buildStandingEnvelope();
    expect(env?.perTreeCeilingUsd).toBe(3);
  });

  it('disables the envelope when the budget JSON is invalid', () => {
    clear();
    process.env['STANDING_BUDGET_JSON'] = 'not json';
    process.env['STANDING_SPEND_CEILING_USD'] = '5';
    expect(buildStandingEnvelope()).toBeUndefined();
  });
});
