import { describe, expect, it } from 'vitest';
import type { Brain } from '../../src/contract/brain.js';
import type { ChildPlan } from '../../src/contract/decision.js';
import type { Goal } from '../../src/contract/goal.js';
import { ZERO_USAGE } from '../../src/contract/goal.js';
import type { KnowledgeArtifact } from '../../src/contract/knowledge.js';
import type { Report } from '../../src/contract/report.js';
import type { CheckpointVerifyGateway } from '../../src/engine/checkpoint-verify.js';
import { createCheckpointShaMemo } from '../../src/engine/checkpoint-verify.js';
import { resolveDecisionPhase } from '../../src/engine/decision/phase.js';
import { runSplitRound } from '../../src/engine/split-round.js';
import type { KnowledgeForCoverage } from '../../src/library/coverage.js';
import {
  buildRegistry,
  makeGoal,
  MemoryEventStore,
  NoopMemoryView,
  nonLeafTypeDef,
  passVerdict,
  textArtifact,
} from './stubs.js';

const child = (overrides: Partial<ChildPlan> & Pick<ChildPlan, 'localId'>): ChildPlan => ({
  localId: overrides.localId,
  type: overrides.type ?? 'leaf',
  title: overrides.title ?? overrides.localId,
  spec: overrides.spec ?? {},
  dependsOn: overrides.dependsOn ?? [],
  scope: overrides.scope ?? [],
  budgetShare: overrides.budgetShare ?? 0.5,
});

const report = (overrides: Partial<Report> = {}): Report => ({
  artifact: textArtifact('child'),
  proof: [],
  lessons: [],
  memoriesUsed: [],
  blockers: [],
  findings: [],
  learned: '',
  ...overrides,
});

const refreshMapRepo = (localId: string): ChildPlan => ({
  localId,
  type: 'map-repo',
  title: localId,
  spec: {},
  dependsOn: [],
  scope: [],
  budgetShare: 0.1,
});

/**
 * A gateway whose one artifact drifted (SHA != HEAD) and fails self-validation,
 * so every checkpoint that queries it catches drift and mints a refresh child.
 */
function driftedGateway(): CheckpointVerifyGateway {
  return {
    async query(): Promise<KnowledgeForCoverage> {
      return {
        headSha: 'head',
        artifacts: [{ repoRoot: '/repo', category: 'architecture', generatedAtSha: 'old' }],
        regionFacts: [],
      };
    },
    async headSha() {
      return 'head';
    },
    async validate(_artifact: KnowledgeArtifact) {
      return false;
    },
    mintComprehension: () => [refreshMapRepo('refresh-architecture')],
  };
}

