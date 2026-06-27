import { describe, expect, it } from 'vitest';
import { ZERO_USAGE } from '../../src/contract/goal.js';
import { recordStepOutput } from '../../src/engine/step-loop-step.js';
import { makeGoal, MemoryEventStore, textArtifact } from './stubs.js';

describe('step-loop step recording', () => {
  it('records a step, debits usage, and advances step/token counters', async () => {
    const store = new MemoryEventStore();
    let debited = false;

    const result = await recordStepOutput({
      goal: makeGoal(),
      output: {
        kind: 'artifact',
        artifact: textArtifact('done'),
        usage: { ...ZERO_USAGE, promptTokens: 3, completionTokens: 4 },
      },
      state: { stepIndex: 2, totalTokensUsed: 10 },
      store,
      now: () => 1,
      debitUsage: () => {
        debited = true;
      },
      hasReachedCeiling: () => false,
    });

    expect(result).toEqual({
      kind: 'recorded',
      state: { stepIndex: 3, totalTokensUsed: 17 },
    });
    expect(debited).toBe(true);
    expect(store.types()).toEqual(['step']);
  });

  it('returns ceiling before appending transport incidents when spend is exhausted', async () => {
    const store = new MemoryEventStore();

    const result = await recordStepOutput({
      goal: makeGoal(),
      output: {
        kind: 'artifact',
        artifact: textArtifact('done'),
        usage: ZERO_USAGE,
        incidents: [{
          kind: 'transport-retry',
          at: 2,
          detail: 'retry',
        }],
      },
      state: { stepIndex: 0, totalTokensUsed: 0 },
      store,
      now: () => 1,
      debitUsage: () => {},
      hasReachedCeiling: () => true,
    });

    expect(result.kind).toBe('ceiling');
    expect(store.types()).toEqual(['step']);
  });

  it('appends transport incidents after a non-ceiling step', async () => {
    const store = new MemoryEventStore();

    await recordStepOutput({
      goal: makeGoal(),
      output: {
        kind: 'tool-calls',
        calls: [],
        usage: ZERO_USAGE,
        incidents: [{
          kind: 'transport-retry',
          at: 3,
          detail: 'retry',
        }],
      },
      state: { stepIndex: 0, totalTokensUsed: 0 },
      store,
      now: () => 1,
      debitUsage: () => {},
      hasReachedCeiling: () => false,
    });

    expect(store.types()).toEqual(['step', 'transport-retry']);
  });
});
