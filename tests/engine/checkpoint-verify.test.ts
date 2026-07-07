import { describe, expect, it } from 'vitest';
import type { ChildPlan } from '../../src/contract/decision.js';
import type { KnowledgeArtifact } from '../../src/contract/knowledge.js';
import type { KnowledgeForCoverage } from '../../src/library/coverage.js';
import {
  createCheckpointShaMemo,
  verifyKnowledgeAtCheckpoint,
  type CheckpointVerifyGateway,
} from '../../src/engine/checkpoint-verify.js';
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

/** A gateway that counts query/headSha/validate calls, so a test can assert the
 *  fast path skipped the expensive query + self-validation. */
function countingGateway(overrides: {
  headSha: string;
  artifacts: KnowledgeForCoverage['artifacts'];
  validate?: (artifact: KnowledgeArtifact) => Promise<boolean>;
}): CheckpointVerifyGateway & { calls: { query: number; headSha: number; validate: number } } {
  const calls = { query: 0, headSha: 0, validate: 0 };
  return {
    calls,
    async query() {
      calls.query += 1;
      return { headSha: overrides.headSha, artifacts: overrides.artifacts, regionFacts: [] };
    },
    async headSha() {
      calls.headSha += 1;
      return overrides.headSha;
    },
    async validate(artifact) {
      calls.validate += 1;
      return overrides.validate ? overrides.validate(artifact) : true;
    },
    mintComprehension: () => [refreshChild('refresh-architecture')],
  };
}

describe('verifyKnowledgeAtCheckpoint', () => {
  it('short-circuits on an unchanged HEAD after the first verify — one head check, no re-query', async () => {
    const store = new MemoryEventStore();
    const shaMemo = createCheckpointShaMemo();
    const gateway = countingGateway({
      headSha: 'head',
      // A stale-but-still-valid artifact, so the first pass validates and memoizes.
      artifacts: [{ repoRoot: '/repo', category: 'architecture', generatedAtSha: 'old' }],
      validate: async () => true,
    });

    const first = await verifyKnowledgeAtCheckpoint({
      goal: makeGoal(),
      repoRoot: '/repo',
      knowledge: gateway,
      checkpoint: 'integrate',
      shaMemo,
      store,
      now: () => 1,
    });
    expect(first).toEqual({ refreshChildren: [], drifted: false });
    expect(gateway.calls).toEqual({ headSha: 1, query: 1, validate: 1 });

    // Second checkpoint at the same HEAD: the memo fast path skips query+validate.
    const second = await verifyKnowledgeAtCheckpoint({
      goal: makeGoal(),
      repoRoot: '/repo',
      knowledge: gateway,
      checkpoint: 'decide',
      shaMemo,
      store,
      now: () => 2,
    });
    expect(second).toEqual({ refreshChildren: [], drifted: false });
    expect(gateway.calls).toEqual({ headSha: 2, query: 1, validate: 1 });
  });

  it('reports drift and mints a refresh when a consumed fact fails self-validation', async () => {
    const store = new MemoryEventStore();
    const shaMemo = createCheckpointShaMemo();
    const gateway = countingGateway({
      headSha: 'head',
      artifacts: [{ repoRoot: '/repo', category: 'architecture', generatedAtSha: 'old' }],
      validate: async () => false,
    });

    const result = await verifyKnowledgeAtCheckpoint({
      goal: makeGoal({ id: 'g' }),
      repoRoot: '/repo',
      knowledge: gateway,
      checkpoint: 'integrate',
      shaMemo,
      store,
      now: () => 3,
    });

    expect(result.drifted).toBe(true);
    expect(result.refreshChildren.map((c) => c.localId)).toEqual(['refresh-architecture']);
    // A handled drift memoizes the reconciled HEAD, so a second checkpoint at the
    // same HEAD short-circuits instead of re-minting the same refresh (the refresh
    // it already spawned runs as a blocking dependency).
    expect(shaMemo.get('/repo')).toBe('head');
    expect(await store.list({ type: 'knowledge-checked' })).toMatchObject([
      { goalId: 'g', category: 'architecture', outcome: 'invalid', checkpoint: 'integrate' },
    ]);

    // Second checkpoint at the same HEAD is a memo fast-path no-op: no re-mint.
    const second = await verifyKnowledgeAtCheckpoint({
      goal: makeGoal({ id: 'g' }),
      repoRoot: '/repo',
      knowledge: gateway,
      checkpoint: 'integrate',
      shaMemo,
      store,
      now: () => 4,
    });
    expect(second).toEqual({ refreshChildren: [], drifted: false });
  });

  it('is a no-op for an empty repoRoot (no sandbox)', async () => {
    const store = new MemoryEventStore();
    const gateway = countingGateway({ headSha: 'head', artifacts: [] });
    const result = await verifyKnowledgeAtCheckpoint({
      goal: makeGoal(),
      repoRoot: '',
      knowledge: gateway,
      checkpoint: 'decide',
      shaMemo: createCheckpointShaMemo(),
      store,
      now: () => 4,
    });
    expect(result).toEqual({ refreshChildren: [], drifted: false });
    expect(gateway.calls).toEqual({ headSha: 0, query: 0, validate: 0 });
  });
});
