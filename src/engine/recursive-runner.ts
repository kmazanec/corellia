import type { Brain } from '../contract/brain.js';
import type { Decision, DecisionBrief } from '../contract/decision.js';
import type { EventStore } from '../contract/events.js';
import type { Goal, Usage } from '../contract/goal.js';
import type { CheckContext, Registry } from '../contract/goal-type.js';
import type { MemoryView } from '../contract/memory.js';
import type { PatternStore } from '../contract/pattern.js';
import type { Artifact, Report } from '../contract/report.js';
import type { RiskClass, SensitivityFact } from '../contract/risk.js';
import type { ToolBroker } from '../contract/tool.js';
import { createAttemptRunner } from './attempt/loop.js';
import {
  ceilingReachedOnce,
  ceilingReport,
  runBlock,
} from './blocking.js';
import {
  resolveDecisionPhase,
  type DecisionPhaseResult,
} from './decision/phase.js';
import { enterGoal } from './goal-entry.js';
import type { EngineKnowledge } from './options.js';
import { runSplitDispatch } from './split-dispatch.js';
import { createSplitRunner } from './split-runner.js';
import {
  debitTreeState,
  hasReachedSpendCeiling,
  type TreeState,
} from './tree-spend.js';
import type { TreeWorktree } from './worktree.js';

type BriefResolution = 'deny' | 'park' | 'bounce' | 'answered';
type RecursiveRunnerDeps = Parameters<typeof createRecursiveRunner>[0];
type GoalEntry = Awaited<ReturnType<typeof enterGoal>>;
type ReadyGoalEntry = Extract<GoalEntry, { kind: 'ready' }>;
type ReadyDecision = Extract<DecisionPhaseResult, { kind: 'ready' }> & {
  entry: ReadyGoalEntry;
};
type ReadySatisfyDecision = ReadyDecision & {
  decision: Extract<Decision, { kind: 'satisfy' }>;
};
type ReadySplitDecision = ReadyDecision & {
  decision: Extract<Decision, { kind: 'split' }>;
};

export interface RecursiveRunner {
  run: (goal: Goal, treeState: TreeState) => Promise<Report>;
}

export function createRecursiveRunner(deps: {
  registry: Registry;
  brain: Brain;
  store: EventStore;
  memory: MemoryView;
  now: () => number;
  goldenCapture: boolean;
  enforceToolCallBudget: boolean;
  sensitivity: readonly SensitivityFact[];
  onGate: ((goal: Goal, risk: RiskClass) => Promise<'granted' | 'denied'>) | undefined;
  onBrief: () => ((brief: DecisionBrief) => Promise<BriefResolution>) | undefined;
  patterns: PatternStore | undefined;
  knowledge: EngineKnowledge | undefined;
  effectiveBroker: () => ToolBroker | undefined;
  activeWorktree: () => TreeWorktree | undefined;
  checkContextFor: (goalId: string) => CheckContext | undefined;
  persistLeafKnowledge: (goal: Goal, artifact: Artifact) => Promise<void>;
  runChild: (goal: Goal, treeState: TreeState) => Promise<Report>;
  decideSkillBlock: (goalType: string) => string | undefined;
  repoShapeHint: (goal: Goal) => string | undefined;
}): RecursiveRunner {
  return {
    run: (goal, treeState) => runRecursiveGoal(deps, goal, treeState),
  };
}

async function runRecursiveGoal(
  deps: RecursiveRunnerDeps,
  goal: Goal,
  treeState: TreeState,
): Promise<Report> {
  const entry = await enterRecursiveGoal(deps, goal, treeState);
  if (entry.kind === 'ceiling') {
    return runCeilingReport(deps, goal, treeState);
  }
  if (entry.kind === 'emitted') {
    return entry.report;
  }

  const decision = await decideGoal(deps, goal, treeState, entry);
  if (decision.kind === 'ceiling') {
    return runCeilingReport(deps, goal, treeState);
  }
  if (decision.kind === 'emitted') {
    return decision.report;
  }

  await appendDecidedEvent(deps, goal, decision);
  return dispatchDecision(deps, goal, treeState, decision);
}

function enterRecursiveGoal(
  deps: RecursiveRunnerDeps,
  goal: Goal,
  treeState: TreeState,
): Promise<GoalEntry> {
  return enterGoal({
    goal,
    registry: deps.registry,
    store: deps.store,
    now: deps.now,
    sensitivity: deps.sensitivity,
    onGate: deps.onGate,
    onBrief: deps.onBrief(),
    hasReachedCeiling: () => hasReachedSpendCeiling(treeState),
  });
}

async function appendDecidedEvent(
  deps: RecursiveRunnerDeps,
  goal: Goal,
  decision: ReadyDecision,
): Promise<void> {
  await deps.store.append({
    type: 'decided',
    at: deps.now(),
    goalId: goal.id,
    decision: decision.decision,
    ...(decision.decideUsage !== undefined ? { usage: decision.decideUsage } : {}),
  });
}

function dispatchDecision(
  deps: RecursiveRunnerDeps,
  goal: Goal,
  treeState: TreeState,
  decision: ReadyDecision,
): Promise<Report> {
  switch (decision.decision.kind) {
    case 'satisfy':
      return runSatisfyDecision(deps, goal, treeState, {
        ...decision,
        decision: decision.decision,
      });

    case 'split':
      return runSplitDecision(deps, goal, treeState, {
        ...decision,
        decision: decision.decision,
      });

    case 'block':
      return runBlockFor(deps, goal, decision.decision.brief);

    default:
      return assertNever(decision.decision);
  }
}

