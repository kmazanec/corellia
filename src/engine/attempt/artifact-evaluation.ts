import type { StepTranscript } from '../../contract/brain.js';
import type { DecisionBrief } from '../../contract/decision.js';
import type { EventStore } from '../../contract/events.js';
import type { Goal, Tier, Usage } from '../../contract/goal.js';
import type { CheckContext, GoalTypeDef, Registry } from '../../contract/goal-type.js';
import type { Artifact, Report } from '../../contract/report.js';
import type { RiskClass, SensitivityFact } from '../../contract/risk.js';
import type { Finding, Verdict } from '../../contract/verdict.js';
import { debitTokenUsage } from '../budget-events.js';
import { runDeterministicGate } from '../deterministic-gate.js';
import { judgeLeafArtifact } from '../leaf-judge.js';
import { isDeliveryRefusal, deliveryRefusalVerdict } from './delivery-refusal.js';
import { checkEmissionAuthority } from './emission-authority.js';
import type { AttemptFailureResolution } from './failure.js';
import { transitionArtifactFailure } from './failure-transition.js';
import type { RecheckArtifactResult } from './recheck.js';
import {
  continueAfterArtifactFailure,
  withAttemptBudget,
  withAttemptRetry,
  type AttemptLoopState,
  type AttemptPrior,
} from './state.js';
import { emitSuccessfulArtifact } from './success.js';

export type AttemptArtifactEvaluationResult =
  | { kind: 'emitted'; report: Report }
  | { kind: 'retry'; state: AttemptLoopState }
  | { kind: 'ceiling' };

export async function evaluateAttemptArtifact(params: {
  goal: Goal;
  artifact: Artifact;
  typeDef: GoalTypeDef;
  state: AttemptLoopState;
  tierLadder: Tier[];
  entryRisk: RiskClass;
  stepLoopTailFinding: Finding | null;
  stepLoopTranscriptTail: StepTranscript | undefined;
  tournamentRan: boolean;
  registry: Registry;
  brain: Parameters<typeof judgeLeafArtifact>[0]['brain'];
  store: EventStore;
  now: () => number;
  checkContext: CheckContext | undefined;
  sensitivity: readonly SensitivityFact[];
  onGate: ((goal: Goal, risk: RiskClass) => Promise<'granted' | 'denied'>) | undefined;
  onBrief: ((brief: DecisionBrief) => Promise<'deny' | 'park' | 'bounce' | 'answered'>) | undefined;
  enforceToolCallBudget: boolean;
  goldenCapture: boolean;
  brainConfig?: { modelByTier?: Record<string, string> };
  debitUsage: (usage: Usage) => void;
  hasReachedCeiling: () => boolean;
  blockOnToolCallExhausted: () => Promise<Report>;
  resolveFailure: (failure: ArtifactFailureContext) => Promise<AttemptFailureResolution>;
  recheck: (
    artifact: Artifact,
    budget: Parameters<typeof evaluateAttemptArtifact>[0]['state']['budget'],
    tier: Tier,
  ) => Promise<RecheckArtifactResult>;
  persist: (goal: Goal, artifact: Artifact) => Promise<void>;
}): Promise<AttemptArtifactEvaluationResult> {
  let state = params.state;

  const deterministic = await runDeterministicGate({
    goal: params.goal,
    artifact: params.artifact,
    checks: params.typeDef.deterministic,
    budget: state.budget,
    checkContext: params.checkContext,
    store: params.store,
    now: params.now,
  });
  state = withAttemptBudget(state, deterministic.budget);

  if (deterministic.verdict !== null) {
    if (deterministic.toolCallsExhausted) {
      await params.store.append({
        type: 'budget-exhausted',
        at: params.now(),
        goalId: params.goal.id,
        dimension: 'toolCalls',
      });
      if (params.enforceToolCallBudget) {
        return { kind: 'emitted', report: await params.blockOnToolCallExhausted() };
      }
    }

    if (!deterministic.verdict.pass) {
      return handleFailingVerdict({
        ...params,
        state,
        verdict: deterministic.verdict,
      });
    }
  }

  // Refusal floor: an artifact that states it cannot deliver is non-delivery by
  // construction. Fail it deterministically, before any judge can read it as a
  // coherent artifact and pass — a refusal must surface as a blocker, not a PASS.
  if (isDeliveryRefusal(params.artifact)) {
    const refusalVerdict = deliveryRefusalVerdict();
    await params.store.append({
      type: 'deterministic-checked',
      at: params.now(),
      goalId: params.goal.id,
      verdict: refusalVerdict,
    });
    return handleFailingVerdict({ ...params, state, verdict: refusalVerdict });
  }

  const emissionAuthorityReport = await checkEmissionAuthority({
    goal: params.goal,
    artifact: params.artifact,
    entryRisk: params.entryRisk,
    sensitivity: params.sensitivity,
    store: params.store,
    now: params.now,
    onGate: params.onGate,
    onBrief: params.onBrief,
  });
  if (emissionAuthorityReport !== null) {
    return { kind: 'emitted', report: emissionAuthorityReport };
  }

  if (params.typeDef.judgeType !== null && !params.tournamentRan) {
    const judgeResult = await judgeLeafArtifact({
      goal: params.goal,
      artifact: params.artifact,
      typeDef: params.typeDef,
      judgeType: params.typeDef.judgeType,
      tier: state.tier,
      registry: params.registry,
      brain: params.brain,
      store: params.store,
      now: params.now,
      goldenCapture: params.goldenCapture,
      ...(params.brainConfig !== undefined ? { brainConfig: params.brainConfig } : {}),
    });

    params.debitUsage(judgeResult.usage);
    if (params.hasReachedCeiling()) {
      return { kind: 'ceiling' };
    }

    state = withAttemptBudget(
      state,
      await debitTokenUsage({
        budget: state.budget,
        usage: judgeResult.usage,
        goal: params.goal,
        store: params.store,
        now: params.now,
      }),
    );

    if (!judgeResult.verdict.pass) {
      return handleFailingVerdict({
        ...params,
        state,
        verdict: judgeResult.verdict,
      });
    }
  }

  return {
    kind: 'emitted',
    report: await emitSuccessfulArtifact({
      goal: params.goal,
      artifact: params.artifact,
      store: params.store,
      now: params.now,
      persist: params.persist,
    }),
  };
}