describe('integrate checkpoint drift', () => {
  it('refreshes the drifted fact BEFORE the integration judge renders its verdict', async () => {
    const store = new MemoryEventStore();
    const runOrder: string[] = [];
    let judgedAfter: string[] = [];

    // A judge that snapshots the run order at the moment it is asked to judge, so
    // we can prove the refresh child ran before the verdict was rendered.
    const brain: Brain = {
      async decide() {
        throw new Error('not expected');
      },
      async produce() {
        throw new Error('not expected');
      },
      async judge() {
        judgedAfter = [...runOrder];
        return { value: passVerdict(), usage: ZERO_USAGE };
      },
      async repair() {
        throw new Error('not expected');
      },
      async step() {
        throw new Error('not expected');
      },
    };

    await runSplitRound({
      goal: makeGoal({ id: 'root', type: 'splitter' }),
      children: [child({ localId: 'a' })],
      memory: new NoopMemoryView(),
      registry: buildRegistry([
        nonLeafTypeDef({ name: 'splitter' }),
        nonLeafTypeDef({ name: 'judge-integration' }),
        nonLeafTypeDef({ name: 'map-repo' }),
      ]),
      brain,
      goldenCapture: false,
      store,
      now: () => 1,
      activeRepoRoot: '/repo',
      worktree: undefined,
      factsForRegions: undefined,
      headSha: undefined,
      checkpointKnowledge: driftedGateway(),
      checkpointShaMemo: createCheckpointShaMemo(),
      regionScanner: undefined,
      checkContext: undefined,
      persist: async () => {},
      async runChild(childGoal: Goal) {
        runOrder.push(childGoal.id);
        return report();
      },
    });

    // The refresh child was spawned and run, and it ran before the judge saw the
    // integrated artifact — the verdict is rendered against refreshed knowledge,
    // not the stale fact.
    expect(runOrder).toContain('root/refresh-architecture');
    expect(judgedAfter).toContain('root/refresh-architecture');
    expect(await store.list({ type: 'knowledge-checked' })).toMatchObject([
      { goalId: 'root', category: 'architecture', outcome: 'invalid', checkpoint: 'integrate' },
    ]);
  });

  it('does not spawn a refresh when the checkpoint gateway is absent', async () => {
    const store = new MemoryEventStore();
    const runOrder: string[] = [];

    await runSplitRound({
      goal: makeGoal({ id: 'root', type: 'splitter' }),
      children: [child({ localId: 'a' })],
      memory: new NoopMemoryView(),
      registry: buildRegistry([nonLeafTypeDef({ name: 'splitter' })]),
      brain: {
        async decide() {
          throw new Error('not expected');
        },
        async produce() {
          throw new Error('not expected');
        },
        async judge() {
          throw new Error('not expected');
        },
        async repair() {
          throw new Error('not expected');
        },
        async step() {
          throw new Error('not expected');
        },
      },
      goldenCapture: false,
      store,
      now: () => 1,
      activeRepoRoot: '/repo',
      worktree: undefined,
      factsForRegions: undefined,
      headSha: undefined,
      // no checkpointKnowledge
      regionScanner: undefined,
      checkContext: undefined,
      persist: async () => {},
      async runChild(childGoal: Goal) {
        runOrder.push(childGoal.id);
        return report();
      },
    });

    expect(runOrder).toEqual(['root/a']);
    expect(await store.list({ type: 'knowledge-checked' })).toEqual([]);
  });
});

describe('decide checkpoint drift', () => {
  it('records the drift at the decide checkpoint before deriving the decision', async () => {
    const store = new MemoryEventStore();

    // A splitter whose decide returns a satisfy so no split gate runs — the decide
    // checkpoint is the only verify-on-read this decision gets.
    const brain: Brain = {
      async decide() {
        return { value: { kind: 'satisfy' }, usage: ZERO_USAGE };
      },
      async produce() {
        throw new Error('not expected');
      },
      async judge() {
        throw new Error('not expected');
      },
      async repair() {
        throw new Error('not expected');
      },
      async step() {
        throw new Error('not expected');
      },
    };

    const result = await resolveDecisionPhase({
      goal: makeGoal({ id: 'root', type: 'splitter' }),
      typeDef: nonLeafTypeDef({ name: 'splitter' }),
      tier: 'mid',
      registry: buildRegistry([
        nonLeafTypeDef({ name: 'splitter' }),
        nonLeafTypeDef({ name: 'map-repo' }),
      ]),
      brain,
      store,
      now: () => 1,
      patterns: undefined,
      goldenCapture: false,
      skillForGoalType: () => undefined,
      repoShapeForGoal: () => undefined,
      repoRoot: '/repo',
      checkpointKnowledge: driftedGateway(),
      checkpointShaMemo: createCheckpointShaMemo(),
      debitUsage: () => {},
      hasReachedCeiling: () => false,
    });

    expect(result.kind).toBe('ready');
    expect(await store.list({ type: 'knowledge-checked' })).toMatchObject([
      { goalId: 'root', category: 'architecture', outcome: 'invalid', checkpoint: 'decide' },
    ]);
  });
});
