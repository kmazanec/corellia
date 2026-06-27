import type { Brain } from '../../contract/brain.js';
import type { EventStore } from '../../contract/events.js';
import type { Budget, Goal, Tier, Usage } from '../../contract/goal.js';
import type { CheckContext, GoalTypeDef, Registry } from '../../contract/goal-type.js';
import type { Artifact } from '../../contract/report.js';
import type { Verdict } from '../../contract/verdict.js';
import { runDeterministicGate } from '../deterministic-gate.js';
import { judgeLeafArtifact } from '../leaf-judge.js';

export interface RecheckArtifactResult {
  passed: boolean;
  budget: Budget;
  verdict: Verdict | null;
  tier: Tier;
  ceiling?: true;
}

export async function recheckArtifactAfterRepair(params: {
  goal: Goal;
  artifact: Artifact;
  budget: Budget;
  tier: Tier;
  typeDef: GoalTypeDef;
  registry: Registry;
  brain: Brain;
  store: EventStore;
  now: () => number;
  checkContext: CheckContext | undefined;
  goldenCapture: boolean;
  brainConfig?: { modelByTier?: Record<string, string> };
  debitUsage: (usage: Usage) => void;
  hasReachedCeiling: () => boolean;
}): Promise<RecheckArtifactResult> {
  const deterministicGate = await runDeterministicGate({
    goal: params.goal,
    artifact: params.artifact,
    checks: params.typeDef.deterministic,
    budget: params.budget,
    checkContext: params.checkContext,
    store: params.store,
    now: params.now,
  });
  const budget = deterministicGate.budget;

  if (deterministicGate.verdict !== null && !deterministicGate.verdict.pass) {
    return {
      passed: false,
      budget,
      verdict: deterministicGate.verdict,
      tier: params.tier,
    };
  }

  if (params.typeDef.judgeType === null) {
    return { passed: true, budget, verdict: null, tier: params.tier };
  }

  const judgeResult = await judgeLeafArtifact({
    goal: params.goal,
    artifact: params.artifact,
    typeDef: params.typeDef,
    judgeType: params.typeDef.judgeType,
    tier: params.tier,
    registry: params.registry,
    brain: params.brain,
    store: params.store,
    now: params.now,
    goldenCapture: params.goldenCapture,
    ...(params.brainConfig !== undefined ? { brainConfig: params.brainConfig } : {}),
  });
  params.debitUsage(judgeResult.usage);

  if (params.hasReachedCeiling()) {
    return {
      passed: false,
      budget,
      verdict: null,
      tier: params.tier,
      ceiling: true,
    };
  }

  return judgeResult.verdict.pass
    ? { passed: true, budget, verdict: null, tier: params.tier }
    : {
        passed: false,
        budget,
        verdict: judgeResult.verdict,
        tier: params.tier,
      };
}
