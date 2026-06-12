/**
 * Tests for createRegistry.
 */

import { describe, it, expect } from 'vitest';
import { createRegistry } from '../../src/library/registry.js';
import type { GoalTypeDef } from '../../src/contract/goal-type.js';

const fakeDef = (name: string): GoalTypeDef => ({
  name,
  kind: 'make',
  family: 'build',
  leafOnly: true,
  tier: { default: 'mid', ladder: ['mid', 'high'] },
  deterministic: [],
  judgeType: null,
  grants: [],
});

describe('createRegistry', () => {
  it('returns a registry with the provided types', () => {
    const reg = createRegistry([fakeDef('alpha'), fakeDef('beta')]);
    expect(reg.has('alpha')).toBe(true);
    expect(reg.has('beta')).toBe(true);
    expect(reg.has('gamma')).toBe(false);
  });

  it('get returns the correct definition', () => {
    const def = fakeDef('my-type');
    const reg = createRegistry([def]);
    expect(reg.get('my-type')).toBe(def);
  });

  it('get throws a helpful error on unknown name', () => {
    const reg = createRegistry([fakeDef('alpha'), fakeDef('beta')]);
    expect(() => reg.get('unknown')).toThrow(/unknown/i);
    expect(() => reg.get('unknown')).toThrow('alpha');
    expect(() => reg.get('unknown')).toThrow('beta');
  });

  it('names() returns all registered type names', () => {
    const reg = createRegistry([fakeDef('x'), fakeDef('y'), fakeDef('z')]);
    const names = reg.names();
    expect(names).toContain('x');
    expect(names).toContain('y');
    expect(names).toContain('z');
    expect(names).toHaveLength(3);
  });

  it('names() returns empty array when no types are registered', () => {
    const reg = createRegistry([]);
    expect(reg.names()).toHaveLength(0);
  });

  it('get throws a readable message mentioning the missing name', () => {
    const reg = createRegistry([fakeDef('alpha')]);
    let message = '';
    try {
      reg.get('missing-type');
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain('missing-type');
  });

  it('get error message lists registered type names when registry is empty', () => {
    const reg = createRegistry([]);
    expect(() => reg.get('anything')).toThrow('(none)');
  });
});
