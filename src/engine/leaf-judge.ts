import type { Brain, BrainContext } from '../contract/brain.js';
import type { EventStore } from '../contract/events.js';
import type { Goal, Tier, Usage } from '../contract/goal.js';
import type { GoalTypeDef, Registry } from '../contract/goal-type.js';
import type { Artifact } from '../contract/report.js';
import type { Verdict } from '../contract/verdict.js';
import { appendGoldenCandidate, enrichRubric } from './judge-support.js';

export interface LeafJudgeResult {
  verdict: Verdict;
  usage: Usage;
}

export async function judgeLeafArtifact(params: {
  goal: Goal;
  artifact: Artifact;
  typeDef: GoalTypeDef;
  judgeType: string;
  tier: Tier;
  registry: Registry;
  brain: Brain;
  store: EventStore;
  now: () => number;
  goldenCapture: boolean;
  brainConfig?: { modelByTier?: Record<string, string> };
}): Promise<LeafJudgeResult> {
  const rubric = enrichRubric(params.registry,
    `Judge this artifact as a ${params.judgeType} for goal type ${params.typeDef.name}`,
    params.judgeType,
    params.goal.intent,
  );
  const judgeCtx: BrainContext = {
    tier: params.tier,
    memories: params.goal.memories,
  };
  const judgeResult = await params.brain.judge(
    params.goal,
    params.artifact,
    rubric,
    judgeCtx,
  );
  const verdict = judgeResult.value;

  await params.store.append({
    type: 'judge-verdict',
    at: params.now(),
    goalId: params.goal.id,
    judgeType: params.judgeType,
    verdict,
    tier: params.tier,
    usage: judgeResult.usage,
  });
  await appendGoldenCandidate({
    enabled: params.goldenCapture,
    store: params.store,
    now: params.now,
    goalId: params.goal.id,
    judgeType: params.judgeType,
    artifact: params.artifact,
    rubric,
    verdict,
    tier: params.tier,
    ...(params.brainConfig !== undefined ? { brainConfig: params.brainConfig } : {}),
  });

  return { verdict, usage: judgeResult.usage };
}
