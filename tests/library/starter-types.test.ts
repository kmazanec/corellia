/**
 * Tests for the starter goal-type definitions and their registry integration.
 */

import { describe, it, expect } from 'vitest';
import { starterTypes } from '../../src/library/starter-types.js';
import { createRegistry } from '../../src/library/registry.js';
import { lintLibrary } from '../../src/library/constitution.js';

describe('starterTypes', () => {
  it('returns the complete nineteen-type GOAL-TYPES library', () => {
    const types = starterTypes();
    expect(types.length).toBe(19);
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
      'critique-doc',
      'critique-ui',
      'promote-memory',
      'map-repo',
      'deep-dive-region',
      'write-prd',
      'design-arch',
      'research-external',
      'investigate',
      'consolidate-memory',
      'propose-pattern',
      'improve-factory',
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

    it('uses high as default tier', () => {
      const reg = createRegistry(starterTypes());
      expect(reg.get('deliver-intent').tier.default).toBe('high');
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

    it('uses high as default tier', () => {
      expect(createRegistry(starterTypes()).get('freeze-contract').tier.default).toBe('high');
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

    it('uses mid as default tier, escalates to high', () => {
      const def = createRegistry(starterTypes()).get('implement');
      expect(def.tier.default).toBe('mid');
      expect(def.tier.ladder).toContain('high');
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

    it('uses mid as default tier, escalates to high', () => {
      const def = createRegistry(starterTypes()).get('characterize');
      expect(def.tier.default).toBe('mid');
      expect(def.tier.ladder).toContain('high');
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
    const judgeNames = ['judge-split', 'judge-integration', 'critique-code', 'critique-doc', 'critique-ui'];

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

    // critique-doc and critique-ui carry read grants (fs.read, retrieval.api);
    // the arbiter types and critique-code have no grants.
    const judgeNamesNoGrants = ['judge-split', 'judge-integration', 'critique-code'];
    it.each(judgeNamesNoGrants)('%s has empty grants', (name) => {
      expect(createRegistry(starterTypes()).get(name).grants).toHaveLength(0);
    });

    // All critique doc/ui judges have no write grants (judge-kind ceiling).
    it.each(['critique-doc', 'critique-ui'])('%s has no write grants', (name) => {
      const grants = createRegistry(starterTypes()).get(name).grants;
      expect(grants.some((g) => g.includes('write'))).toBe(false);
    });

    it.each(judgeNames)('%s uses mid default tier', (name) => {
      expect(createRegistry(starterTypes()).get(name).tier.default).toBe('mid');
    });

    it.each(judgeNames)('%s ladder includes high', (name) => {
      expect(createRegistry(starterTypes()).get(name).tier.ladder).toContain('high');
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

    it('critique-doc belongs to the critique family', () => {
      expect(createRegistry(starterTypes()).get('critique-doc').family).toBe('critique');
    });

    it('critique-ui belongs to the critique family', () => {
      expect(createRegistry(starterTypes()).get('critique-ui').family).toBe('critique');
    });
  });

  describe('critique-doc', () => {
    it('has kind judge and is leafOnly', () => {
      const def = createRegistry(starterTypes()).get('critique-doc');
      expect(def.kind).toBe('judge');
      expect(def.leafOnly).toBe(true);
    });

    it('has fs.read and retrieval.api grants (no write)', () => {
      const grants = createRegistry(starterTypes()).get('critique-doc').grants;
      expect(grants).toContain('fs.read');
      expect(grants).toContain('retrieval.api');
      expect(grants.some((g) => g.includes('write'))).toBe(false);
    });

    it('has no deterministic checks (judge kind)', () => {
      expect(createRegistry(starterTypes()).get('critique-doc').deterministic).toHaveLength(0);
    });

    it('has null judgeType', () => {
      expect(createRegistry(starterTypes()).get('critique-doc').judgeType).toBeNull();
    });

    it('passes constitution lint as part of the full set', () => {
      expect(lintLibrary(starterTypes())).toHaveLength(0);
    });
  });

  describe('critique-ui', () => {
    it('has kind judge and is leafOnly', () => {
      const def = createRegistry(starterTypes()).get('critique-ui');
      expect(def.kind).toBe('judge');
      expect(def.leafOnly).toBe(true);
    });

    it('has fs.read and retrieval.api grants (no write, no browser in v1)', () => {
      const grants = createRegistry(starterTypes()).get('critique-ui').grants;
      expect(grants).toContain('fs.read');
      expect(grants).toContain('retrieval.api');
      expect(grants.some((g) => g.includes('write'))).toBe(false);
      // No browser grant in v1 — deferred
      expect(grants).not.toContain('browser.drive');
      expect(grants).not.toContain('browser');
    });

    it('has no deterministic checks (judge kind)', () => {
      expect(createRegistry(starterTypes()).get('critique-ui').deterministic).toHaveLength(0);
    });

    it('has null judgeType', () => {
      expect(createRegistry(starterTypes()).get('critique-ui').judgeType).toBeNull();
    });

    it('passes constitution lint as part of the full set', () => {
      expect(lintLibrary(starterTypes())).toHaveLength(0);
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

    it('uses mid as default tier', () => {
      expect(createRegistry(starterTypes()).get('promote-memory').tier.default).toBe('mid');
    });

    it('has null judgeType', () => {
      expect(createRegistry(starterTypes()).get('promote-memory').judgeType).toBeNull();
    });

    it('holds the memory.write grant', () => {
      const grants = createRegistry(starterTypes()).get('promote-memory').grants;
      expect(grants).toContain('memory.write');
    });
  });

  describe('map-repo', () => {
    it('has kind learn and is NOT leafOnly (ADR-029: comprehension recurses)', () => {
      const def = createRegistry(starterTypes()).get('map-repo');
      expect(def.kind).toBe('learn');
      expect(def.leafOnly).toBe(false);
    });

    it('belongs to the comprehend family', () => {
      expect(createRegistry(starterTypes()).get('map-repo').family).toBe('comprehend');
    });

    it('uses mid as default tier, escalates to high', () => {
      const def = createRegistry(starterTypes()).get('map-repo');
      expect(def.tier.default).toBe('mid');
      expect(def.tier.ladder).toEqual(['mid', 'high']);
    });

    it('has null judgeType', () => {
      expect(createRegistry(starterTypes()).get('map-repo').judgeType).toBeNull();
    });

    it('has read-only + run-scoped grants (no write grants)', () => {
      const grants = createRegistry(starterTypes()).get('map-repo').grants;
      expect(grants).toContain('fs.read');
      expect(grants).toContain('retrieval.api');
      expect(grants).toContain('test.run_scoped');
      expect(grants.some((g) => g.includes('write'))).toBe(false);
    });

    it('has deterministic checks including artifact-present and knowledge:map-repo', () => {
      const checks = createRegistry(starterTypes()).get('map-repo').deterministic;
      const names = checks.map((c) => c.name);
      expect(names).toContain('artifact-present');
      expect(names).toContain('knowledge:map-repo');
    });

    it('passes constitution lint', () => {
      expect(lintLibrary(starterTypes())).toHaveLength(0);
    });
  });

  describe('deep-dive-region', () => {
    it('has kind learn and is NOT leafOnly (ADR-029: comprehension recurses)', () => {
      const def = createRegistry(starterTypes()).get('deep-dive-region');
      expect(def.kind).toBe('learn');
      expect(def.leafOnly).toBe(false);
    });

    it('belongs to the comprehend family', () => {
      expect(createRegistry(starterTypes()).get('deep-dive-region').family).toBe('comprehend');
    });

    it('uses mid as default tier, escalates to high', () => {
      const def = createRegistry(starterTypes()).get('deep-dive-region');
      expect(def.tier.default).toBe('mid');
      expect(def.tier.ladder).toEqual(['mid', 'high']);
    });

    it('has null judgeType', () => {
      expect(createRegistry(starterTypes()).get('deep-dive-region').judgeType).toBeNull();
    });

    it('has read-only grants only (no write, no run)', () => {
      const grants = createRegistry(starterTypes()).get('deep-dive-region').grants;
      expect(grants).toContain('fs.read');
      expect(grants).toContain('retrieval.api');
      expect(grants.some((g) => g.includes('write'))).toBe(false);
      expect(grants).not.toContain('test.run_scoped');
    });

    it('has deterministic checks including artifact-present and knowledge:dive-anchor', () => {
      const checks = createRegistry(starterTypes()).get('deep-dive-region').deterministic;
      const names = checks.map((c) => c.name);
      expect(names).toContain('artifact-present');
      expect(names).toContain('knowledge:dive-anchor');
    });
  });

  describe('write-prd', () => {
    it('has kind make and IS leafOnly', () => {
      const def = createRegistry(starterTypes()).get('write-prd');
      expect(def.kind).toBe('make');
      expect(def.leafOnly).toBe(true);
    });

    it('belongs to the author family', () => {
      expect(createRegistry(starterTypes()).get('write-prd').family).toBe('author');
    });

    it('uses mid as default tier, escalates to high', () => {
      const def = createRegistry(starterTypes()).get('write-prd');
      expect(def.tier.default).toBe('mid');
      expect(def.tier.ladder).toContain('high');
    });

    it('delegates to critique-doc', () => {
      expect(createRegistry(starterTypes()).get('write-prd').judgeType).toBe('critique-doc');
    });

    it('has deterministic checks including artifact-present and prd:shape', () => {
      const names = createRegistry(starterTypes()).get('write-prd').deterministic.map((c) => c.name);
      expect(names).toContain('artifact-present');
      expect(names).toContain('prd:shape');
    });

    it('has doc read/write and retrieval grants', () => {
      const grants = createRegistry(starterTypes()).get('write-prd').grants;
      expect(grants).toContain('fs.read');
      expect(grants).toContain('fs.write');
      expect(grants).toContain('retrieval.api');
    });

    it('has an outputSchema set', () => {
      expect(createRegistry(starterTypes()).get('write-prd').outputSchema).toBeDefined();
    });
  });

  describe('design-arch', () => {
    it('has kind make and IS leafOnly', () => {
      const def = createRegistry(starterTypes()).get('design-arch');
      expect(def.kind).toBe('make');
      expect(def.leafOnly).toBe(true);
    });

    it('belongs to the author family', () => {
      expect(createRegistry(starterTypes()).get('design-arch').family).toBe('author');
    });

    it('uses high as default tier (bad arch poisons every sibling)', () => {
      expect(createRegistry(starterTypes()).get('design-arch').tier.default).toBe('high');
    });

    it('delegates to critique-doc', () => {
      expect(createRegistry(starterTypes()).get('design-arch').judgeType).toBe('critique-doc');
    });

    it('has deterministic checks including artifact-present and arch:sections', () => {
      const names = createRegistry(starterTypes()).get('design-arch').deterministic.map((c) => c.name);
      expect(names).toContain('artifact-present');
      expect(names).toContain('arch:sections');
    });

    it('has a scan policy with k=3 and three lenses', () => {
      const scan = createRegistry(starterTypes()).get('design-arch').scan;
      expect(scan).toBeDefined();
      expect(scan!.k).toBe(3);
      expect(scan!.lenses).toHaveLength(3);
    });

    it('scan lenses include architect, reuse, contrarian', () => {
      const lenses = createRegistry(starterTypes()).get('design-arch').scan!.lenses;
      expect(lenses).toContain('architect');
      expect(lenses).toContain('reuse');
      expect(lenses).toContain('contrarian');
    });
  });

  describe('research-external', () => {
    it('has kind learn and IS leafOnly', () => {
      const def = createRegistry(starterTypes()).get('research-external');
      expect(def.kind).toBe('learn');
      expect(def.leafOnly).toBe(true);
    });

    it('belongs to the research family', () => {
      expect(createRegistry(starterTypes()).get('research-external').family).toBe('research');
    });

    it('uses mid as default tier, escalates to high', () => {
      const def = createRegistry(starterTypes()).get('research-external');
      expect(def.tier.default).toBe('mid');
      expect(def.tier.ladder).toContain('high');
    });

    it('has null judgeType', () => {
      expect(createRegistry(starterTypes()).get('research-external').judgeType).toBeNull();
    });

    it('has deterministic checks including artifact-present and findings:sources-present', () => {
      const names = createRegistry(starterTypes()).get('research-external').deterministic.map((c) => c.name);
      expect(names).toContain('artifact-present');
      expect(names).toContain('findings:sources-present');
    });

    it('has web search/fetch grants but no fs.write', () => {
      const grants = createRegistry(starterTypes()).get('research-external').grants;
      expect(grants).toContain('web.search');
      expect(grants).toContain('web.fetch');
      expect(grants.some((g) => g.includes('write'))).toBe(false);
    });

    it('has an outputSchema set', () => {
      expect(createRegistry(starterTypes()).get('research-external').outputSchema).toBeDefined();
    });
  });

  describe('investigate', () => {
    it('has kind learn and is NOT leafOnly', () => {
      const def = createRegistry(starterTypes()).get('investigate');
      expect(def.kind).toBe('learn');
      expect(def.leafOnly).toBe(false);
    });

    it('belongs to the diagnose family', () => {
      expect(createRegistry(starterTypes()).get('investigate').family).toBe('diagnose');
    });

    it('uses mid as default tier, escalates to high', () => {
      const def = createRegistry(starterTypes()).get('investigate');
      expect(def.tier.default).toBe('mid');
      expect(def.tier.ladder).toContain('high');
    });

    it('delegates to critique-doc (confidence-threshold judge)', () => {
      expect(createRegistry(starterTypes()).get('investigate').judgeType).toBe('critique-doc');
    });

    it('has deterministic check artifact-present', () => {
      const names = createRegistry(starterTypes()).get('investigate').deterministic.map((c) => c.name);
      expect(names).toContain('artifact-present');
    });

    it('has spawn grant for child probes', () => {
      const grants = createRegistry(starterTypes()).get('investigate').grants;
      expect(grants).toContain('spawn');
    });

    it('has read and retrieval grants but no write grants', () => {
      const grants = createRegistry(starterTypes()).get('investigate').grants;
      expect(grants).toContain('fs.read');
      expect(grants).toContain('retrieval.api');
      expect(grants.some((g) => g.includes('write'))).toBe(false);
    });
  });

  describe('critique-doc', () => {
    it('has kind judge and is leafOnly', () => {
      const def = createRegistry(starterTypes()).get('critique-doc');
      expect(def.kind).toBe('judge');
      expect(def.leafOnly).toBe(true);
    });

    it('has fs.read and retrieval.api grants (no write)', () => {
      const grants = createRegistry(starterTypes()).get('critique-doc').grants;
      expect(grants).toContain('fs.read');
      expect(grants).toContain('retrieval.api');
      expect(grants.some((g) => g.includes('write'))).toBe(false);
    });

    it('has no deterministic checks (judge kind)', () => {
      expect(createRegistry(starterTypes()).get('critique-doc').deterministic).toHaveLength(0);
    });

    it('has null judgeType', () => {
      expect(createRegistry(starterTypes()).get('critique-doc').judgeType).toBeNull();
    });

    it('passes constitution lint as part of the full set', () => {
      expect(lintLibrary(starterTypes())).toHaveLength(0);
    });
  });

  describe('critique-ui', () => {
    it('has kind judge and is leafOnly', () => {
      const def = createRegistry(starterTypes()).get('critique-ui');
      expect(def.kind).toBe('judge');
      expect(def.leafOnly).toBe(true);
    });

    it('has fs.read and retrieval.api grants (no write, no browser in v1)', () => {
      const grants = createRegistry(starterTypes()).get('critique-ui').grants;
      expect(grants).toContain('fs.read');
      expect(grants).toContain('retrieval.api');
      expect(grants.some((g) => g.includes('write'))).toBe(false);
      // No browser grant in v1 — deferred
      expect(grants).not.toContain('browser.drive');
      expect(grants).not.toContain('browser');
    });

    it('has no deterministic checks (judge kind)', () => {
      expect(createRegistry(starterTypes()).get('critique-ui').deterministic).toHaveLength(0);
    });

    it('has null judgeType', () => {
      expect(createRegistry(starterTypes()).get('critique-ui').judgeType).toBeNull();
    });

    it('passes constitution lint as part of the full set', () => {
      expect(lintLibrary(starterTypes())).toHaveLength(0);
    });
  });

  describe('constitution compliance — the full library', () => {
    it('lintLibrary passes with all nineteen types registered', () => {
      expect(lintLibrary(starterTypes())).toHaveLength(0);
    });
  });
});
