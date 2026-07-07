import type { ChildPlan } from '../../contract/decision.js';
import type { Artifact, Report } from '../../contract/report.js';
import type { Verdict } from '../../contract/verdict.js';

export type MilestoneOutcome =
  | 'done'
  | 'continue'
  | 'halt-no-progress'
  | 'halt-max-rounds'
  | 'halt-ceiling'
  | 'halt-deadline';

export interface MilestoneOutcomeAssessment {
  passingCount: number;
  criteriaTotal: number;
  judgeVerdict: Pick<Verdict, 'pass'>;
}

export function decideMilestoneOutcome(params: {
  assessment: MilestoneOutcomeAssessment;
  priorPassingCount: number;
  flatRounds: number;
  roundIndex: number;
  effectiveMaxRounds: number;
}): { outcome: Exclude<MilestoneOutcome, 'halt-ceiling'>; flatRounds: number } {
  const strictIncrease = params.assessment.passingCount > params.priorPassingCount;
  const flatRounds = strictIncrease ? 0 : params.flatRounds + 1;

  if (isMilestoneDone(params.assessment)) {
    return { outcome: 'done', flatRounds };
  }
  if (flatRounds >= 2) {
    return { outcome: 'halt-no-progress', flatRounds };
  }
  if (params.roundIndex + 1 >= params.effectiveMaxRounds) {
    return { outcome: 'halt-max-rounds', flatRounds };
  }
  return { outcome: 'continue', flatRounds };
}

export function extractCriteriaArtifact(
  childOutcomes: { plan: ChildPlan; report: Report }[],
): Artifact | null {
  const criteriaChild = childOutcomes.find(
    (candidate) => candidate.plan.type === 'author-acceptance-criteria',
  );
  return criteriaChild?.report.artifact ?? null;
}

export function withUnmetAcceptanceBlockers(
  report: Report,
  assessment: {
    passingCount: number;
    criteriaTotal: number;
    judgeVerdict: Verdict;
    checkResults: { id: string; ok: boolean; detail: string }[];
  },
): Report {
  const unmet = assessment.checkResults.filter((result) => !result.ok);
  const blockers = [...report.blockers];
  if (unmet.length > 0) {
    blockers.push(
      `Acceptance criteria not yet met (${assessment.passingCount}/${assessment.criteriaTotal}): ` +
        unmet.map((result) => `${result.id} (${result.detail})`).join('; '),
    );
  }
  if (!assessment.judgeVerdict.pass) {
    blockers.push(
      `judge-acceptance did not pass: ${assessment.judgeVerdict.findings.map((finding) => finding.title).join(', ') || 'no shippable verdict'}`,
    );
  }
  return { ...report, blockers };
}

function isMilestoneDone(assessment: MilestoneOutcomeAssessment): boolean {
  return (
    assessment.criteriaTotal > 0 &&
    assessment.passingCount === assessment.criteriaTotal &&
    assessment.judgeVerdict.pass
  );
}
