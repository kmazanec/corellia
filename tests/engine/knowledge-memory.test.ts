import { describe, expect, it } from 'vitest';
import type { RegionFacts } from '../../src/contract/knowledge.js';
import { diveFactsAsMemories, regionFactsToMemories } from '../../src/engine/knowledge-memory.js';

const regionFacts = (overrides: Partial<RegionFacts> = {}): RegionFacts => ({
  repoRoot: '/repo',
  region: 'src/engine',
  generatedAtSha: 'head',
  facts: [
    {
      claim: 'Engine owns recursive dispatch',
      anchors: [{ path: 'src/engine/engine.ts', line: 10 }],
      sha: 'head',
      confidence: 'high',
    },
  ],
  ...overrides,
});

describe('knowledge memory handoff', () => {
  it('adapts fresh region facts into trusted project memory pointers', () => {
    expect(regionFactsToMemories([regionFacts()], 'head')).toEqual([
      {
        id: 'dive:src/engine#0',
        layer: 'project',
        content: 'Engine owns recursive dispatch — src/engine/engine.ts:10',
        provenance: 'trusted',
      },
    ]);
  });

  it('marks drifted facts provisional', () => {
    const [pointer] = regionFactsToMemories([regionFacts({ generatedAtSha: 'old' })], 'head');

    expect(pointer?.provenance).toBe('provisional');
  });

  it('uses the claim alone when a fact has no anchors', () => {
    const [pointer] = regionFactsToMemories([
      regionFacts({
        facts: [{ claim: 'No anchor claim', anchors: [], sha: 'head', confidence: 'medium' }],
      }),
    ], 'head');

    expect(pointer?.content).toBe('No anchor claim');
  });

  it('returns empty memory when the fact source is absent or repo root is unavailable', async () => {
    await expect(diveFactsAsMemories({
      factsForRegions: undefined,
      repoRoot: '/repo',
      scope: ['src'],
      headSha: 'head',
    })).resolves.toEqual([]);

    await expect(diveFactsAsMemories({
      factsForRegions: async () => [regionFacts()],
      repoRoot: '',
      scope: ['src'],
      headSha: 'head',
    })).resolves.toEqual([]);
  });

  it('returns empty memory when fact lookup fails', async () => {
    await expect(diveFactsAsMemories({
      factsForRegions: async () => {
        throw new Error('projection unavailable');
      },
      repoRoot: '/repo',
      scope: ['src'],
      headSha: 'head',
    })).resolves.toEqual([]);
  });
});
