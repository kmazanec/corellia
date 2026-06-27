import { describe, expect, it } from 'vitest';
import type { Budget } from '../../src/contract/goal.js';
import type { Artifact, Report } from '../../src/contract/report.js';
import { finishRepairedAttempt } from '../../src/engine/attempt/repair-flow.js';
import type { RecheckArtifactResult } from '../../src/engine/attempt/recheck.js';
import {
  failVerdict,
  makeGoal,
  passVerdict,
  textArtifact,
} from './stubs.js';

const budget: Budget = {
  attempts: 1,
  tokens: 100,
  toolCalls: 5,
  wallClockMs: 1_000,
};

function report(artifact: Artifact): Report {
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

describe('attempt repair flow', () => {
  it('emits the repaired artifact when recheck passes', async () => {
    const artifact = textArtifact('fixed');
    const calls: string[] = [];

    const result = await finishRepairedAttempt({
      goal: makeGoal({ type: 'impl' }),
      repair: { kind: 'repaired', artifact, budget },
      tier: 'mid',
      recheck: async (): Promise<RecheckArtifactResult> => {
        calls.push('recheck');
        return { passed: true, budget, verdict: null, tier: 'mid' };
      },
      emitSuccess: async (successArtifact) => {
        calls.push(`emit:${successArtifact.text}`);
        return report(successArtifact);
      },
    });

    expect(calls).toEqual(['recheck', 'emit:fixed']);
    expect(result).toEqual({ kind: 'emitted', report: report(artifact) });
  });

  it('surfaces ceiling without emitting when recheck trips the spend guard', async () => {
    let emitted = false;

    const result = await finishRepairedAttempt({
      goal: makeGoal({ type: 'impl' }),
      repair: { kind: 'repaired', artifact: textArtifact('fixed'), budget },
      tier: 'low',
      recheck: async () => ({
        passed: false,
        budget,
        verdict: null,
        tier: 'low',
        ceiling: true,
      }),
      emitSuccess: async (artifact) => {
        emitted = true;
        return report(artifact);
      },
    });

    expect(result).toEqual({ kind: 'ceiling' });
    expect(emitted).toBe(false);
  });

  it('returns retry state with the recheck verdict when repair does not hold', async () => {
    const artifact = textArtifact('still broken');
    const recheckVerdict = failVerdict('still failing');
    const nextBudget = { ...budget, tokens: 50 };

    const result = await finishRepairedAttempt({
      goal: makeGoal({ type: 'impl' }),
      repair: { kind: 'repaired', artifact, budget },
      tier: 'mid',
      recheck: async () => ({
        passed: false,
        budget: nextBudget,
        verdict: recheckVerdict,
        tier: 'high',
      }),
      emitSuccess: async () => {
        throw new Error('not expected');
      },
    });

    expect(result).toEqual({
      kind: 'retry',
      budget: nextBudget,
      tier: 'high',
      priorAttempt: { artifact, verdict: recheckVerdict },
    });
  });

  it('creates a defensive verdict if an impossible failed recheck lacks one', async () => {
    const result = await finishRepairedAttempt({
      goal: makeGoal({ type: 'impl' }),
      repair: { kind: 'repaired', artifact: textArtifact('unknown'), budget },
      tier: 'mid',
      recheck: async () => ({
        passed: false,
        budget,
        verdict: null,
        tier: 'mid',
      }),
      emitSuccess: async () => {
        throw new Error('not expected');
      },
    });

    expect(result.kind).toBe('retry');
    expect(result.kind === 'retry' ? result.priorAttempt.verdict : passVerdict()).toMatchObject({
      pass: false,
      failureSignature: 'repair-recheck-missing-verdict:impl',
    });
  });
});
