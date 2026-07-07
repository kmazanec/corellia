/**
 * The replay harness — the calibration itself. Run each pair in a goal-type's
 * golden set through its judge (at a given tier) and score the judge's verdicts
 * against the exogenous labels. This is the "eval of the evaluators": drift
 * across a model/prompt change shows up as the score moving.
 *
 * The brain is INJECTED, so a test runs a scripted judge and never hits a live
 * API. In production the caller passes the real LLM brain; the harness is
 * indifferent to which.
 */

import type { Brain, BrainContext } from '../../contract/brain.js';
import type { Goal, Tier } from '../../contract/goal.js';
import type { GoldenPair } from './golden-set.js';
import { expectedPass } from './golden-set.js';

/** One replayed pair: what the judge said vs. what the label expected. */
export interface ReplayOutcome {
  id: string;
  judgeType: string;
  /** The pass/fail the label demanded of the judge. */
  expected: boolean;
  /** The pass/fail the judge actually rendered on replay. */
  actual: boolean;
  /** Whether the judge agreed with the ground truth. */
  agreed: boolean;
}

/**
 * The confusion-matrix scores for one judge's golden set. `positive` is
 * label-should-pass; precision/recall are reported for the positive class, which
 * is what "does this judge correctly bless good work" means. `agreement` is the
 * overall accuracy — the headline calibration number.
 */
export interface CalibrationScore {
  judgeType: string;
  goalType: string;
  tier: Tier;
  total: number;
  agreed: number;
  /** agreed / total, or 1 for an empty set (vacuously calibrated). */
  agreement: number;
  truePositive: number;
  falsePositive: number;
  trueNegative: number;
  falseNegative: number;
  /** tp / (tp + fp), or null when the judge passed nothing. */
  precision: number | null;
  /** tp / (tp + fn), or null when the set has no positive labels. */
  recall: number | null;
  outcomes: ReplayOutcome[];
}

/**
 * A synthetic goal reconstructed for a replay judge call. The judge only reads
 * the goal's id/type/intent/memories, so a minimal goal suffices — the pair
 * carries the real subject (artifact) and rubric.
 */
function replayGoal(pair: GoldenPair): Goal {
  return {
    id: `golden-replay:${pair.id}`,
    type: pair.goalType,
    parentId: null,
    title: `golden replay ${pair.id}`,
    spec: {},
    intent: 'production',
    scope: [],
    budget: { attempts: 1, tokens: 0, toolCalls: 0, wallClockMs: 0 },
    memories: [],
  };
}

/**
 * Replay one goal-type's golden set through `brain.judge` and score agreement
 * against the labels. The judge sees exactly the pinned artifact and rubric; its
 * verdict's `pass` is compared to each label's expectation.
 */
export async function replayGoldenSet(params: {
  goalType: string;
  pairs: GoldenPair[];
  brain: Brain;
  tier: Tier;
}): Promise<CalibrationScore> {
  const outcomes: ReplayOutcome[] = [];
  let tp = 0;
  let fp = 0;
  let tn = 0;
  let fn = 0;

  for (const pair of params.pairs) {
    const goal = replayGoal(pair);
    const ctx: BrainContext = { tier: params.tier, memories: [] };
    const verdict = await params.brain.judge(goal, pair.artifact, pair.rubric, ctx);
    const actual = verdict.value.pass;
    const expected = expectedPass(pair.label);
    const agreed = actual === expected;

    if (expected && actual) tp++;
    else if (!expected && actual) fp++;
    else if (!expected && !actual) tn++;
    else fn++;

    outcomes.push({ id: pair.id, judgeType: pair.judgeType, expected, actual, agreed });
  }

  const total = params.pairs.length;
  const agreed = tp + tn;
  const judgeType = params.pairs[0]?.judgeType ?? 'unknown';

  return {
    judgeType,
    goalType: params.goalType,
    tier: params.tier,
    total,
    agreed,
    agreement: total === 0 ? 1 : agreed / total,
    truePositive: tp,
    falsePositive: fp,
    trueNegative: tn,
    falseNegative: fn,
    precision: tp + fp === 0 ? null : tp / (tp + fp),
    recall: tp + fn === 0 ? null : tp / (tp + fn),
    outcomes,
  };
}

/** Render a calibration score as a compact human-readable block. */
export function renderScore(score: CalibrationScore): string {
  const pct = (n: number): string => `${(n * 100).toFixed(0)}%`;
  const ratio = (n: number | null): string => (n === null ? 'n/a' : pct(n));
  const lines = [
    `calibration: ${score.judgeType} (goal-type ${score.goalType}, tier ${score.tier})`,
    `  pairs:      ${score.total}`,
    `  agreement:  ${pct(score.agreement)} (${score.agreed}/${score.total})`,
    `  precision:  ${ratio(score.precision)}   recall: ${ratio(score.recall)}`,
    `  confusion:  tp=${score.truePositive} fp=${score.falsePositive} tn=${score.trueNegative} fn=${score.falseNegative}`,
  ];
  return lines.join('\n');
}
