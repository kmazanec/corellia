import type { Brain } from '../contract/brain.js';
import type { DecisionBrief } from '../contract/decision.js';
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
import { resolveDecisionPhase } from './decision/phase.js';
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
  deps: Parameters<typeof createRecursiveRunner>[0],
  goal: Goal,
  treeState: TreeState,
): Promise<Report> {
  const entry = await enterGoal({
    goal,
    registry: deps.registry,
    store: deps.store,
    now: deps.now,
    sensitivity: deps.sensitivity,
    onGate: deps.onGate,
    onBrief: deps.onBrief(),
    hasReachedCeiling: () => hasReachedSpendCeiling(treeState),
  });
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

  await deps.store.append({
    type: 'decided',
    at: deps.now(),
    goalId: goal.id,
    decision: decision.decision,
    ...(decision.decideUsage !== undefined ? { usage: decision.decideUsage } : {}),
  });

  switch (decision.decision.kind) {
    case 'satisfy':
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

    case 'split': {
      const splitRunner = createSplitRunner({
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
        ceilingReachedOnce: (ceilingGoal, ceilingTreeState) =>
          ceilingReachedOnce({
            goal: ceilingGoal,
            treeState: ceilingTreeState,
            store: deps.store,
            now: deps.now,
          }),
        ceilingReport: (ceilingGoal, ceilingTreeState) =>
          runCeilingReport(deps, ceilingGoal, ceilingTreeState),
      });
      return runSplitDispatch({
        goal,
        typeDef: decision.entry.typeDef,
        decision: decision.decision,
        terracedLoserFindings: decision.terracedLoserFindings,
        goalShape: decision.goalShape,
        repoRoot: deps.activeWorktree()?.repoRoot,
        knowledge: deps.knowledge,
        patterns: deps.patterns,
        registry: deps.registry,
        store: deps.store,
        now: deps.now,
        runMilestone: (children) => splitRunner.runMilestone(goal, children, treeState),
        runSplit: (children, findings) =>
          splitRunner.runSplit(goal, children, findings, treeState),
      });
    }

    case 'block':
      return runBlockFor(deps, goal, decision.decision.brief);

    default:
      return assertNever(decision.decision);
  }
}

async function decideGoal(
  deps: Parameters<typeof createRecursiveRunner>[0],
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
  deps: Parameters<typeof createRecursiveRunner>[0],
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
  deps: Parameters<typeof createRecursiveRunner>[0],
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
