import { describe, expect, it } from 'vitest';
import type { ChildPlan } from '../../src/contract/decision.js';
import type { KnowledgeArtifact } from '../../src/contract/knowledge.js';
import { checkpointVerifyArtifacts } from '../../src/engine/coverage-checkpoint.js';
import { MemoryEventStore, makeGoal } from './stubs.js';

const refreshChild = (localId: string): ChildPlan => ({
  localId,
  type: 'map-repo',
  title: localId,
  spec: {},
  dependsOn: [],
  scope: [],
  budgetShare: 0.1,
});

describe('coverage checkpoint', () => {
  it('skips fresh artifacts', async () => {
    const store = new MemoryEventStore();
    const result = await checkpointVerifyArtifacts({
      goal: makeGoal(),
      knowledge: {
        headSha: 'head',
        artifacts: [{ repoRoot: '/repo', category: 'architecture', generatedAtSha: 'head' }],
        regionFacts: [],
      },
      repoRoot: '/repo',
      knowledgeGateway: {
        async validate() {
          throw new Error('fresh artifacts should not be validated');
        },
        mintComprehension: () => [],
      },
      store,
      now: () => 1,
    });

    expect(result.refreshChildren).toEqual([]);
    expect(await store.list({ type: 'knowledge-checked' })).toEqual([]);
  });

  it('records stale-validated artifacts as coverage-ok categories', async () => {
    const store = new MemoryEventStore();
    const validated: KnowledgeArtifact[] = [];

    const result = await checkpointVerifyArtifacts({
      goal: makeGoal({ id: 'goal-1' }),
      knowledge: {
        headSha: 'head',
        artifacts: [{ repoRoot: '/repo', category: 'stack', generatedAtSha: 'old' }],
        regionFacts: [],
      },
      repoRoot: '/repo',
      knowledgeGateway: {
        async validate(artifact) {
          validated.push(artifact);
          return true;
        },
        mintComprehension: () => [],
      },
      store,
      now: () => 2,
    });

    expect(validated[0]?.category).toBe('stack');
    expect(result.validatedOk.has('stack')).toBe(true);
    expect(result.refreshChildren).toEqual([]);
    expect(await store.list({ type: 'knowledge-checked' })).toMatchObject([
      { goalId: 'goal-1', category: 'stack', outcome: 'stale-validated' },
    ]);
  });

  it('records invalid artifacts and mints one refresh child for the category', async () => {
    const store = new MemoryEventStore();

    const result = await checkpointVerifyArtifacts({
      goal: makeGoal({ id: 'goal-2' }),
      knowledge: {
        headSha: 'head',
        artifacts: [{ repoRoot: '/repo', category: 'architecture', generatedAtSha: 'old' }],
        regionFacts: [],
      },
      repoRoot: '/repo',
      knowledgeGateway: {
        async validate() {
          return false;
        },
        mintComprehension: (missing) => [refreshChild(`refresh-${missing[0]!.category}`)],
      },
      store,
      now: () => 3,
    });

    expect(result.refreshedCategories.has('architecture')).toBe(true);
    expect(result.refreshChildren.map((child) => child.localId)).toEqual(['refresh-architecture']);
    expect(await store.list({ type: 'knowledge-checked' })).toMatchObject([
      { goalId: 'goal-2', category: 'architecture', outcome: 'invalid' },
    ]);
  });
});
