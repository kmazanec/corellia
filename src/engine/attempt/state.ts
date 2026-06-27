import type { BrainContext, StepTranscript } from '../../contract/brain.js';
import type { Budget, Goal, Tier } from '../../contract/goal.js';
import type { Artifact, Report } from '../../contract/report.js';
import type { Verdict } from '../../contract/verdict.js';

export type AttemptPrior = { artifact: Artifact | null; verdict: Verdict };

export interface AttemptRetryState {
  budget: Budget;
  tier: Tier;
  tierIndex: number;
  priorAttempt: AttemptPrior;
  priorLoopTranscript: StepTranscript | undefined;
}

export interface AttemptLoopState {
  budget: Budget;
  tier: Tier;
  tierIndex: number;
  priorAttempt: AttemptPrior | undefined;
  priorLoopTranscript: StepTranscript | undefined;
}

type ArtifactFailureLike =
  | { kind: 'ceiling' }
  | { kind: 'emitted'; report: Report }
  | { kind: 'blocked'; report: Report }
  | ({ kind: 'retry' } & AttemptRetryState);

type StepLoopFailureLike =
  | { kind: 'blocked'; report: Report }
  | ({ kind: 'retry' } & AttemptRetryState);

export type AttemptContinuation =
  | { kind: 'ceiling' }
  | { kind: 'return'; report: Report }
  | { kind: 'retry'; retry: AttemptRetryState };

export function createAttemptLoopState(params: {
  budget: Budget;
  tier: Tier;
  tierIndex: number;
}): AttemptLoopState {
  return {
    budget: params.budget,
    tier: params.tier,
    tierIndex: params.tierIndex,
    priorAttempt: undefined,
    priorLoopTranscript: undefined,
  };
}

export function attemptBrainContext(goal: Goal, state: AttemptLoopState): BrainContext {
  return state.priorAttempt === undefined
    ? { tier: state.tier, memories: goal.memories }
    : { tier: state.tier, memories: goal.memories, priorAttempt: state.priorAttempt };
}

export function withAttemptBudget(
  state: AttemptLoopState,
  budget: Budget,
): AttemptLoopState {
  return { ...state, budget };
}

export function withAttemptRetry(
  _state: AttemptLoopState,
  retry: AttemptRetryState,
): AttemptLoopState {
  return retryState(retry);
}

export function continueAfterArtifactFailure(
  failure: ArtifactFailureLike,
): AttemptContinuation {
  if (failure.kind === 'ceiling') return { kind: 'ceiling' };
  if (failure.kind === 'emitted' || failure.kind === 'blocked') {
    return { kind: 'return', report: failure.report };
  }
  return { kind: 'retry', retry: retryState(failure) };
}

export function continueAfterStepLoopFailure(
  failure: StepLoopFailureLike,
): Exclude<AttemptContinuation, { kind: 'ceiling' }> {
  if (failure.kind === 'blocked') {
    return { kind: 'return', report: failure.report };
  }
  return { kind: 'retry', retry: retryState(failure) };
}

function retryState(retry: AttemptRetryState): AttemptRetryState {
  return {
    budget: retry.budget,
    tier: retry.tier,
    tierIndex: retry.tierIndex,
    priorAttempt: retry.priorAttempt,
    priorLoopTranscript: retry.priorLoopTranscript,
  };
}
