import type { StepTranscript } from '../../contract/brain.js';
import type { EventStore } from '../../contract/events.js';
import type { Budget, Goal, Tier } from '../../contract/goal.js';
import type { Artifact, Report } from '../../contract/report.js';
import type { Verdict } from '../../contract/verdict.js';
import {
  stepLoopFailureArtifact,
  stepLoopFailureVerdict,
  type StepLoopResult,
} from '../step-loop-result.js';
import type { AttemptFailureResolution } from './failure.js';
import type { AttemptPrior, AttemptRetryState } from './state.js';

export type FailedStepLoopResult = Extract<StepLoopResult, { kind: 'exhausted' | 'failed' }>;

export interface StepLoopFailureContext {
  artifact: Artifact;
  verdict: Verdict;
  priorAttempt: AttemptPrior;
  budget: Budget;
  tier: Tier;
  tierIndex: number;
}

export type StepLoopFailureTransition =
  | { kind: 'blocked'; report: Report }
  | ({ kind: 'retry' } & AttemptRetryState);

export async function transitionStepLoopFailure(params: {
  goal: Goal;
  loopResult: FailedStepLoopResult;
  tier: Tier;
  tierIndex: number;
  tierLadder: Tier[];
  priorAttempt: AttemptPrior | undefined;
  store: EventStore;
  now: () => number;
  resolveFailure: (failure: StepLoopFailureContext) => Promise<AttemptFailureResolution>;
}): Promise<StepLoopFailureTransition> {
  if (params.loopResult.kind === 'exhausted') {
    await params.store.append({
      type: 'budget-exhausted',
      at: params.now(),
      goalId: params.goal.id,
      dimension: 'toolCalls',
    });
  }

  const artifact = stepLoopFailureArtifact(params.loopResult.transcript);
  const verdict = stepLoopFailureVerdict(params.loopResult);
  const transcriptAttempt = { artifact, verdict };
  const resolution = await params.resolveFailure({
    artifact,
    verdict,
    priorAttempt: params.priorAttempt ?? transcriptAttempt,
    budget: params.loopResult.budget,
    tier: params.tier,
    tierIndex: params.tierIndex,
  });

  if (resolution.kind === 'blocked') {
    return { kind: 'blocked', report: resolution.report };
  }

  return {
    kind: 'retry',
    budget: resolution.budget,
    tier: resolution.kind === 'escalated' ? resolution.tier : params.tier,
    tierIndex:
      resolution.kind === 'escalated'
        ? params.tierLadder.indexOf(resolution.tier)
        : params.tierIndex,
    priorAttempt: transcriptAttempt,
    priorLoopTranscript: params.loopResult.transcript,
  };
}
