import { describe, expect, it } from 'vitest';
import type { StepTranscript } from '../../src/contract/brain.js';
import type { Budget, Tier } from '../../src/contract/goal.js';
import type { Artifact, Report } from '../../src/contract/report.js';
import type { Verdict } from '../../src/contract/verdict.js';
import {
  transitionStepLoopFailure,
  type StepLoopFailureContext,
} from '../../src/engine/attempt/step-loop-failure.js';
import {
  failVerdict,
  makeGoal,
  MemoryEventStore,
  textArtifact,
} from './stubs.js';

const budget: Budget = {
  attempts: 1,
  tokens: 100,
  toolCalls: 5,
  wallClockMs: 1_000,
};

const transcript: StepTranscript = [
  { role: 'context', content: 'start' },
  { role: 'tool', callId: 'c1', content: 'result' },
];

function report(artifact: Artifact | null = null): Report {
  return {
    artifact,
    proof: [],
    lessons: [],
    memoriesUsed: [],
    blockers: [],
    findings: [],
    learned: '',
  };
}

describe('attempt step-loop failure transition', () => {
  it('logs exhausted tool calls and retries from synthesized transcript evidence', async () => {
    const store = new MemoryEventStore();
    let resolved: StepLoopFailureContext | null = null;

    const result = await transitionStepLoopFailure({
      goal: makeGoal({ id: 'g-step' }),
      loopResult: { kind: 'exhausted', budget, transcript },
      tier: 'low',
      tierIndex: 0,
      tierLadder: ['low', 'mid', 'high'],
      priorAttempt: undefined,
      store,
      now: () => 123,
      resolveFailure: async (failure) => {
        resolved = failure;
        return { kind: 'repaired', artifact: textArtifact('ignored repair'), budget };
      },
    });

    expect(await store.list({ type: 'budget-exhausted' })).toEqual([
      {
        type: 'budget-exhausted',
        at: 123,
        goalId: 'g-step',
        dimension: 'toolCalls',
      },
    ]);
    expect(resolved).toMatchObject({
      artifact: { kind: 'text', text: JSON.stringify(transcript) },
      verdict: {
        pass: false,
        failureSignature: 'step-loop:exhausted',
      },
      priorAttempt: {
        artifact: { kind: 'text', text: JSON.stringify(transcript) },
        verdict: { failureSignature: 'step-loop:exhausted' },
      },
      budget,
      tier: 'low',
      tierIndex: 0,
    });
    expect(result).toMatchObject({
      kind: 'retry',
      budget,
      tier: 'low',
      tierIndex: 0,
      priorAttempt: {
        artifact: { kind: 'text', text: JSON.stringify(transcript) },
        verdict: { failureSignature: 'step-loop:exhausted' },
      },
      priorLoopTranscript: transcript,
    });
  });

  it('uses an existing prior attempt for isomorphic comparison but stores current transcript evidence for retry', async () => {
    const store = new MemoryEventStore();
    const priorAttempt = {
      artifact: textArtifact('previous artifact'),
      verdict: failVerdict('previous failure', undefined, undefined, 'previous:signature'),
    };
    let resolvedPrior: { artifact: Artifact | null; verdict: Verdict } | null = null;

    const result = await transitionStepLoopFailure({
      goal: makeGoal(),
      loopResult: {
        kind: 'failed',
        error: 'bad json',
        failKind: 'malformed',
        budget,
        transcript,
      },
      tier: 'low',
      tierIndex: 0,
      tierLadder: ['low', 'mid', 'high'],
      priorAttempt,
      store,
      now: () => 123,
      resolveFailure: async (failure) => {
        resolvedPrior = failure.priorAttempt;
        return { kind: 'escalated', tier: 'mid', budget: { ...budget, tokens: 80 } };
      },
    });

    expect(await store.list({ type: 'budget-exhausted' })).toEqual([]);
    expect(resolvedPrior).toBe(priorAttempt);
    expect(result).toMatchObject({
      kind: 'retry',
      budget: { ...budget, tokens: 80 },
      tier: 'mid',
      tierIndex: 1,
      priorAttempt: {
        artifact: { kind: 'text', text: JSON.stringify(transcript) },
        verdict: { failureSignature: 'step-loop:malformed' },
      },
      priorLoopTranscript: transcript,
    });
  });

  it('passes blocked reports through unchanged', async () => {
    const store = new MemoryEventStore();
    const blocked = report(textArtifact('blocked'));

    const result = await transitionStepLoopFailure({
      goal: makeGoal(),
      loopResult: {
        kind: 'failed',
        error: 'transport timeout',
        failKind: 'transport',
        budget,
        transcript,
      },
      tier: 'mid',
      tierIndex: 1,
      tierLadder: ['low', 'mid', 'high'],
      priorAttempt: undefined,
      store,
      now: () => 123,
      resolveFailure: async () => ({ kind: 'blocked', report: blocked }),
    });

    expect(result).toEqual({ kind: 'blocked', report: blocked });
  });

  it('computes escalated retry tier indexes from the tier ladder', async () => {
    const store = new MemoryEventStore();
    const tiers: Tier[] = ['low', 'mid', 'high'];

    const result = await transitionStepLoopFailure({
      goal: makeGoal(),
      loopResult: { kind: 'exhausted', budget, transcript },
      tier: 'mid',
      tierIndex: 1,
      tierLadder: tiers,
      priorAttempt: undefined,
      store,
      now: () => 123,
      resolveFailure: async () => ({ kind: 'escalated', tier: 'high', budget }),
    });

    expect(result).toMatchObject({
      kind: 'retry',
      tier: 'high',
      tierIndex: 2,
    });
  });
});
