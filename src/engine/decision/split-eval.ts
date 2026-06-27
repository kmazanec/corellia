import type { Brain, BrainContext } from '../../contract/brain.js';
import type { ChildPlan } from '../../contract/decision.js';
import type { EventStore } from '../../contract/events.js';
import type { Goal, Tier, Usage } from '../../contract/goal.js';
import type { Registry } from '../../contract/goal-type.js';
import type { Artifact } from '../../contract/report.js';
import type { Verdict } from '../../contract/verdict.js';
import { appendGoldenCandidate, enrichRubric } from '../judge-support.js';

export const JUDGE_SPLIT_TYPE = 'judge-split';

export interface SplitJudgeResult {
  artifact: Artifact;
  verdict: Verdict;
  usage: Usage;
}

export function splitPlanArtifact(children: readonly ChildPlan[]): Artifact {
  return {
    kind: 'text',
    text: JSON.stringify(children),
  };
}

export function invalidSplitStructureVerdict(structuralError: string): Verdict {
  return {
    pass: false,
    findings: [
      {
        title: 'Invalid split structure',
        dimension: 'spec',
        severity: 'high',
        gating: true,
        prescription: structuralError,
      },
    ],
    failureSignature: `invalid-split:${structuralError}`,
  };
}

export function isomorphicSplitFailure(
  priorVerdict: Verdict | undefined,
  verdict: Verdict,
): boolean {
  return priorVerdict !== undefined &&
    verdict.failureSignature === priorVerdict.failureSignature;
}

export async function judgeSplitDecision(params: {
  goal: Goal;
  children: readonly ChildPlan[];
  tier: Tier;
  registry: Registry;
  brain: Brain;
  store: EventStore;
  now: () => number;
  goldenCapture: boolean;
  brainConfig?: { modelByTier?: Record<string, string> };
}): Promise<SplitJudgeResult> {
  const artifact = splitPlanArtifact(params.children);
  const rubric = enrichRubric(params.registry,
    'Evaluate the split: is it sound and complete? Are dependencies correct and acyclic? Are budgetShares sensible?',
    JUDGE_SPLIT_TYPE,
    params.goal.intent,
  );
  const judgeCtx: BrainContext = {
    tier: params.tier,
    memories: params.goal.memories,
  };
  const judgeResult = await params.brain.judge(
    params.goal,
    artifact,
    rubric,
    judgeCtx,
  );
  const verdict = judgeResult.value;

  await params.store.append({
    type: 'judge-verdict',
    at: params.now(),
    goalId: params.goal.id,
    judgeType: JUDGE_SPLIT_TYPE,
    verdict,
    tier: params.tier,
    usage: judgeResult.usage,
  });
  await appendGoldenCandidate({
    enabled: params.goldenCapture,
    store: params.store,
    now: params.now,
    goalId: params.goal.id,
    judgeType: JUDGE_SPLIT_TYPE,
    artifact,
    rubric,
    verdict,
    tier: params.tier,
    ...(params.brainConfig !== undefined ? { brainConfig: params.brainConfig } : {}),
  });

  return { artifact, verdict, usage: judgeResult.usage };
}
