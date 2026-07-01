import type { Brain } from '../../contract/brain.js';
import type { Decision } from '../../contract/decision.js';
import type { EventStore } from '../../contract/events.js';
import type { Goal, Tier, Usage } from '../../contract/goal.js';
import type { GoalTypeDef, Registry } from '../../contract/goal-type.js';
import type { SplitMemo, PatternStore } from '../../contract/pattern.js';
import type { Report } from '../../contract/report.js';
import { specShape } from '../../flywheel/shape.js';
import type { KnowledgeCoverageGateway } from '../coverage/split-gate.js';
import {
  buildDecisionContext,
  memoStatus as deriveMemoStatus,
  shouldRunTerracedScan,
} from './context.js';
import { runMustDecomposeGuard } from './must-decompose-guard.js';
import { acceptSplitDecision } from './split-acceptance.js';
import { runTerracedScan } from './terraced-scan.js';

export type DecisionPhaseResult =
  | {
      kind: 'ready';
      decision: Decision;
      decideUsage: Usage | undefined;
      terracedLoserFindings: string[];
      goalShape: string | null;
    }
  | { kind: 'emitted'; report: Report }
  | { kind: 'ceiling' };

export async function resolveDecisionPhase(params: {
  goal: Goal;
  typeDef: GoalTypeDef;
  tier: Tier;
  registry: Registry;
  brain: Brain;
  store: EventStore;
  now: () => number;
  patterns: PatternStore | undefined;
  goldenCapture: boolean;
  brainConfig?: { modelByTier?: Record<string, string> };
  skillForGoalType: (goalType: string) => string | undefined;
  repoShapeForGoal: (goal: Goal) => string | undefined;
  repoRoot?: string;
  knowledge?: KnowledgeCoverageGateway;
  debitUsage: (usage: Usage) => void;
  hasReachedCeiling: () => boolean;
}): Promise<DecisionPhaseResult> {
  let decision: Decision;
  let terracedLoserFindings: string[] = [];
  let decideUsage: Usage | undefined;
  const goalShape = params.typeDef.leafOnly ? null : specShape(params.goal);

  if (goalShape === null) {
    decision = { kind: 'satisfy' };
  } else {
    const derived = await deriveDecision(params, goalShape);
    if (derived.kind === 'ceiling') {
      return derived;
    }
    decision = derived.decision;
    terracedLoserFindings = derived.terracedLoserFindings;
    decideUsage = derived.decideUsage;
  }

  if (decision.kind === 'block' && params.typeDef.family === 'comprehend') {
    await appendDecided(params, decision, decideUsage);
    decision = { kind: 'satisfy' };
  }

  const mustDecompose = await runMustDecomposeGuard({
    enabled: params.typeDef.mustDecompose === true,
    goal: params.goal,
    decision,
    decideUsage,
    tier: params.tier,
    skill: params.skillForGoalType(params.goal.type),
    repoShape: params.repoShapeForGoal(params.goal),
    brain: params.brain,
    store: params.store,
    now: params.now,
    debitUsage: params.debitUsage,
    hasReachedCeiling: params.hasReachedCeiling,
  });
  if (mustDecompose.kind === 'ceiling') {
    return { kind: 'ceiling' };
  }
  if (mustDecompose.kind === 'blocked') {
    return { kind: 'emitted', report: mustDecompose.report };
  }
  if (mustDecompose.kind === 'adopted') {
    decision = mustDecompose.decision;
    decideUsage = mustDecompose.decideUsage;
  }

  if (decision.kind === 'split') {
    const accepted = await acceptSplitDecision({
      goal: params.goal,
      typeDef: params.typeDef,
      decision,
      decideUsage,
      tier: params.tier,
      registry: params.registry,
      brain: params.brain,
      store: params.store,
      now: params.now,
      ...(params.repoRoot !== undefined ? { repoRoot: params.repoRoot } : {}),
      ...(params.knowledge !== undefined ? { knowledge: params.knowledge } : {}),
      goldenCapture: params.goldenCapture,
      ...(params.brainConfig !== undefined ? { brainConfig: params.brainConfig } : {}),
      debitUsage: params.debitUsage,
      hasReachedCeiling: params.hasReachedCeiling,
    });
    if (accepted.kind === 'ceiling') {
      return { kind: 'ceiling' };
    }
    if (accepted.kind === 'emitted') {
      return { kind: 'emitted', report: accepted.report };
    }
    decision = accepted.decision;
    decideUsage = accepted.decideUsage;
  }

  return {
    kind: 'ready',
    decision,
    decideUsage,
    terracedLoserFindings,
    goalShape,
  };
}

