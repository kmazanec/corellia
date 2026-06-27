import type { Brain, BrainContext, StepTranscript } from '../../contract/brain.js';
import type { EventStore } from '../../contract/events.js';
import type { Goal, Tier, Usage } from '../../contract/goal.js';
import type { GoalTypeDef, Registry } from '../../contract/goal-type.js';
import type { Artifact, Report } from '../../contract/report.js';
import type { ToolBroker } from '../../contract/tool.js';
import type { Finding } from '../../contract/verdict.js';
import { debitTokenCount } from '../budget-events.js';
import { runStepLoop } from '../step-loop.js';
import {
  stepLoopTranscriptFinding,
  type StepLoopResult,
} from '../step-loop-result.js';
import { isToolGranted } from '../step-loop-tools.js';
import type { AttemptFailureResolution } from './failure.js';
import { produceClassicArtifact } from './classic-produce.js';
import { runLeafTournament } from './leaf-tournament.js';
import {
  continueAfterStepLoopFailure,
  withAttemptBudget,
  withAttemptRetry,
  type AttemptLoopState,
} from './state.js';
import {
  transitionStepLoopFailure,
  type StepLoopFailureContext,
} from './step-loop-failure.js';

export type AttemptArtifactProductionResult =
  | {
      kind: 'artifact';
      artifact: Artifact;
      state: AttemptLoopState;
      stepLoopTranscriptTail: StepTranscript | undefined;
      stepLoopTailFinding: Finding | null;
      tournamentRan: boolean;
    }
  | { kind: 'retry'; state: AttemptLoopState }
  | { kind: 'return'; report: Report }
  | { kind: 'ceiling' };

export async function produceAttemptArtifact(params: {
  goal: Goal;
  typeDef: GoalTypeDef;
  state: AttemptLoopState;
  ctx: BrainContext;
  tierLadder: Tier[];
  broker: ToolBroker | undefined;
  sandboxRepoRoot: string | undefined;
  brain: Brain;
  registry: Registry;
  store: EventStore;
  now: () => number;
  enforceToolCallBudget: boolean;
  goldenCapture: boolean;
  brainConfig?: { modelByTier?: Record<string, string> };
  debitUsage: (usage: Usage) => void;
  hasReachedCeiling: () => boolean;
  resolveStepLoopFailure: (
    failure: StepLoopFailureContext,
  ) => Promise<AttemptFailureResolution>;
}): Promise<AttemptArtifactProductionResult> {
  if (isToolGranted(params.typeDef.grants) && params.broker !== undefined) {
    return produceWithStepLoop(params, params.broker);
  }

  return produceWithClassicPath(params);
}

async function produceWithStepLoop(
  params: Parameters<typeof produceAttemptArtifact>[0],
  broker: ToolBroker,
): Promise<AttemptArtifactProductionResult> {
  const loopResult = await runStepLoop({
    goal: params.goal,
    grants: params.typeDef.grants,
    budget: params.state.budget,
    ctx: params.ctx,
    typeDef: params.typeDef,
    broker,
    sandboxRepoRoot: params.sandboxRepoRoot,
    priorTranscript: params.state.priorLoopTranscript,
    brain: params.brain,
    store: params.store,
    now: params.now,
    enforceToolCallBudget: params.enforceToolCallBudget,
    debitUsage: params.debitUsage,
    hasReachedCeiling: params.hasReachedCeiling,
  });

  if (loopResult.kind === 'ceiling') {
    return { kind: 'ceiling' };
  }

  if (loopResult.kind !== 'artifact') {
    return continueFromStepLoopFailure(params, loopResult);
  }

  let state = withAttemptBudget(params.state, loopResult.budget);
  state = withAttemptBudget(
    state,
    await debitTokenCount({
      budget: state.budget,
      tokens: loopResult.tokensUsed,
      goal: params.goal,
      store: params.store,
      now: params.now,
    }),
  );

  return {
    kind: 'artifact',
    artifact: loopResult.artifact,
    state,
    stepLoopTranscriptTail: loopResult.transcript,
    stepLoopTailFinding: stepLoopTranscriptFinding(loopResult.transcript),
    tournamentRan: false,
  };
}

async function continueFromStepLoopFailure(
  params: Parameters<typeof produceAttemptArtifact>[0],
  loopResult: Extract<StepLoopResult, { kind: 'exhausted' | 'failed' }>,
): Promise<AttemptArtifactProductionResult> {
  const failure = await transitionStepLoopFailure({
    goal: params.goal,
    loopResult,
    tier: params.state.tier,
    tierIndex: params.state.tierIndex,
    tierLadder: params.tierLadder,
    priorAttempt: params.state.priorAttempt,
    store: params.store,
    now: params.now,
    resolveFailure: params.resolveStepLoopFailure,
  });
  const continuation = continueAfterStepLoopFailure(failure);
  if (continuation.kind === 'return') {
    return { kind: 'return', report: continuation.report };
  }
  return { kind: 'retry', state: withAttemptRetry(params.state, continuation.retry) };
}

async function produceWithClassicPath(
  params: Parameters<typeof produceAttemptArtifact>[0],
): Promise<AttemptArtifactProductionResult> {
  const produceResult = await produceClassicArtifact({
    goal: params.goal,
    ctx: params.ctx,
    budget: params.state.budget,
    brain: params.brain,
    store: params.store,
    now: params.now,
    debitUsage: params.debitUsage,
    hasReachedCeiling: params.hasReachedCeiling,
  });
  if (produceResult.kind === 'ceiling') {
    return { kind: 'ceiling' };
  }

  let artifact = produceResult.artifact;
  let state = withAttemptBudget(params.state, produceResult.budget);
  let tournamentRan = false;

  if (params.typeDef.scan && params.typeDef.scan.k > 1 && params.typeDef.judgeType !== null) {
    const tournResult = await runLeafTournament({
      goal: params.goal,
      firstArtifact: artifact,
      scan: params.typeDef.scan,
      judgeType: params.typeDef.judgeType,
      typeDef: params.typeDef,
      tier: state.tier,
      budget: state.budget,
      ctx: params.ctx,
      registry: params.registry,
      brain: params.brain,
      store: params.store,
      now: params.now,
      goldenCapture: params.goldenCapture,
      ...(params.brainConfig !== undefined ? { brainConfig: params.brainConfig } : {}),
      debitUsage: params.debitUsage,
      hasReachedCeiling: params.hasReachedCeiling,
    });
    if (tournResult.kind === 'ceiling') {
      return { kind: 'ceiling' };
    }
    artifact = tournResult.artifact;
    state = withAttemptBudget(state, tournResult.budget);
    tournamentRan = true;
  }

  return {
    kind: 'artifact',
    artifact,
    state,
    stepLoopTranscriptTail: undefined,
    stepLoopTailFinding: null,
    tournamentRan,
  };
}
