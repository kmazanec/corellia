import { describe, expect, it } from 'vitest';
import type { Brain } from '../../src/contract/brain.js';
import type { Decision } from '../../src/contract/decision.js';
import type { Goal, Usage } from '../../src/contract/goal.js';
import { ZERO_USAGE } from '../../src/contract/goal.js';
import type { Artifact } from '../../src/contract/report.js';
import type { Verdict } from '../../src/contract/verdict.js';
import { evaluateAttemptArtifact } from '../../src/engine/attempt/artifact-evaluation.js';
import { createAttemptLoopState } from '../../src/engine/attempt/state.js';
import {
  alwaysFailCheck,
  buildRegistry,
  leafTypeDef,
  makeGoal,
  MemoryEventStore,
  textArtifact,
} from './stubs.js';

describe('evaluateAttemptArtifact', () => {
  it('emits a successful artifact after gates pass', async () => {
    const store = new MemoryEventStore();
    const goal = makeGoal({ type: 'leaf' });
    const artifact = textArtifact('done');
    const persisted: Array<{ goal: Goal; artifact: Artifact }> = [];

    const result = await evaluateAttemptArtifact({
      goal,
      artifact,
      typeDef: leafTypeDef({ name: 'leaf', deterministic: [], judgeType: null }),
      state: createAttemptLoopState({ budget: goal.budget, tier: 'low', tierIndex: 0 }),
      tierLadder: ['low', 'mid', 'high'],
      entryRisk: 'low',
      stepLoopTailFinding: null,
      stepLoopTranscriptTail: undefined,
      tournamentRan: false,
      registry: buildRegistry([leafTypeDef({ name: 'leaf' })]),
      brain: throwingBrain(),
      store,
      now: () => 1,
      checkContext: undefined,
      sensitivity: [],
      onGate: undefined,
      onBrief: undefined,
      enforceToolCallBudget: false,
      goldenCapture: false,
      debitUsage: () => undefined,
      hasReachedCeiling: () => false,
      blockOnToolCallExhausted: async () => {
        throw new Error('blockOnToolCallExhausted should not be called');
      },
      resolveFailure: async () => {
        throw new Error('resolveFailure should not be called');
      },
      recheck: async () => {
        throw new Error('recheck should not be called');
      },
      persist: async (persistGoal, persistArtifact) => {
        persisted.push({ goal: persistGoal, artifact: persistArtifact });
      },
    });

    expect(result).toMatchObject({ kind: 'emitted', report: { artifact } });
    expect(persisted).toEqual([{ goal, artifact }]);
    expect(store.types()).toEqual(['emitted']);
  });

  it('returns retry state when a deterministic failure escalates tier', async () => {
    const store = new MemoryEventStore();
    const goal = makeGoal({ type: 'leaf' });
    const artifact = textArtifact('bad');

    const result = await evaluateAttemptArtifact({
      goal,
      artifact,
      typeDef: leafTypeDef({
        name: 'leaf',
        deterministic: [alwaysFailCheck('lint', 'bad formatting')],
        judgeType: null,
      }),
      state: createAttemptLoopState({ budget: goal.budget, tier: 'low', tierIndex: 0 }),
      tierLadder: ['low', 'mid', 'high'],
      entryRisk: 'low',
      stepLoopTailFinding: null,
      stepLoopTranscriptTail: undefined,
      tournamentRan: false,
      registry: buildRegistry([leafTypeDef({ name: 'leaf' })]),
      brain: throwingBrain(),
      store,
      now: () => 1,
      checkContext: undefined,
      sensitivity: [],
      onGate: undefined,
      onBrief: undefined,
      enforceToolCallBudget: false,
      goldenCapture: false,
      debitUsage: () => undefined,
      hasReachedCeiling: () => false,
      blockOnToolCallExhausted: async () => {
        throw new Error('blockOnToolCallExhausted should not be called');
      },
      resolveFailure: async (failure) => ({
        kind: 'escalated',
        tier: 'mid',
        budget: failure.budget,
      }),
      recheck: async () => {
        throw new Error('recheck should not be called');
      },
      persist: async () => {
        throw new Error('persist should not be called');
      },
    });

    expect(result).toMatchObject({
      kind: 'retry',
      state: {
        tier: 'mid',
        tierIndex: 1,
        priorAttempt: {
          artifact,
          verdict: {
            pass: false,
            failureSignature: 'deterministic:lint: bad formatting',
          },
        },
      },
    });
    expect(store.types()).toEqual(['deterministic-checked']);
  });
});

function throwingBrain(): Brain {
  return {
    async decide(): Promise<{ value: Decision; usage: Usage }> {
      throw new Error('throwingBrain.decide: not used');
    },
    async produce(): Promise<{ value: Artifact; usage: Usage }> {
      throw new Error('throwingBrain.produce: not used');
    },
    async judge(): Promise<{ value: Verdict; usage: Usage }> {
      throw new Error('throwingBrain.judge: not used');
    },
    async repair(): Promise<{ value: Artifact; usage: Usage }> {
      throw new Error('throwingBrain.repair: not used');
    },
    async step() {
      throw new Error('throwingBrain.step: not used');
    },
    async summarize() {
      return { value: '', usage: ZERO_USAGE };
    },
  };
}
