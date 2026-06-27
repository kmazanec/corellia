import type { BrainContext } from '../../contract/brain.js';
import type { Goal, Tier } from '../../contract/goal.js';
import type { GoalTypeDef } from '../../contract/goal-type.js';
import type { SplitMemo } from '../../contract/pattern.js';

export type MemoStatus = 'none' | 'provisional' | 'trusted';

export function memoStatus(memo: SplitMemo | null): MemoStatus {
  return memo === null ? 'none' : memo.status;
}

export function buildDecisionContext(params: {
  goal: Goal;
  typeDef: GoalTypeDef;
  tier: Tier;
  memo: SplitMemo | null;
  skill: string | undefined;
  repoShape: string | undefined;
}): BrainContext {
  return {
    tier: params.tier,
    memories: params.goal.memories,
    ...(params.skill ? { skill: params.skill } : {}),
    ...(params.repoShape ? { repoShape: params.repoShape } : {}),
    ...(params.typeDef.mustDecompose ? { mustDecompose: true } : {}),
    ...(params.memo?.status === 'provisional' ? { patternHint: params.memo } : {}),
  };
}

export function shouldRunTerracedScan(params: {
  scan: GoalTypeDef['scan'];
  memoStatus: MemoStatus;
  hasJudgeSplit: boolean;
}): boolean {
  return params.scan !== undefined &&
    params.scan.k > 1 &&
    params.memoStatus === 'none' &&
    params.hasJudgeSplit;
}