export interface ArtifactFailureContext {
  artifact: Artifact;
  verdict: Verdict;
  budget: AttemptLoopState['budget'];
  tier: Tier;
  tierIndex: number;
  priorAttempt: AttemptPrior | undefined;
}

async function handleFailingVerdict(
  params: Parameters<typeof evaluateAttemptArtifact>[0] & {
    state: AttemptLoopState;
    verdict: Verdict;
  },
): Promise<AttemptArtifactEvaluationResult> {
  const failure = await transitionArtifactFailure({
    goal: params.goal,
    artifact: params.artifact,
    verdict: params.verdict,
    budget: params.state.budget,
    tier: params.state.tier,
    tierIndex: params.state.tierIndex,
    tierLadder: params.tierLadder,
    priorAttempt: params.state.priorAttempt,
    stepLoopTailFinding: params.stepLoopTailFinding,
    stepLoopTranscriptTail: params.stepLoopTranscriptTail,
    resolveFailure: () =>
      params.resolveFailure({
        artifact: params.artifact,
        verdict: params.verdict,
        budget: params.state.budget,
        tier: params.state.tier,
        tierIndex: params.state.tierIndex,
        priorAttempt: params.state.priorAttempt,
      }),
    recheck: params.recheck,
    emitSuccess: (successArtifact) =>
      emitSuccessfulArtifact({
        goal: params.goal,
        artifact: successArtifact,
        store: params.store,
        now: params.now,
        persist: params.persist,
      }),
  });

  const continuation = continueAfterArtifactFailure(failure);
  if (continuation.kind === 'ceiling') {
    return { kind: 'ceiling' };
  }
  if (continuation.kind === 'return') {
    return { kind: 'emitted', report: continuation.report };
  }
  return {
    kind: 'retry',
    state: withAttemptRetry(params.state, continuation.retry),
  };
}
