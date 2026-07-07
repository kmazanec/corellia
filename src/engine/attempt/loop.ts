import type { Brain } from '../../contract/brain.js';
import type { DecisionBrief } from '../../contract/decision.js';
import type { EventStore } from '../../contract/events.js';
import type { Goal, Tier } from '../../contract/goal.js';
import type { CheckContext, GoalTypeDef, Registry } from '../../contract/goal-type.js';
import type { Artifact, Report } from '../../contract/report.js';
import type { RiskClass, SensitivityFact } from '../../contract/risk.js';
import type { ToolBroker } from '../../contract/tool.js';
import { debitAttempt } from '../budget-events.js';
import { exhaustedBrief } from '../reports.js';
import {
  debitTreeState,
  hasReachedSpendCeiling,
  hasReachedTreeDeadline,
  type TreeState,
} from '../tree-spend.js';
import {
  evaluateAttemptArtifact,
  type AttemptArtifactEvaluationResult,
} from './artifact-evaluation.js';
import {
  produceAttemptArtifact,
  type AttemptArtifactProductionResult,
} from './artifact-production.js';
import { handleAttemptFailure } from './failure-resolution.js';
import { recheckArtifactAfterRepair } from './recheck.js';
import {
  attemptBrainContext,
  createAttemptLoopState,
  withAttemptBudget,
  type AttemptLoopState,
} from './state.js';

type BriefResolution = 'deny' | 'park' | 'bounce' | 'answered';
type BrainConfig = { modelByTier?: Record<string, string> };

export interface AttemptRunner {
  runAttemptLoop: (params: AttemptLoopInput) => Promise<Report>;
}

export interface AttemptLoopInput {
  goal: Goal;
  initialTier: Tier;
  initialTierIndex: number;
  tierLadder: Tier[];
  entryRisk: RiskClass;
  treeState: TreeState;
}

export interface AttemptRunnerDeps {
  registry: Registry;
  brain: Brain;
  store: EventStore;
  now: () => number;
  effectiveBroker: () => ToolBroker | undefined;
  sandboxRepoRoot: () => string | undefined;
  checkContextFor: (goalId: string) => CheckContext | undefined;
  sensitivity: readonly SensitivityFact[];
  onGate: ((goal: Goal, risk: RiskClass) => Promise<'granted' | 'denied'>) | undefined;
  onBrief: () => ((brief: DecisionBrief) => Promise<BriefResolution>) | undefined;
  enforceToolCallBudget: boolean;
  goldenCapture: boolean;
  persistLeafKnowledge: (goal: Goal, artifact: Artifact) => Promise<void>;
  runBlock: (goal: Goal, brief: DecisionBrief) => Promise<Report>;
  ceilingReport: (goal: Goal, treeState: TreeState) => Promise<Report>;
}

export interface AttemptLoopContext extends AttemptLoopInput {
  deps: AttemptRunnerDeps;
  typeDef: GoalTypeDef;
  brainConfig: BrainConfig | undefined;
}

type AttemptIterationResult =
  | { kind: 'retry'; state: AttemptLoopState }
  | { kind: 'report'; report: Report };

type ProducedArtifact = Extract<AttemptArtifactProductionResult, { kind: 'artifact' }>;

export function createAttemptRunner(deps: AttemptRunnerDeps): AttemptRunner {
  return {
    runAttemptLoop: (input) => runAttemptLoop(deps, input),
  };
}

async function runAttemptLoop(
  deps: AttemptRunnerDeps,
  input: AttemptLoopInput,
): Promise<Report> {
  const context: AttemptLoopContext = {
    ...input,
    deps,
    typeDef: deps.registry.get(input.goal.type),
    brainConfig: brainConfigFor(deps.brain),
  };
  let state = createAttemptLoopState({
    budget: input.goal.budget,
    tier: input.initialTier,
    tierIndex: input.initialTierIndex,
  });

  while (true) {
    const result = await runAttemptIteration(context, state);
    if (result.kind === 'report') {
      return result.report;
    }
    state = result.state;
  }
}

async function runAttemptIteration(
  context: AttemptLoopContext,
  state: AttemptLoopState,
): Promise<AttemptIterationResult> {
  if (hasReachedTreeDeadline(context.treeState, context.deps.now())) {
    return {
      kind: 'report',
      report: await blockOnWallClockBudget(context),
    };
  }

  const debitedState = await debitAttemptCounter(context, state);
  const production = await produceArtifactForAttempt(context, debitedState);
  if (production.kind !== 'artifact') {
    return continueAfterProduction(context, production);
  }

  return evaluateProducedArtifact(context, production);
}

async function blockOnWallClockBudget(
  context: AttemptLoopContext,
): Promise<Report> {
  await context.deps.store.append({
    type: 'budget-exhausted',
    at: context.deps.now(),
    goalId: context.goal.id,
    dimension: 'wallClockMs',
  });
  return context.deps.runBlock(context.goal, exhaustedBrief(context.goal, 'wallClockMs'));
}

async function debitAttemptCounter(
  context: AttemptLoopContext,
  state: AttemptLoopState,
): Promise<AttemptLoopState> {
  return withAttemptBudget(
    state,
    await debitAttempt({
      budget: state.budget,
      goal: context.goal,
      store: context.deps.store,
      now: context.deps.now,
    }),
  );
}