type DerivedDecisionResult =
  | {
      kind: 'derived';
      decision: Decision;
      decideUsage: Usage | undefined;
      terracedLoserFindings: string[];
    }
  | { kind: 'ceiling' };

async function deriveDecision(
  params: Parameters<typeof resolveDecisionPhase>[0],
  shape: string,
): Promise<DerivedDecisionResult> {
  const memo = params.patterns ? await params.patterns.match(shape) : null;
  const memoStatus = deriveMemoStatus(memo);

  await params.store.append({
    type: 'pattern-consulted',
    at: params.now(),
    goalId: params.goal.id,
    shape,
    status: memoStatus,
  });

  if (memoStatus === 'trusted' && memo !== null) {
    return {
      kind: 'derived',
      decision: memo.decision,
      decideUsage: undefined,
      terracedLoserFindings: [],
    };
  }

  return deriveFreshDecision(params, memo, memoStatus);
}

async function deriveFreshDecision(
  params: Parameters<typeof resolveDecisionPhase>[0],
  memo: SplitMemo | null,
  memoStatus: ReturnType<typeof deriveMemoStatus>,
): Promise<DerivedDecisionResult> {
  const baseCtx = buildDecisionContext({
    goal: params.goal,
    typeDef: params.typeDef,
    tier: params.tier,
    memo,
    skill: params.skillForGoalType(params.goal.type),
    repoShape: params.repoShapeForGoal(params.goal),
  });

  const scan = params.typeDef.scan;
  if (scan !== undefined && shouldRunTerracedScan({
    scan,
    memoStatus,
    hasJudgeSplit: params.registry.has('judge-split'),
  })) {
    const scanResult = await runTerracedScan({
      goal: params.goal,
      k: scan.k,
      lenses: scan.lenses,
      baseCtx,
      tier: params.tier,
      brain: params.brain,
      registry: params.registry,
      store: params.store,
      now: params.now,
      goldenCapture: params.goldenCapture,
      ...(params.brainConfig !== undefined ? { brainConfig: params.brainConfig } : {}),
      debitUsage: params.debitUsage,
      hasReachedCeiling: params.hasReachedCeiling,
    });
    if ('ceiling' in scanResult) {
      return { kind: 'ceiling' };
    }
    return {
      kind: 'derived',
      decision: scanResult.decision,
      decideUsage: scanResult.winnerUsage,
      terracedLoserFindings: scanResult.loserFindings,
    };
  }

  const decideResult = await params.brain.decide(params.goal, baseCtx);
  params.debitUsage(decideResult.usage);
  if (params.hasReachedCeiling()) {
    await appendDecided(params, decideResult.value, decideResult.usage);
    return { kind: 'ceiling' };
  }

  return {
    kind: 'derived',
    decision: decideResult.value,
    decideUsage: decideResult.usage,
    terracedLoserFindings: [],
  };
}

async function appendDecided(
  params: { goal: Goal; store: EventStore; now: () => number },
  decision: Decision,
  usage: Usage | undefined,
): Promise<void> {
  await params.store.append({
    type: 'decided',
    at: params.now(),
    goalId: params.goal.id,
    decision,
    ...(usage !== undefined ? { usage } : {}),
  });
}
