import { describe, it, expect } from 'vitest';
import { subdivide, consume } from '../../src/engine/budget.js';
import type { Budget } from '../../src/contract/goal.js';

const base: Budget = {
  attempts: 10,
  tokens: 1000,
  toolCalls: 100,
  wallClockMs: 60_000,
};

describe('subdivide', () => {
  it('returns proportional budgets', () => {
    const [a, b] = subdivide(base, [0.5, 0.5]);
    expect(a!.attempts).toBe(5);
    expect(b!.attempts).toBe(5);
    expect(a!.tokens).toBe(500);
    expect(b!.tokens).toBe(500);
  });

  it('floors fractional results', () => {
    const [a] = subdivide(base, [0.33]);
    expect(a!.attempts).toBe(3); // floor(10 * 0.33) = 3
  });

  it('guarantees at least 1 attempt per child', () => {
    const tiny: Budget = { attempts: 1, tokens: 1, toolCalls: 1, wallClockMs: 1 };
    const [a, b] = subdivide(tiny, [0.1, 0.1]);
    expect(a!.attempts).toBeGreaterThanOrEqual(1);
    expect(b!.attempts).toBeGreaterThanOrEqual(1);
  });

  it('handles a single child with share 1.0', () => {
    const [a] = subdivide(base, [1.0]);
    expect(a!.attempts).toBe(10);
    expect(a!.tokens).toBe(1000);
  });

  it('sums ≤ parent (no share overflow)', () => {
    const shares = [0.3, 0.3, 0.3];
    const parts = subdivide(base, shares);
    const totalAttempts = parts.reduce((s, p) => s + p.attempts, 0);
    expect(totalAttempts).toBeLessThanOrEqual(base.attempts);
  });
});

describe('consume', () => {
  it('decrements the specified dimension', () => {
    const { budget } = consume(base, 'attempts');
    expect(budget.attempts).toBe(9);
    expect(budget.tokens).toBe(1000); // untouched
  });

  it('reports exhausted when dimension hits 0', () => {
    const b: Budget = { ...base, attempts: 1 };
    const { exhausted } = consume(b, 'attempts');
    expect(exhausted).toBe(true);
  });

  it('reports not exhausted when dimension > 0 after decrement', () => {
    const { exhausted } = consume(base, 'attempts');
    expect(exhausted).toBe(false);
  });

  it('can consume tokens, toolCalls, and wallClockMs', () => {
    const { budget: b1 } = consume(base, 'tokens');
    expect(b1.tokens).toBe(999);

    const { budget: b2 } = consume(base, 'toolCalls');
    expect(b2.toolCalls).toBe(99);

    const { budget: b3 } = consume(base, 'wallClockMs');
    expect(b3.wallClockMs).toBe(59_999);
  });
});
