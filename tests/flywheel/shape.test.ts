import { describe, it, expect } from 'vitest';
import { specShape } from '../../src/flywheel/shape.js';
import type { Goal } from '../../src/contract/goal.js';

// ── helpers ────────────────────────────────────────────────────────────────

function goal(overrides: Partial<Goal> = {}): Goal {
  return {
    id: 'g1',
    type: 'implement',
    parentId: null,
    title: 'implement user auth',
    spec: { files: ['auth.ts'], description: 'add JWT' },
    intent: 'production',
    scope: [],
    budget: { attempts: 5, tokens: 1000, toolCalls: 50, wallClockMs: 60_000 },
    memories: [],
    ...overrides,
  };
}

// ── collision cases (same shape must collide) ──────────────────────────────

describe('specShape — collision', () => {
  it('two goals with identical type, spec keys, and equivalent title collide', () => {
    const a = goal({ title: 'implement user auth' });
    const b = goal({ title: 'implement auth user' }); // word order differs
    expect(specShape(a)).toBe(specShape(b));
  });

  it('extra digits in title do not change the token', () => {
    const a = goal({ title: 'implement user auth' });
    const b = goal({ title: 'implement user auth 2024' }); // digits stripped
    expect(specShape(a)).toBe(specShape(b));
  });

  it('punctuation differences do not change the token', () => {
    const a = goal({ title: 'implement: user-auth!' });
    const b = goal({ title: 'implement user auth' });
    expect(specShape(a)).toBe(specShape(b));
  });

  it('extra title words beyond the 5-word window do not change the shape', () => {
    // first 5 meaningful words are the same in both
    const a = goal({ title: 'implement user auth module service extra' });
    const b = goal({ title: 'implement user auth module service different' });
    expect(specShape(a)).toBe(specShape(b));
  });

  it('spec key order does not matter — sorted keys produce the same shape', () => {
    const a = goal({ spec: { description: 'x', files: [] } });
    const b = goal({ spec: { files: [], description: 'x' } });
    expect(specShape(a)).toBe(specShape(b));
  });

  it('spec values do not influence the shape — only keys do', () => {
    const a = goal({ spec: { files: ['auth.ts'], description: 'JWT' } });
    const b = goal({ spec: { files: ['payments.ts'], description: 'Stripe' } });
    expect(specShape(a)).toBe(specShape(b));
  });
});

// ── non-collision cases (different work must not collide) ──────────────────

describe('specShape — non-collision', () => {
  it('different goal types produce different shapes', () => {
    const a = goal({ type: 'implement' });
    const b = goal({ type: 'critique-code' });
    expect(specShape(a)).not.toBe(specShape(b));
  });

  it('different spec key sets produce different shapes', () => {
    const a = goal({ spec: { files: [] } });
    const b = goal({ spec: { path: 'x', reason: 'y' } });
    expect(specShape(a)).not.toBe(specShape(b));
  });

  it('semantically different titles produce different shapes', () => {
    const a = goal({ title: 'implement user auth' });
    const b = goal({ title: 'design landing page components' });
    expect(specShape(a)).not.toBe(specShape(b));
  });

  it('array spec vs object spec do not collide', () => {
    const a = goal({ spec: { files: [] } });
    const b = goal({ spec: [] });
    expect(specShape(a)).not.toBe(specShape(b));
  });

  it('null spec vs empty-object spec do not collide', () => {
    const a = goal({ spec: null });
    const b = goal({ spec: {} });
    expect(specShape(a)).not.toBe(specShape(b));
  });

  it('string spec and number spec have different shapes', () => {
    const a = goal({ spec: 'text' });
    const b = goal({ spec: 42 });
    expect(specShape(a)).not.toBe(specShape(b));
  });
});

// ── stability / purity ────────────────────────────────────────────────────

describe('specShape — stability', () => {
  it('returns the same value on repeated calls for the same goal', () => {
    const g = goal();
    expect(specShape(g)).toBe(specShape(g));
  });

  it('shape contains the goal type', () => {
    const g = goal({ type: 'my-type' });
    expect(specShape(g)).toContain('my-type');
  });
});