async function produceArtifactForAttempt(
  context: AttemptLoopContext,
  state: AttemptLoopState,
): Promise<AttemptArtifactProductionResult> {
  return produceAttemptArtifact({
    goal: context.goal,
    typeDef: context.typeDef,
    state,
    ctx: attemptBrainContext(context.goal, state),
    tierLadder: context.tierLadder,
    broker: context.deps.effectiveBroker(),
    sandboxRepoRoot: context.deps.sandboxRepoRoot(),
    brain: context.deps.brain,
    registry: context.deps.registry,
    store: context.deps.store,
    now: context.deps.now,
    enforceToolCallBudget: context.deps.enforceToolCallBudget,
    goldenCapture: context.deps.goldenCapture,
    ...(context.brainConfig !== undefined ? { brainConfig: context.brainConfig } : {}),
    debitUsage: (usage) => debitTreeState(context.treeState, usage),
    hasReachedCeiling: () => hasReachedSpendCeiling(context.treeState),
    hasReachedTreeDeadline: () => hasReachedTreeDeadline(context.treeState, context.deps.now()),
    resolveStepLoopFailure: (failure) =>
      handleAttemptFailure({
        context,
        artifact: failure.artifact,
        verdict: failure.verdict,
        budget: failure.budget,
        tier: failure.tier,
        tierIndex: failure.tierIndex,
        priorAttempt: failure.priorAttempt,
      }),
  });
}

async function continueAfterProduction(
  context: AttemptLoopContext,
  production: Exclude<AttemptArtifactProductionResult, ProducedArtifact>,
): Promise<AttemptIterationResult> {
  switch (production.kind) {
    case 'ceiling':
      return {
        kind: 'report',
        report: await context.deps.ceilingReport(context.goal, context.treeState),
      };
    case 'deadline':
      // The tree deadline passed mid-step-loop: the same honest wallClockMs
      // block as the entry check above (ADR-046).
      return { kind: 'report', report: await blockOnWallClockBudget(context) };
    case 'return':
      return { kind: 'report', report: production.report };
    case 'retry':
      return { kind: 'retry', state: production.state };
  }
}

async function evaluateProducedArtifact(
  context: AttemptLoopContext,
  production: ProducedArtifact,
): Promise<AttemptIterationResult> {
  const evaluation = await evaluateAttemptArtifact({
    goal: context.goal,
    artifact: production.artifact,
    typeDef: context.typeDef,
    state: production.state,
    tierLadder: context.tierLadder,
    entryRisk: context.entryRisk,
    stepLoopTailFinding: production.stepLoopTailFinding,
    stepLoopTranscriptTail: production.stepLoopTranscriptTail,
    tournamentRan: production.tournamentRan,
    registry: context.deps.registry,
    brain: context.deps.brain,
    store: context.deps.store,
    now: context.deps.now,
    checkContext: context.deps.checkContextFor(context.goal.id),
    sensitivity: context.deps.sensitivity,
    onGate: context.deps.onGate,
    onBrief: context.deps.onBrief(),
    enforceToolCallBudget: context.deps.enforceToolCallBudget,
    goldenCapture: context.deps.goldenCapture,
    ...(context.brainConfig !== undefined ? { brainConfig: context.brainConfig } : {}),
    debitUsage: (usage) => debitTreeState(context.treeState, usage),
    hasReachedCeiling: () => hasReachedSpendCeiling(context.treeState),
    blockOnToolCallExhausted: () =>
      context.deps.runBlock(context.goal, exhaustedBrief(context.goal, 'toolCalls')),
    resolveFailure: (failure) =>
      handleAttemptFailure({
        context,
        artifact: failure.artifact,
        verdict: failure.verdict,
        budget: failure.budget,
        tier: failure.tier,
        tierIndex: failure.tierIndex,
        priorAttempt: failure.priorAttempt,
      }),
    recheck: (artifact, budget, tier) =>
      recheckArtifactAfterRepair({
        goal: context.goal,
        artifact,
        budget,
        tier,
        typeDef: context.typeDef,
        registry: context.deps.registry,
        brain: context.deps.brain,
        store: context.deps.store,
        now: context.deps.now,
        checkContext: context.deps.checkContextFor(context.goal.id),
        goldenCapture: context.deps.goldenCapture,
        ...(context.brainConfig !== undefined ? { brainConfig: context.brainConfig } : {}),
        debitUsage: (usage) => debitTreeState(context.treeState, usage),
        hasReachedCeiling: () => hasReachedSpendCeiling(context.treeState),
      }),
    persist: context.deps.persistLeafKnowledge,
  });
  return continueAfterEvaluation(context, evaluation);
}

async function continueAfterEvaluation(
  context: AttemptLoopContext,
  evaluation: AttemptArtifactEvaluationResult,
): Promise<AttemptIterationResult> {
  switch (evaluation.kind) {
    case 'ceiling':
      return {
        kind: 'report',
        report: await context.deps.ceilingReport(context.goal, context.treeState),
      };
    case 'emitted':
      return { kind: 'report', report: evaluation.report };
    case 'retry':
      return { kind: 'retry', state: evaluation.state };
  }
}

function brainConfigFor(brain: Brain): BrainConfig | undefined {
  return (brain as { config?: BrainConfig }).config;
}
