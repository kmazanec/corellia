import { describe, expect, it } from 'vitest';
import type { Budget } from '../../src/contract/goal.js';
import type { Report } from '../../src/contract/report.js';
import {
  attemptBrainContext,
  continueAfterArtifactFailure,
  continueAfterStepLoopFailure,
  createAttemptLoopState,
  type AttemptRetryState,
  withAttemptBudget,
  withAttemptRetry,
} from '../../src/engine/attempt/state.js';
import { failVerdict, makeGoal, textArtifact } from './stubs.js';

const budget: Budget = {
  attempts: 1,
  tokens: 10,
  toolCalls: 2,
  wallClockMs: 100,
};

const retry: AttemptRetryState = {
  budget,
  tier: 'mid',
  tierIndex: 1,
  priorAttempt: {
    artifact: textArtifact('failed'),
    verdict: failVerdict('failed'),
  },
  priorLoopTranscript: [{ role: 'context', content: 'prior evidence' }],
};

function report(): Report {
  return {
    artifact: null,
    proof: [],
    lessons: [],
    memoriesUsed: [],
    blockers: [],
    findings: [],
    learned: '',
  };
}

describe('attempt continuation state', () => {
  it('builds brain context from the current attempt state', () => {
    const goal = makeGoal({ memories: [{ id: 'm1', topic: 'topic', scope: [], provenance: 'trusted' }] });
    const initial = createAttemptLoopState({ budget, tier: 'low', tierIndex: 0 });
    const retried = withAttemptRetry(initial, retry);

    expect(attemptBrainContext(goal, initial)).toEqual({
      tier: 'low',
      memories: goal.memories,
    });
    expect(attemptBrainContext(goal, retried)).toEqual({
      tier: 'mid',
      memories: goal.memories,
      priorAttempt: retry.priorAttempt,
    });
  });

  it('updates budget without disturbing retry evidence', () => {
    const initial = createAttemptLoopState({ budget, tier: 'low', tierIndex: 0 });
    const retried = withAttemptRetry(initial, retry);
    const nextBudget = { ...budget, tokens: 5 };

    expect(withAttemptBudget(retried, nextBudget)).toEqual({
      ...retried,
      budget: nextBudget,
    });
  });

  it('normalizes artifact failure terminal transitions', () => {
    const emitted = report();
    const blocked = report();

    expect(continueAfterArtifactFailure({ kind: 'ceiling' })).toEqual({ kind: 'ceiling' });
    expect(continueAfterArtifactFailure({ kind: 'emitted', report: emitted })).toEqual({
      kind: 'return',
      report: emitted,
    });
    expect(continueAfterArtifactFailure({ kind: 'blocked', report: blocked })).toEqual({
      kind: 'return',
      report: blocked,
    });
  });

  it('normalizes artifact failure retry transitions into retry state', () => {
    expect(continueAfterArtifactFailure({ kind: 'retry', ...retry })).toEqual({
      kind: 'retry',
      retry,
    });
  });

  it('normalizes step-loop failure transitions without a ceiling branch', () => {
    const blocked = report();

    expect(continueAfterStepLoopFailure({ kind: 'blocked', report: blocked })).toEqual({
      kind: 'return',
      report: blocked,
    });
    expect(continueAfterStepLoopFailure({ kind: 'retry', ...retry })).toEqual({
      kind: 'retry',
      retry,
    });
  });
});
