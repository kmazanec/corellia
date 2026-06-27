import { describe, expect, it } from 'vitest';
import type { Report } from '../../src/contract/report.js';
import {
  mergeComprehendChildArtifacts,
  mergeGenericChildArtifacts,
} from '../../src/engine/split-integration.js';
import { MemoryEventStore, leafTypeDef, makeGoal, textArtifact } from './stubs.js';

const report = (overrides: Partial<Report> = {}): Report => ({
  artifact: null,
  proof: [],
  lessons: [],
  memoriesUsed: [],
  blockers: [],
  findings: [],
  learned: '',
  ...overrides,
});

describe('split integration', () => {
  it('merges files preferentially over text artifacts for generic splits', () => {
    expect(mergeGenericChildArtifacts([
      report({ artifact: textArtifact('notes') }),
      report({ artifact: { kind: 'files', files: [{ path: 'src/a.ts', content: 'a' }] } }),
    ])).toEqual({ kind: 'files', files: [{ path: 'src/a.ts', content: 'a' }] });
  });

  it('joins text artifacts for generic splits when there are no files', () => {
    expect(mergeGenericChildArtifacts([
      report({ artifact: textArtifact('a') }),
      report({ artifact: textArtifact('b') }),
    ])).toEqual({ kind: 'text', text: 'a\nb' });
  });

  it('skips comprehend merge for non-comprehend goals', async () => {
    const result = await mergeComprehendChildArtifacts({
      goal: makeGoal({ type: 'impl' }),
      typeDef: leafTypeDef({ name: 'impl', family: 'build' }),
      childReports: [],
      activeRepoRoot: undefined,
      headSha: undefined,
      checkContext: undefined,
      store: new MemoryEventStore(),
      now: () => 1,
      persist: async () => {},
    });

    expect(result).toEqual({ kind: 'skipped' });
  });

  it('merges and persists valid deep-dive region child artifacts', async () => {
    const store = new MemoryEventStore();
    let persisted = false;
    const artifact = textArtifact(JSON.stringify({
      repoRoot: '/repo',
      region: 'src/a',
      generatedAtSha: 'old-child-sha',
      facts: [],
    }));

    const result = await mergeComprehendChildArtifacts({
      goal: makeGoal({ type: 'deep-dive-region', spec: { repoRoot: '/repo' } }),
      typeDef: leafTypeDef({
        name: 'deep-dive-region',
        family: 'comprehend',
        deterministic: [{
          name: 'ok',
          run: async () => ({ ok: true }),
        }],
      }),
      childReports: [report({ artifact })],
      activeRepoRoot: undefined,
      headSha: async () => 'head',
      checkContext: undefined,
      store,
      now: () => 2,
      persist: async () => { persisted = true; },
    });

    expect(result.kind).toBe('handled');
    if (result.kind === 'handled') {
      expect(result.blockers).toEqual([]);
      expect(result.mergedArtifact?.kind).toBe('text');
      expect(result.mergedArtifact?.kind === 'text' ? result.mergedArtifact.text : '').toContain('"generatedAtSha":"head"');
    }
    expect(persisted).toBe(true);
    expect(await store.list({ type: 'deterministic-checked' })).toHaveLength(1);
  });

  it('returns blockers when the merged comprehend artifact fails deterministic checks', async () => {
    const store = new MemoryEventStore();
    const artifact = textArtifact(JSON.stringify({
      repoRoot: '/repo',
      region: 'src/a',
      generatedAtSha: 'head',
      facts: [],
    }));

    const result = await mergeComprehendChildArtifacts({
      goal: makeGoal({ type: 'deep-dive-region' }),
      typeDef: leafTypeDef({
        name: 'deep-dive-region',
        family: 'comprehend',
        deterministic: [{
          name: 'anchor-check',
          run: async () => ({ ok: false, detail: 'missing anchor' }),
        }],
      }),
      childReports: [report({ artifact })],
      activeRepoRoot: undefined,
      headSha: undefined,
      checkContext: undefined,
      store,
      now: () => 3,
      persist: async () => {
        throw new Error('failed merges must not persist');
      },
    });

    expect(result).toMatchObject({
      kind: 'handled',
      mergedArtifact: null,
      blockers: ['Comprehension integrate merge failed its deterministic gate: comprehend-merge anchor-check: missing anchor'],
      findings: ['comprehend-merge anchor-check: missing anchor'],
    });
  });
});
