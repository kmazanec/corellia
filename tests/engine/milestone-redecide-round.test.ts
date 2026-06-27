import { describe, expect, it } from 'vitest';
import type { Brain, BrainContext } from '../../src/contract/brain.js';
import type { Decision } from '../../src/contract/decision.js';
import { ZERO_USAGE } from '../../src/contract/goal.js';
import { reDecideMilestoneRound } from '../../src/engine/milestone/redecide-round.js';
import type { RoundAssessment } from '../../src/engine/milestone/round-assessment.js';
import {
  buildRegistry,
  leafTypeDef,
  makeGoal,
  MemoryEventStore,
  passVerdict,
} from './stubs.js';

const child = {
  localId: 'fix',
  type: 'build',
  title: 'fix',
  spec: {},
  dependsOn: [],
  scope: ['src/'],
  budgetShare: 0.5,
};

function registry() {
  return buildRegistry([
    leafTypeDef({
      name: 'deliver-intent',
      leafOnly: false,
      tier: { default: 'mid', ladder: ['mid'] },
    }),
    leafTypeDef({ name: 'build' }),
  ]);
}

function assessment(): RoundAssessment {
  return {
    passingCount: 0,
    criteriaTotal: 1,
    judgeVerdict: passVerdict(),
    criteria: [],
    checkResults: [{ id: 'c1', ok: false, detail: 'missing DONE' }],
    diffDigest: ['unmet:c1'],
  };
}

function decidingBrain(decision: Decision, seen: BrainContext[]): Brain {
  return {
    async decide(_goal, ctx) {
      seen.push(ctx);
      return { value: decision, usage: ZERO_USAGE };
    },
    async produce() { throw new Error('not used'); },
    async judge() { throw new Error('not used'); },
    async repair() { throw new Error('not used'); },
    async step() { throw new Error('not used'); },
  };
}

describe('milestone round re-decision', () => {
  it('returns validated split children and logs the decision', async () => {
    const store = new MemoryEventStore();
    const contexts: BrainContext[] = [];

    const result = await reDecideMilestoneRound({
      goal: makeGoal({ type: 'deliver-intent', scope: ['src/'] }),
      priorAssessment: assessment(),
      priorRoundRef: null,
      worktreeRoot: undefined,
      registry: registry(),
      brain: decidingBrain({ kind: 'split', children: [child] }, contexts),
      store,
      now: () => 1,
      decideSkill: 'skill text',
      tier: 'mid',
      debitUsage: () => {},
    });

    expect(result).toEqual({ children: [child] });
    expect(store.types()).toEqual(['decided']);
    expect(contexts[0]).toMatchObject({
      tier: 'mid',
      skill: 'skill text',
      priorAttempt: {
        artifact: null,
        verdict: {
          pass: false,
          findings: [{ title: 'Unmet criterion c1', prescription: 'missing DONE' }],
        },
      },
    });
  });

  it('halts when the brain does not return a split', async () => {
    const result = await reDecideMilestoneRound({
      goal: makeGoal({ type: 'deliver-intent' }),
      priorAssessment: assessment(),
      priorRoundRef: null,
      worktreeRoot: undefined,
      registry: registry(),
      brain: decidingBrain({ kind: 'block', brief: { question: 'no', options: ['deny'], links: [], deadlineMs: 1, onTimeout: 'deny' } }, []),
      store: new MemoryEventStore(),
      now: () => 2,
      decideSkill: undefined,
      tier: 'mid',
      debitUsage: () => {},
    });

    expect(result).toEqual({ halt: true });
  });

  it('halts when split validation rejects the children', async () => {
    const result = await reDecideMilestoneRound({
      goal: makeGoal({ type: 'deliver-intent' }),
      priorAssessment: assessment(),
      priorRoundRef: null,
      worktreeRoot: undefined,
      registry: registry(),
      brain: decidingBrain({ kind: 'split', children: [] }, []),
      store: new MemoryEventStore(),
      now: () => 3,
      decideSkill: undefined,
      tier: 'mid',
      debitUsage: () => {},
    });

    expect(result).toEqual({ halt: true });
  });
});
