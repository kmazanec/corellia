import type { Brain } from '../contract/brain.js';
import type { ChildPlan } from '../contract/decision.js';
import type { EventStore } from '../contract/events.js';
import type { Goal, Usage } from '../contract/goal.js';
import type { CheckContext, Registry } from '../contract/goal-type.js';
import type { MemoryView } from '../contract/memory.js';
import type { Artifact, Report } from '../contract/report.js';
import type {
  CheckpointShaMemo,
  CheckpointVerifyGateway,
} from './checkpoint-verify.js';
import type { FactsForRegions } from './knowledge-memory.js';
import type { RegionScanner } from './structural-floor.js';
import {
  runMilestoneLoop,
  type MilestoneRoundResult,
} from './milestone/loop.js';
import {
  assessMilestoneRound,
  type RoundAssessment,
} from './milestone/round-assessment.js';
import { reDecideMilestoneRound } from './milestone/redecide-round.js';
import { runSplitRound } from './split-round.js';
import { debitTreeState, type TreeState } from './tree-spend.js';
import { commitRound, type TreeWorktree } from './worktree.js';

export interface SplitRunner {
  runSplit: (
    goal: Goal,
    children: ChildPlan[],
    extraFindings: string[],
    treeState: TreeState,
  ) => Promise<Report>;
  runMilestone: (
    goal: Goal,
    children: ChildPlan[],
    treeState: TreeState,
  ) => Promise<Report>;
}

export function createSplitRunner(deps: {
  memory: MemoryView;
  registry: Registry;
  brain: Brain;
  goldenCapture: boolean;
  store: EventStore;
  /** The shared type/global memory store (ADR-049), threaded to the promote edge. */
  sharedStore?: EventStore;
  now: () => number;
  activeWorktree: () => TreeWorktree | undefined;
  factsForRegions: FactsForRegions | undefined;
  headSha: ((repoRoot: string) => Promise<string>) | undefined;
  /**
   * The full knowledge gateway the integrate checkpoint re-reads facts through
   * (verify-on-read). Undefined ⇒ no knowledge wiring, so the checkpoint is a
   * no-op and the integrate judge runs exactly as before.
   */
  checkpointKnowledge: CheckpointVerifyGateway | undefined;
  /** The tree's HEAD-SHA memo, shared across decide / split / integrate checkpoints. */
  checkpointShaMemo: CheckpointShaMemo;
  regionScanner: RegionScanner | undefined;
  checkContextFor: (goalId: string) => CheckContext | undefined;
  persistLeafKnowledge: (goal: Goal, artifact: Artifact) => Promise<void>;
  runChild: (goal: Goal, treeState: TreeState) => Promise<Report>;
  decideSkillBlock: (goalType: string) => string | undefined;
  ceilingReachedOnce: (goal: Goal, treeState: TreeState) => Promise<void>;
  ceilingReport: (goal: Goal, treeState: TreeState) => Promise<Report>;
}): SplitRunner {
  const runRound = (
    goal: Goal,
    children: ChildPlan[],
    extraFindings: string[],
    treeState: TreeState,
  ): Promise<MilestoneRoundResult> =>
    runSplitRound({
      goal,
      children,
      extraFindings,
      memory: deps.memory,
      registry: deps.registry,
      brain: deps.brain,
      goldenCapture: deps.goldenCapture,
      store: deps.store,
      ...(deps.sharedStore !== undefined ? { sharedStore: deps.sharedStore } : {}),
      now: deps.now,
      activeRepoRoot: deps.activeWorktree()?.repoRoot,
      worktree: deps.activeWorktree(),
      factsForRegions: deps.factsForRegions,
      headSha: deps.headSha,
      checkpointKnowledge: deps.checkpointKnowledge,
      checkpointShaMemo: deps.checkpointShaMemo,
      regionScanner: deps.regionScanner,
      checkContext: deps.checkContextFor(goal.id),
      persist: deps.persistLeafKnowledge,
      runChild: (childGoal) => deps.runChild(childGoal, treeState),
    });

  const reDecideRound = (
    goal: Goal,
    treeState: TreeState,
    priorAssessment: RoundAssessment,
    priorRoundRef: string | null,
  ) =>
    reDecideMilestoneRound({
      goal,
      priorAssessment,
      priorRoundRef,
      worktreeRoot: deps.activeWorktree()?.root,
      registry: deps.registry,
      brain: deps.brain,
      store: deps.store,
      now: deps.now,
      decideSkill: deps.decideSkillBlock(goal.type),
      tier: deps.registry.get(goal.type).tier.default,
      debitUsage: (usage: Usage) => debitTreeState(treeState, usage),
    });

  const assessRound = (
    goal: Goal,
    criteriaArtifact: Artifact | null,
    mergedArtifact: Artifact | null,
    treeState: TreeState,
  ) => {
    const brainConfig = (deps.brain as { config?: { modelByTier?: Record<string, string> } }).config;
    return assessMilestoneRound({
      goal,
      criteriaArtifact,
      mergedArtifact,
      registry: deps.registry,
      brain: deps.brain,
      store: deps.store,
      now: deps.now,
      checkContext: deps.checkContextFor(goal.id),
      goldenCapture: deps.goldenCapture,
      ...(brainConfig !== undefined ? { brainConfig } : {}),
      debitUsage: (usage: Usage) => debitTreeState(treeState, usage),
    });
  };

  return {
    async runSplit(goal, children, extraFindings, treeState) {
      const { report } = await runRound(goal, children, extraFindings, treeState);
      await deps.store.append({ type: 'emitted', at: deps.now(), goalId: goal.id, report });
      return report;
    },

    async runMilestone(goal, children, treeState) {
      const iterative = deps.registry.get(goal.type).iterative!; // dispatch guard guarantees presence
      const effectiveMaxRounds = goal.maxRounds ?? iterative.maxRounds;
      return runMilestoneLoop({
        goal,
        initialChildren: children,
        effectiveMaxRounds,
        treeState,
        store: deps.store,
        now: deps.now,
        runRound: (roundChildren) => runRound(goal, roundChildren, [], treeState),
        reDecideRound: (priorAssessment, priorRoundRef) =>
          reDecideRound(goal, treeState, priorAssessment, priorRoundRef),
        persistCriteria: (artifact) => deps.persistLeafKnowledge(goal, artifact),
        commitRound: (roundIndex) => commitRoundIfWorktree(deps.activeWorktree(), roundIndex, goal.title, goal.scope),
        assessRound: (criteriaArtifact, mergedArtifact) =>
          assessRound(goal, criteriaArtifact, mergedArtifact, treeState),
        ceilingReachedOnce: () => deps.ceilingReachedOnce(goal, treeState),
        ceilingReport: () => deps.ceilingReport(goal, treeState),
      });
    },
  };
}

function commitRoundIfWorktree(
  worktree: TreeWorktree | undefined,
  roundIndex: number,
  title: string,
  scope: string[],
): string | null {
  return worktree === undefined ? null : commitRound(worktree, roundIndex, title, scope);
}
