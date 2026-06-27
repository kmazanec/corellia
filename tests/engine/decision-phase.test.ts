import { describe, expect, it } from 'vitest';
import type { BrainContext } from '../../src/contract/brain.js';
import type { ChildPlan, Decision } from '../../src/contract/decision.js';
import type { Goal, Usage } from '../../src/contract/goal.js';
import { ZERO_USAGE } from '../../src/contract/goal.js';
import type { Artifact } from '../../src/contract/report.js';
import type { Verdict } from '../../src/contract/verdict.js';
import { resolveDecisionPhase } from '../../src/engine/decision/phase.js';
import { InMemoryPatternStore } from '../../src/substrate/memory-pattern-store.js';
import {
  buildRegistry,
  leafTypeDef,
  makeGoal,
  MemoryEventStore,
  nonLeafTypeDef,
  rawBrain,
  textArtifact,
} from './stubs.js';
import type { RawBrain } from './stubs.js';

describe('resolveDecisionPhase', () => {
  it('walks a trusted split memo without calling brain.decide', async () => {
    const store = new MemoryEventStore();
    const patterns = new InMemoryPatternStore();
    const goal = makeGoal({ id: 'root', type: 'splitter', title: 'test goal', spec: {} });
    const splitDecision = { kind: 'split' as const, children: oneChildSplit() };
    await patterns.record('splitter|{}|goal test', splitDecision, 'success');
    await patterns.promote('splitter|{}|goal test', 'trusted');

    const result = await resolveDecisionPhase({
      goal,
      typeDef: nonLeafTypeDef({ name: 'splitter' }),
      tier: 'low',
      registry: buildRegistry([
        nonLeafTypeDef({ name: 'splitter' }),
        leafTypeDef({ name: 'leaf' }),
      ]),
      brain: rawBrain(throwingDecideBrain()),
      store,
      now: () => 1,
      patterns,
      goldenCapture: false,
      skillForGoalType: () => undefined,
      repoShapeForGoal: () => undefined,
      debitUsage: () => undefined,
      hasReachedCeiling: () => false,
    });

    expect(result).toMatchObject({
      kind: 'ready',
      decision: splitDecision,
      decideUsage: undefined,
      terracedLoserFindings: [],
      goalShape: 'splitter|{}|goal test',
    });
    expect(await store.list({ type: 'pattern-consulted' })).toEqual([
      expect.objectContaining({ shape: 'splitter|{}|goal test', status: 'trusted' }),
    ]);
  });

  it('records then coerces a comprehend pre-tool block into satisfy', async () => {
    const store = new MemoryEventStore();
    const debits: Usage[] = [];
    const goal = makeGoal({ id: 'root', type: 'map-repo', title: 'map repo', spec: {} });

    const result = await resolveDecisionPhase({
      goal,
      typeDef: nonLeafTypeDef({ name: 'map-repo', family: 'comprehend' }),
      tier: 'low',
      registry: buildRegistry([nonLeafTypeDef({ name: 'map-repo', family: 'comprehend' })]),
      brain: rawBrain(decideBrain(blockDecision())),
      store,
      now: () => 1,
      patterns: undefined,
      goldenCapture: false,
      skillForGoalType: () => undefined,
      repoShapeForGoal: () => undefined,
      debitUsage: (usage) => debits.push(usage),
      hasReachedCeiling: () => false,
    });

    expect(result).toMatchObject({
      kind: 'ready',
      decision: { kind: 'satisfy' },
      decideUsage: ZERO_USAGE,
      goalShape: 'map-repo|{}|map repo',
    });
    expect(debits).toEqual([ZERO_USAGE]);
    expect(await store.list({ type: 'decided' })).toEqual([
      expect.objectContaining({ decision: expect.objectContaining({ kind: 'block' }) }),
    ]);
  });
});

function oneChildSplit(): ChildPlan[] {
  return [
    {
      localId: 'leaf',
      type: 'leaf',
      title: 'leaf',
      spec: {},
      dependsOn: [],
      scope: [],
      budgetShare: 1,
    },
  ];
}

function throwingDecideBrain(): RawBrain {
  return decideBrain(() => {
    throw new Error('brain.decide must not be called for a trusted memo');
  });
}

function decideBrain(decide: Decision | (() => Decision)): RawBrain {
  return {
    async decide(_goal: Goal, _ctx: BrainContext) {
      return typeof decide === 'function' ? decide() : decide;
    },
    async produce(): Promise<Artifact> {
      return textArtifact('not used');
    },
    async judge(): Promise<Verdict> {
      return { pass: true, findings: [] };
    },
    async repair(): Promise<Artifact> {
      return textArtifact('not used');
    },
  };
}

function blockDecision(): Decision {
  return {
    kind: 'block',
    brief: {
      question: 'need info?',
      options: ['deny'],
      links: [],
      deadlineMs: 1,
      onTimeout: 'deny',
    },
  };
}
