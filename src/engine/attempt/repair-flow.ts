import type { Budget, Goal, Tier } from '../../contract/goal.js';
import type { Artifact, Report } from '../../contract/report.js';
import type { Verdict } from '../../contract/verdict.js';
import type { AttemptFailureResolution } from './failure.js';
import type { RecheckArtifactResult } from './recheck.js';

type RepairedResolution = Extract<AttemptFailureResolution, { kind: 'repaired' }>;

export type RepairedAttemptResult =
  | { kind: 'emitted'; report: Report }
  | { kind: 'ceiling' }
  | {
      kind: 'retry';
      budget: Budget;
      tier: Tier;
      priorAttempt: { artifact: Artifact; verdict: Verdict };
    };

export async function finishRepairedAttempt(params: {
  goal: Goal;
  repair: RepairedResolution;
  tier: Tier;
  recheck: (
    artifact: Artifact,
    budget: Budget,
    tier: Tier,
  ) => Promise<RecheckArtifactResult>;
  emitSuccess: (artifact: Artifact) => Promise<Report>;
}): Promise<RepairedAttemptResult> {
  const recheck = await params.recheck(
    params.repair.artifact,
    params.repair.budget,
    params.tier,
  );

  if (recheck.ceiling) {
    return { kind: 'ceiling' };
  }
  if (recheck.passed) {
    return {
      kind: 'emitted',
      report: await params.emitSuccess(params.repair.artifact),
    };
  }

  return {
    kind: 'retry',
    budget: recheck.budget,
    tier: recheck.tier,
    priorAttempt: {
      artifact: params.repair.artifact,
      verdict: recheck.verdict ?? missingRecheckVerdict(params.goal),
    },
  };
}

function missingRecheckVerdict(goal: Goal): Verdict {
  return {
    pass: false,
    findings: [{
      title: `Repair recheck for ${goal.type} failed without a verdict`,
      dimension: 'robustness',
      severity: 'high',
      gating: true,
    }],
    failureSignature: `repair-recheck-missing-verdict:${goal.type}`,
  };
}