function runSatisfyDecision(
  deps: RecursiveRunnerDeps,
  goal: Goal,
  treeState: TreeState,
  decision: ReadySatisfyDecision,
): Promise<Report> {
  return createAttemptRunner({
    registry: deps.registry,
    brain: deps.brain,
    store: deps.store,
    now: deps.now,
    effectiveBroker: deps.effectiveBroker,
    sandboxRepoRoot: () => deps.activeWorktree()?.repoRoot,
    checkContextFor: deps.checkContextFor,
    sensitivity: deps.sensitivity,
    onGate: deps.onGate,
    onBrief: deps.onBrief,
    enforceToolCallBudget: deps.enforceToolCallBudget,
    goldenCapture: deps.goldenCapture,
    persistLeafKnowledge: deps.persistLeafKnowledge,
    runBlock: (blockGoal, brief) => runBlockFor(deps, blockGoal, brief),
    ceilingReport: (ceilingGoal, ceilingTreeState) =>
      runCeilingReport(deps, ceilingGoal, ceilingTreeState),
  }).runAttemptLoop({
    goal,
    initialTier: decision.entry.tier,
    initialTierIndex: decision.entry.tierIndex,
    tierLadder: decision.entry.tierLadder,
    deadline: decision.entry.deadline,
    entryRisk: decision.entry.entryRisk,
    treeState,
  });
}

function runSplitDecision(
  deps: RecursiveRunnerDeps,
  goal: Goal,
  treeState: TreeState,
  decision: ReadySplitDecision,
): Promise<Report> {
  const splitRunner = createSplitRunnerFor(deps);
  return runSplitDispatch({
    goal,
    typeDef: decision.entry.typeDef,
    decision: decision.decision,
    terracedLoserFindings: decision.terracedLoserFindings,
    goalShape: decision.goalShape,
    patterns: deps.patterns,
    store: deps.store,
    now: deps.now,
    runMilestone: (children) => splitRunner.runMilestone(goal, children, treeState),
    runSplit: (children, findings) =>
      splitRunner.runSplit(goal, children, findings, treeState),
  });
}

function createSplitRunnerFor(deps: RecursiveRunnerDeps) {
  return createSplitRunner({
    memory: deps.memory,
    registry: deps.registry,
    brain: deps.brain,
    goldenCapture: deps.goldenCapture,
    store: deps.store,
    now: deps.now,
    activeWorktree: deps.activeWorktree,
    factsForRegions: deps.knowledge?.factsForRegions,
    headSha: deps.knowledge?.headSha,
    checkContextFor: deps.checkContextFor,
    persistLeafKnowledge: deps.persistLeafKnowledge,
    runChild: deps.runChild,
    decideSkillBlock: deps.decideSkillBlock,
    ceilingReachedOnce: (goal, treeState) =>
      ceilingReachedOnce({
        goal,
        treeState,
        store: deps.store,
        now: deps.now,
      }),
    ceilingReport: (goal, treeState) => runCeilingReport(deps, goal, treeState),
  });
}

async function decideGoal(
  deps: RecursiveRunnerDeps,
  goal: Goal,
  treeState: TreeState,
  entry: Extract<Awaited<ReturnType<typeof enterGoal>>, { kind: 'ready' }>,
) {
  const brainConfig = (deps.brain as { config?: { modelByTier?: Record<string, string> } }).config;
  const decision = await resolveDecisionPhase({
    goal,
    typeDef: entry.typeDef,
    tier: entry.tier,
    registry: deps.registry,
    brain: deps.brain,
    store: deps.store,
    now: deps.now,
    patterns: deps.patterns,
    goldenCapture: deps.goldenCapture,
    ...(brainConfig !== undefined ? { brainConfig } : {}),
    skillForGoalType: deps.decideSkillBlock,
    repoShapeForGoal: deps.repoShapeHint,
    ...(deps.activeWorktree()?.repoRoot !== undefined
      ? { repoRoot: deps.activeWorktree()!.repoRoot }
      : {}),
    ...(deps.knowledge !== undefined ? { knowledge: deps.knowledge } : {}),
    debitUsage: (usage: Usage) => debitTreeState(treeState, usage),
    hasReachedCeiling: () => hasReachedSpendCeiling(treeState),
  });
  return decision.kind === 'ready'
    ? { ...decision, entry }
    : decision;
}

function assertNever(value: never): never {
  throw new Error(`Unhandled decision: ${JSON.stringify(value)}`);
}

function runBlockFor(
  deps: RecursiveRunnerDeps,
  goal: Goal,
  brief: DecisionBrief,
): Promise<Report> {
  return runBlock({
    goal,
    brief,
    store: deps.store,
    now: deps.now,
    onBrief: deps.onBrief(),
  });
}

function runCeilingReport(
  deps: RecursiveRunnerDeps,
  goal: Goal,
  treeState: TreeState,
): Promise<Report> {
  return ceilingReport({
    goal,
    treeState,
    store: deps.store,
    now: deps.now,
    onBrief: deps.onBrief(),
  });
}
