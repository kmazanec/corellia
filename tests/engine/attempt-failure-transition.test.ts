import { describe, expect, it } from 'vitest';
import type { Budget } from '../../src/contract/goal.js';
import type { Artifact, Report } from '../../src/contract/report.js';
import type { Finding } from '../../src/contract/verdict.js';
import { transitionArtifactFailure } from '../../src/engine/attempt/failure-transition.js';
import type { RecheckArtifactResult } from '../../src/engine/attempt/recheck.js';
import {
  failVerdict,
  makeGoal,
  textArtifact,
} from './stubs.js';

const budget: Budget = {
  attempts: 1,
  tokens: 100,
  toolCalls: 5,
  wallClockMs: 1_000,
};

const artifact = textArtifact('artifact');

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

const transcriptFinding: Finding = {
  title: 'Step loop evidence',
  dimension: 'robustness',
  severity: 'medium',
  gating: false,
};

describe('attempt artifact failure transition', () => {
  it('returns retry state for escalation and carries step-loop transcript evidence', async () => {
    const verdict = failVerdict('judge failed');
    const nextBudget = { ...budget, tokens: 50 };

    const result = await transitionArtifactFailure({
      goal: makeGoal({ type: 'impl' }),
      artifact,
      verdict,
      budget,
      tier: 'low',
      tierIndex: 0,
      tierLadder: ['low', 'mid', 'high'],
      priorAttempt: undefined,
      stepLoopTailFinding: transcriptFinding,
      stepLoopTranscriptTail: [{ role: 'tool', content: 'read files' }],
      resolveFailure: async () => ({
        kind: 'escalated',
        tier: 'mid',
        budget: nextBudget,
      }),
      recheck: async () => {
        throw new Error('not expected');
      },
      emitSuccess: async () => {
        throw new Error('not expected');
      },
    });

    expect(result).toMatchObject({
      kind: 'retry',
      budget: nextBudget,
      tier: 'mid',
      tierIndex: 1,
      priorAttempt: {
        artifact,
        verdict: {
          findings: [transcriptFinding, ...verdict.findings],
        },
      },
      priorLoopTranscript: [{ role: 'tool', content: 'read files' }],
    });
  });

  it('runs repaired attempts through recheck and returns retry when repair fails', async () => {
    const repairedArtifact = textArtifact('fixed?');
    const recheckVerdict = failVerdict('still failing');

    const result = await transitionArtifactFailure({
      goal: makeGoal({ type: 'impl' }),
      artifact,
      verdict: failVerdict('original failure'),
      budget,
      tier: 'mid',
      tierIndex: 1,
      tierLadder: ['low', 'mid', 'high'],
      priorAttempt: undefined,
      stepLoopTailFinding: null,
      stepLoopTranscriptTail: undefined,
      resolveFailure: async () => ({
        kind: 'repaired',
        artifact: repairedArtifact,
        budget,
      }),
      recheck: async (): Promise<RecheckArtifactResult> => ({
        passed: false,
        budget,
        verdict: recheckVerdict,
        tier: 'high',
      }),
      emitSuccess: async () => {
        throw new Error('not expected');
      },
    });

    expect(result).toEqual({
      kind: 'retry',
      budget,
      tier: 'high',
      tierIndex: 2,
      priorAttempt: {
        artifact: repairedArtifact,
        verdict: recheckVerdict,
      },
      priorLoopTranscript: undefined,
    });
  });

  it('returns emitted reports from successful repaired attempts', async () => {
    const repairedArtifact = textArtifact('fixed');

    const result = await transitionArtifactFailure({
      goal: makeGoal({ type: 'impl' }),
      artifact,
      verdict: failVerdict('original failure'),
      budget,
      tier: 'mid',
      tierIndex: 1,
      tierLadder: ['low', 'mid', 'high'],
      priorAttempt: undefined,
      stepLoopTailFinding: null,
      stepLoopTranscriptTail: undefined,
      resolveFailure: async () => ({
        kind: 'repaired',
        artifact: repairedArtifact,
        budget,
      }),
      recheck: async () => ({
        passed: true,
        budget,
        verdict: null,
        tier: 'mid',
      }),
      emitSuccess: async (successArtifact) => report(successArtifact),
    });

    expect(result).toEqual({
      kind: 'emitted',
      report: report(repairedArtifact),
    });
  });

  it('passes blocked reports through unchanged', async () => {
    const blocked = report(null);

    const result = await transitionArtifactFailure({
      goal: makeGoal({ type: 'impl' }),
      artifact,
      verdict: failVerdict('original failure'),
      budget,
      tier: 'mid',
      tierIndex: 1,
      tierLadder: ['low', 'mid', 'high'],
      priorAttempt: undefined,
      stepLoopTailFinding: null,
      stepLoopTranscriptTail: undefined,
      resolveFailure: async () => ({ kind: 'blocked', report: blocked }),
      recheck: async () => {
        throw new Error('not expected');
      },
      emitSuccess: async () => {
        throw new Error('not expected');
      },
    });

    expect(result).toEqual({ kind: 'blocked', report: blocked });
  });
});
