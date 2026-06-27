import type { StepTranscript } from '../../contract/brain.js';
import type { Budget, Goal, Tier } from '../../contract/goal.js';
import type { Artifact, Report } from '../../contract/report.js';
import type { Finding, Verdict } from '../../contract/verdict.js';
import type { AttemptFailureResolution } from './failure.js';
import { finishRepairedAttempt } from './repair-flow.js';
import type { RecheckArtifactResult } from './recheck.js';
import type { AttemptPrior, AttemptRetryState } from './state.js';

export type ArtifactFailureTransition =
  | { kind: 'emitted'; report: Report }
  | { kind: 'ceiling' }
  | { kind: 'blocked'; report: Report }
  | ({ kind: 'retry' } & AttemptRetryState);

export async function transitionArtifactFailure(params: {
  goal: Goal;
  artifact: Artifact;
  verdict: Verdict;
  budget: Budget;
  tier: Tier;
  tierIndex: number;
  tierLadder: Tier[];
  priorAttempt: AttemptPrior | undefined;
  stepLoopTailFinding: Finding | null;
  stepLoopTranscriptTail: StepTranscript | undefined;
  resolveFailure: () => Promise<AttemptFailureResolution>;
  recheck: (
    artifact: Artifact,
    budget: Budget,
    tier: Tier,
  ) => Promise<RecheckArtifactResult>;
  emitSuccess: (artifact: Artifact) => Promise<Report>;
}): Promise<ArtifactFailureTransition> {
  const resolution = await params.resolveFailure();

  if (resolution.kind === 'repaired') {
    const repaired = await finishRepairedAttempt({
      goal: params.goal,
      repair: resolution,
      tier: params.tier,
      recheck: params.recheck,
      emitSuccess: params.emitSuccess,
    });
    if (repaired.kind === 'ceiling') return { kind: 'ceiling' };
    if (repaired.kind === 'emitted') return repaired;

    return {
      kind: 'retry',
      budget: repaired.budget,
      tier: repaired.tier,
      tierIndex: tierIndexFor(params.tierLadder, repaired.tier),
      priorAttempt: repaired.priorAttempt,
      priorLoopTranscript: params.stepLoopTranscriptTail,
    };
  }

  if (resolution.kind === 'escalated') {
    return {
      kind: 'retry',
      tier: resolution.tier,
      tierIndex: tierIndexFor(params.tierLadder, resolution.tier),
      budget: resolution.budget,
      priorAttempt: {
        artifact: params.artifact,
        verdict: verdictWithStepLoopFinding(
          params.verdict,
          params.stepLoopTailFinding,
        ),
      },
      priorLoopTranscript: params.stepLoopTranscriptTail,
    };
  }

  return { kind: 'blocked', report: resolution.report };
}

function verdictWithStepLoopFinding(
  verdict: Verdict,
  stepLoopTailFinding: Finding | null,
): Verdict {
  return stepLoopTailFinding === null
    ? verdict
    : { ...verdict, findings: [stepLoopTailFinding, ...verdict.findings] };
}

function tierIndexFor(tierLadder: Tier[], tier: Tier): number {
  return tierLadder.indexOf(tier);
}
