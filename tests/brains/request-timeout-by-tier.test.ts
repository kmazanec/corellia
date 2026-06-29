import { describe, it, expect } from 'vitest';
import { requestTimeoutMsForTier } from '../../src/brains/llm.js';

describe('requestTimeoutMsForTier', () => {
  it('uses the per-tier default when nothing is configured (high > mid > low)', () => {
    expect(requestTimeoutMsForTier({}, 'low')).toBe(120_000);
    expect(requestTimeoutMsForTier({}, 'mid')).toBe(180_000);
    expect(requestTimeoutMsForTier({}, 'high')).toBe(360_000);
  });

  it('an explicit per-tier override wins over everything', () => {
    const cfg = { requestTimeoutMs: 5_000, requestTimeoutMsByTier: { high: 600_000 } };
    expect(requestTimeoutMsForTier(cfg, 'high')).toBe(600_000);
  });

  it('falls back to the flat requestTimeoutMs for a tier without an override', () => {
    const cfg = { requestTimeoutMs: 5_000, requestTimeoutMsByTier: { high: 600_000 } };
    expect(requestTimeoutMsForTier(cfg, 'low')).toBe(5_000);
    expect(requestTimeoutMsForTier(cfg, 'mid')).toBe(5_000);
  });

  it('uses the flat default for a tier-agnostic call (undefined tier)', () => {
    expect(requestTimeoutMsForTier({}, undefined)).toBe(120_000);
  });

  it('a flat requestTimeoutMs applies to a tier-agnostic call', () => {
    expect(requestTimeoutMsForTier({ requestTimeoutMs: 7_000 }, undefined)).toBe(7_000);
  });
});
