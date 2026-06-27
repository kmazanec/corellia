import { describe, expect, it } from 'vitest';
import type { ChildPlan } from '../../src/contract/decision.js';
import {
  buildCoverageGoal,
  runKnowledgeCoverageSplitGate,
} from '../../src/engine/coverage/split-gate.js';
import {
  buildRegistry,
  leafTypeDef,
  makeGoal,
  MemoryEventStore,
  nonLeafTypeDef,
} from './stubs.js';

const child = (overrides: Partial<ChildPlan> & Pick<ChildPlan, 'localId'>): ChildPlan => ({
  localId: overrides.localId,
  type: overrides.type ?? 'impl',
  title: overrides.title ?? overrides.localId,
  spec: overrides.spec ?? {},
  dependsOn: overrides.dependsOn ?? [],
  scope: overrides.scope ?? [],
  budgetShare: overrides.budgetShare ?? 0.5,
});

function registry() {
  return buildRegistry([
    nonLeafTypeDef({ name: 'root' }),
    leafTypeDef({ name: 'impl', kind: 'make', leafOnly: true }),
    leafTypeDef({ name: 'map-repo', kind: 'learn', leafOnly: true }),
    leafTypeDef({ name: 'deep-dive-region', kind: 'learn', leafOnly: true }),
  ]);
}

describe('knowledge coverage split gate', () => {
  it('models make-leaf child scopes as the effective split scope', () => {
    const coverageGoal = buildCoverageGoal({
      goal: makeGoal({ type: 'root', scope: ['src/root'] }),
      kind: 'make',
      children: [child({ localId: 'build', scope: ['src/engine/'] })],
      repoRoot: '/repo',
      registry: registry(),
      regionExists: (_repoRoot, region) => region !== 'src/root',
    });

    expect(coverageGoal).toMatchObject({
      isRootSplit: false,
      scope: ['src/root', 'src/engine/'],
      existsByRegion: {
        'src/root': false,
        'src/engine': true,
      },
    });
  });

  it('emits a passing gate event without changing children when coverage is complete', async () => {
    const store = new MemoryEventStore();
    const children = [child({ localId: 'build', scope: ['src/engine'] })];

    const result = await runKnowledgeCoverageSplitGate({
      goal: makeGoal({ id: 'goal-1', type: 'root', scope: ['src/engine'] }),
      kind: 'make',
      children,
      repoRoot: '/repo',
      registry: registry(),
      store,
      now: () => 1,
      knowledge: {
        async query() {
          return {
            headSha: 'head',
            artifacts: [
              { repoRoot: '/repo', category: 'architecture', generatedAtSha: 'head' },
              { repoRoot: '/repo', category: 'stack', generatedAtSha: 'head' },
              { repoRoot: '/repo', category: 'conventions', generatedAtSha: 'head' },
              { repoRoot: '/repo', category: 'test-scaffold', generatedAtSha: 'head' },
            ],
            regionFacts: [
              { repoRoot: '/repo', region: 'src/engine', generatedAtSha: 'head' },
            ],
          };
        },
        async validate() {
          throw new Error('fresh artifacts should not validate');
        },
        mintComprehension: () => {
          throw new Error('coverage should pass');
        },
        regionExists: () => true,
      },
    });

    expect(result).toEqual(children);
    expect(await store.list({ type: 'gate-checked' })).toMatchObject([
      { goalId: 'goal-1', ok: true, missing: [] },
    ]);
  });

  it('injects one refresh child for a stale invalid category', async () => {
    const store = new MemoryEventStore();
    const children = [child({ localId: 'build', scope: ['src/engine'] })];

    const result = await runKnowledgeCoverageSplitGate({
      goal: makeGoal({ id: 'goal-2', type: 'root', scope: ['src/engine'] }),
      kind: 'make',
      children,
      repoRoot: '/repo',
      registry: registry(),
      store,
      now: () => 2,
      knowledge: {
        async query() {
          return {
            headSha: 'head',
            artifacts: [
              { repoRoot: '/repo', category: 'architecture', generatedAtSha: 'old' },
              { repoRoot: '/repo', category: 'stack', generatedAtSha: 'head' },
              { repoRoot: '/repo', category: 'conventions', generatedAtSha: 'head' },
              { repoRoot: '/repo', category: 'test-scaffold', generatedAtSha: 'head' },
            ],
            regionFacts: [
              { repoRoot: '/repo', region: 'src/engine', generatedAtSha: 'head' },
            ],
          };
        },
        async validate() {
          return false;
        },
        mintComprehension: () => [child({ localId: 'refresh-arch', type: 'map-repo' })],
        regionExists: () => true,
      },
    });

    expect(result.map((plan) => plan.localId)).toEqual(['refresh-arch', 'build']);
    expect(result.find((plan) => plan.localId === 'build')?.dependsOn).toEqual([
      'refresh-arch',
    ]);
    expect(await store.list({ type: 'gate-checked' })).toMatchObject([
      { ok: false, missing: ['refresh:map-repo:refresh-arch'] },
    ]);
  });
});
