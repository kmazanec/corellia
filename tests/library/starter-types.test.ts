/**
 * Tests for the starter goal-type definitions and their registry integration.
 */

import { describe, it, expect } from 'vitest';
import { starterTypes } from '../../src/library/starter-types.js';
import { createRegistry } from '../../src/library/registry.js';

describe('starterTypes', () => {
  it('returns an array with the eight defined types', () => {
    const types = starterTypes();
    expect(types.length).toBe(8);
  });

  it('all types are loadable into a registry without error', () => {
    expect(() => createRegistry(starterTypes())).not.toThrow();
  });

  it('registry can look up each starter type by name', () => {
    const reg = createRegistry(starterTypes());
    const expectedNames = [
      'deliver-intent',
      'freeze-contract',
      'implement',
      'characterize',
      'judge-split',
      'judge-integration',
      'critique-code',
      'promote-memory',
    ];
    for (const name of expectedNames) {
      expect(() => reg.get(name)).not.toThrow();
      expect(reg.get(name).name).toBe(name);
    }
  });

  describe('deliver-intent', () => {
    it('has kind make and is NOT leafOnly', () => {
      const reg = createRegistry(starterTypes());
      const def = reg.get('deliver-intent');
      expect(def.kind).toBe('make');
      expect(def.leafOnly).toBe(false);
    });

    it('uses opus as default tier', () => {
      const reg = createRegistry(starterTypes());
      expect(reg.get('deliver-intent').tier.default).toBe('opus');
    });

    it('delegates to judge-integration', () => {
      const reg = createRegistry(starterTypes());
      expect(reg.get('deliver-intent').judgeType).toBe('judge-integration');
    });

    it('has no code-write grants', () => {
      const reg = createRegistry(starterTypes());
      const grants = reg.get('deliver-intent').grants;
      expect(grants).not.toContain('fs.write');
    });
  });

  describe('freeze-contract', () => {
    it('has kind make and IS leafOnly', () => {
      const reg = createRegistry(starterTypes());
      const def = reg.get('freeze-contract');
      expect(def.kind).toBe('make');
      expect(def.leafOnly).toBe(true);
    });

    it('uses opus as default tier', () => {
      expect(createRegistry(starterTypes()).get('freeze-contract').tier.default).toBe('opus');
    });

    it('has three deterministic checks: artifact-present, files-within-scope, process-clean', () => {
      const checks = createRegistry(starterTypes()).get('freeze-contract').deterministic;
      const names = checks.map((c) => c.name);
      expect(names).toContain('artifact-present');
      expect(names).toContain('files-within-scope');
      expect(names).toContain('process-clean');
    });

    it('delegates to critique-code', () => {
      expect(createRegistry(starterTypes()).get('freeze-contract').judgeType).toBe('critique-code');
    });
  });

  describe('implement', () => {
    it('has kind make and IS leafOnly', () => {
      const def = createRegistry(starterTypes()).get('implement');
      expect(def.kind).toBe('make');
      expect(def.leafOnly).toBe(true);
    });

    it('uses sonnet as default tier, escalates to opus', () => {
      const def = createRegistry(starterTypes()).get('implement');
      expect(def.tier.default).toBe('sonnet');
      expect(def.tier.ladder).toContain('opus');
    });

    it('has three deterministic checks', () => {
      const checks = createRegistry(starterTypes()).get('implement').deterministic;
      expect(checks.map((c) => c.name)).toContain('artifact-present');
      expect(checks.map((c) => c.name)).toContain('files-within-scope');
      expect(checks.map((c) => c.name)).toContain('process-clean');
    });

    it('delegates to critique-code', () => {
      expect(createRegistry(starterTypes()).get('implement').judgeType).toBe('critique-code');
    });
  });

  describe('characterize', () => {
    it('has kind make and IS leafOnly', () => {
      const def = createRegistry(starterTypes()).get('characterize');
      expect(def.kind).toBe('make');
      expect(def.leafOnly).toBe(true);
    });

    it('uses sonnet as default tier, escalates to opus', () => {
      const def = createRegistry(starterTypes()).get('characterize');
      expect(def.tier.default).toBe('sonnet');
      expect(def.tier.ladder).toContain('opus');
    });

    it('has two deterministic checks: artifact-present and files-within-scope (no process-clean)', () => {
      const checks = createRegistry(starterTypes()).get('characterize').deterministic;
      const names = checks.map((c) => c.name);
      expect(names).toContain('artifact-present');
      expect(names).toContain('files-within-scope');
      expect(names).not.toContain('process-clean');
    });

    it('delegates to critique-code', () => {
      expect(createRegistry(starterTypes()).get('characterize').judgeType).toBe('critique-code');
    });
  });

  describe('judge types', () => {
    const judgeNames = ['judge-split', 'judge-integration', 'critique-code'];

    it.each(judgeNames)('%s has kind judge', (name) => {
      expect(createRegistry(starterTypes()).get(name).kind).toBe('judge');
    });

    it.each(judgeNames)('%s is leafOnly', (name) => {
      expect(createRegistry(starterTypes()).get(name).leafOnly).toBe(true);
    });

    it.each(judgeNames)('%s has no deterministic checks', (name) => {
      expect(createRegistry(starterTypes()).get(name).deterministic).toHaveLength(0);
    });

    it.each(judgeNames)('%s has null judgeType', (name) => {
      expect(createRegistry(starterTypes()).get(name).judgeType).toBeNull();
    });

    it.each(judgeNames)('%s has empty grants', (name) => {
      expect(createRegistry(starterTypes()).get(name).grants).toHaveLength(0);
    });

    it.each(judgeNames)('%s uses sonnet default tier', (name) => {
      expect(createRegistry(starterTypes()).get(name).tier.default).toBe('sonnet');
    });

    it.each(judgeNames)('%s ladder includes opus', (name) => {
      expect(createRegistry(starterTypes()).get(name).tier.ladder).toContain('opus');
    });

    it('judge-split belongs to the arbiter family', () => {
      expect(createRegistry(starterTypes()).get('judge-split').family).toBe('arbiter');
    });

    it('judge-integration belongs to the arbiter family', () => {
      expect(createRegistry(starterTypes()).get('judge-integration').family).toBe('arbiter');
    });

    it('critique-code belongs to the critique family', () => {
      expect(createRegistry(starterTypes()).get('critique-code').family).toBe('critique');
    });
  });

  describe('promote-memory', () => {
    it('has kind evolve and IS leafOnly', () => {
      const def = createRegistry(starterTypes()).get('promote-memory');
      expect(def.kind).toBe('evolve');
      expect(def.leafOnly).toBe(true);
    });

    it('belongs to the curate family', () => {
      expect(createRegistry(starterTypes()).get('promote-memory').family).toBe('curate');
    });

    it('uses sonnet as default tier', () => {
      expect(createRegistry(starterTypes()).get('promote-memory').tier.default).toBe('sonnet');
    });

    it('has null judgeType', () => {
      expect(createRegistry(starterTypes()).get('promote-memory').judgeType).toBeNull();
    });

    it('holds the memory.write grant', () => {
      const grants = createRegistry(starterTypes()).get('promote-memory').grants;
      expect(grants).toContain('memory.write');
    });
  });
});
