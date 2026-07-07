import type { ChildPlan } from '../../contract/decision.js';
import type { EventStore } from '../../contract/events.js';
import type { Goal } from '../../contract/goal.js';
import type { Artifact, Report } from '../../contract/report.js';
import { blockedReport } from '../reports.js';
import {
  hasReachedSpendCeiling,
  hasReachedTreeDeadline,
  type TreeState,
} from '../tree-spend.js';
import {
  decideMilestoneOutcome,
  extractCriteriaArtifact,
  withUnmetAcceptanceBlockers,
  type MilestoneOutcome,
} from './outcome.js';
import type { RoundAssessment } from './round-assessment.js';
import type { RoundReDecision } from './redecide-round.js';

export interface MilestoneRoundResult {
  report: Report;
  mergedArtifact: Artifact | null;
  childOutcomes: { plan: ChildPlan; report: Report }[];
}

export async function runMilestoneLoop(params: {
  goal: Goal;
  initialChildren: ChildPlan[];
  effectiveMaxRounds: number;
  treeState: TreeState;
  store: EventStore;
  now: () => number;
  runRound: (children: ChildPlan[]) => Promise<MilestoneRoundResult>;
  reDecideRound: (
    priorAssessment: RoundAssessment,
    priorRoundRef: string | null,
  ) => Promise<RoundReDecision>;
  persistCriteria: (artifact: Artifact) => Promise<void>;
  commitRound: (roundIndex: number) => string | null;
  assessRound: (
    criteriaArtifact: Artifact | null,
    mergedArtifact: Artifact | null,
  ) => Promise<RoundAssessment>;
  ceilingReachedOnce: () => Promise<void>;
  ceilingReport: () => Promise<Report>;
}): Promise<Report> {
  let criteriaArtifact: Artifact | null = null;
  let roundReport: Report = blockedReport('milestone loop produced no round');
  let lastAssessment: RoundAssessment | null = null;
  let priorPassingCount = -1;
  let flatRounds = 0;
  let priorRoundRef: string | null = null;
  let roundChildren = params.initialChildren;

  let roundIndex = 0;
  let outcome: MilestoneOutcome = 'continue';

  while (true) {
    if (hasReachedSpendCeiling(params.treeState)) {
      if (lastAssessment === null) {
        return params.ceilingReport();
      }
      await params.ceilingReachedOnce();
      outcome = 'halt-ceiling';
      await appendRoundAssessed(params, roundIndex, lastAssessment, outcome);
      break;
    }

    // The tree's wall-clock deadline (ADR-046) passed: starting another round
    // would only spawn children that instantly block on entry (the
    // proof-word-count run burned a whole round of instantly-dead children this
    // way). Halt honestly instead.
    if (hasReachedTreeDeadline(params.treeState, params.now())) {
      if (lastAssessment === null) {
        return blockedReport(
          `Goal "${params.goal.title}" exhausted its wallClockMs budget before the first round completed.`,
        );
      }
      outcome = 'halt-deadline';
      await appendRoundAssessed(params, roundIndex, lastAssessment, outcome);
      break;
    }

    await params.store.append({
      type: 'round-started',
      at: params.now(),
      goalId: params.goal.id,
      round: roundIndex,
      spentUsd: params.treeState.spentUsd,
      roundWallClockMs: params.goal.budget.wallClockMs,
    });

    if (roundIndex > 0) {
      const reDecided = await params.reDecideRound(lastAssessment!, priorRoundRef);
      if ('halt' in reDecided) {
        outcome = 'continue';
        break;
      }
      roundChildren = reDecided.children;
    }

    const round = await params.runRound(roundChildren);
    roundReport = round.report;

    // Harvest the acceptance-criteria artifact the first round it appears.
    // It is normally a round-0 child, but the planner can place the
    // author-acceptance-criteria leaf in a later round; extracting only from
    // round 0 left criteriaTotal:0 and made the whole loop unwinnable
    // (run ee51401d). Keep looking until found, then hold it.
    if (criteriaArtifact === null) {
      criteriaArtifact = extractCriteriaArtifact(round.childOutcomes);
      if (criteriaArtifact !== null) {
        await params.persistCriteria(criteriaArtifact);
      }
    }

    const committedRef = params.commitRound(roundIndex);
    const assessment = await params.assessRound(criteriaArtifact, round.mergedArtifact);
    lastAssessment = assessment;

    const outcomeDecision = decideMilestoneOutcome({
      assessment,
      priorPassingCount,
      flatRounds,
      roundIndex,
      effectiveMaxRounds: params.effectiveMaxRounds,
    });
    outcome = outcomeDecision.outcome;
    flatRounds = outcomeDecision.flatRounds;

    await appendRoundAssessed(params, roundIndex, assessment, outcome);

    if (outcome !== 'continue') break;

    priorPassingCount = assessment.passingCount;
    priorRoundRef = committedRef ?? priorRoundRef;
    roundIndex += 1;
  }

  const finalReport =
    outcome === 'done' || lastAssessment === null
      ? roundReport
      : withUnmetAcceptanceBlockers(roundReport, lastAssessment);
  await params.store.append({
    type: 'emitted',
    at: params.now(),
    goalId: params.goal.id,
    report: finalReport,
  });
  return finalReport;
}

async function appendRoundAssessed(
  params: {
    goal: Goal;
    store: EventStore;
    now: () => number;
  },
  roundIndex: number,
  assessment: RoundAssessment,
  outcome: MilestoneOutcome,
): Promise<void> {
  await params.store.append({
    type: 'round-assessed',
    at: params.now(),
    goalId: params.goal.id,
    round: roundIndex,
    passingCount: assessment.passingCount,
    criteriaTotal: assessment.criteriaTotal,
    judgeVerdict: assessment.judgeVerdict,
    outcome,
    diffDigest: assessment.diffDigest,
  });
}
