import type { Brain } from '../contract/brain.js';
import type { ChildPlan } from '../contract/decision.js';
import type { EventStore } from '../contract/events.js';
import type { Goal } from '../contract/goal.js';
import type { CheckContext, Registry } from '../contract/goal-type.js';
import type { MemoryView } from '../contract/memory.js';
import type { Artifact, Report } from '../contract/report.js';
import type { FactsForRegions } from './knowledge-memory.js';
import {
  appendChildSpawnedEvents,
  buildSplitChildGoals,
  runSplitChildren,
} from './split-children.js';
import {
  buildSplitRoundReport,
  childOutcomes,
  promoteChildReports,
} from './split-report.js';
import {
  judgeSplitIntegration,
  mergeComprehendChildArtifacts,
  mergeGenericChildArtifacts,
} from './split-integration.js';
import { worktreeFilesArtifact, type TreeWorktree } from './worktree.js';

export interface SplitRoundResult {
  report: Report;
  mergedArtifact: Artifact | null;
  passingCount: number;
  childOutcomes: { plan: ChildPlan; report: Report }[];
}

export async function runSplitRound(params: {
  goal: Goal;
  children: ChildPlan[];
  extraFindings?: string[];
  memory: MemoryView;
  registry: Registry;
  brain: Brain;
  goldenCapture: boolean;
  store: EventStore;
  now: () => number;
  activeRepoRoot: string | undefined;
  worktree: TreeWorktree | undefined;
  factsForRegions: FactsForRegions | undefined;
  headSha: ((repoRoot: string) => Promise<string>) | undefined;
  checkContext: CheckContext | undefined;
  persist: (goal: Goal, artifact: Artifact) => Promise<void>;
  runChild: (goal: Goal) => Promise<Report>;
}): Promise<SplitRoundResult> {
  const childGoals = await buildSplitChildGoals({
    parent: params.goal,
    children: params.children,
    memory: params.memory,
  });
  await appendChildSpawnedEvents({
    parent: params.goal,
    children: params.children,
    childGoals,
    store: params.store,
    now: params.now,
  });

  // ADR-040: dive facts are injected at child-run time, after dependency dives
  // have executed and persisted their RegionFacts. All child goals are built
  // before siblings run, so construction-time injection would be stale.
  const childReports = await runSplitChildren({
    parent: params.goal,
    children: params.children,
    childGoals,
    store: params.store,
    now: params.now,
    repoRoot: splitRoundRepoRoot(params.goal, params.activeRepoRoot),
    factsForRegions: params.factsForRegions,
    headSha: params.headSha,
    runChild: params.runChild,
  });

  const comprehendMerge = await mergeComprehendChildArtifacts({
    goal: params.goal,
    typeDef: params.registry.get(params.goal.type),
    childReports,
    activeRepoRoot: params.activeRepoRoot,
    headSha: params.headSha,
    checkContext: params.checkContext,
    store: params.store,
    now: params.now,
    persist: params.persist,
  });
  // For a sandboxed tree the WORKTREE is the delivered state: rounds commit as
  // they go and salvage preserves partial work, so child emissions understate
  // (and can double-ship) what the branch actually carries. Derive the merged
  // files artifact from the tree's changed files — one content per path — so
  // the integration/acceptance judges assess what was actually delivered.
  // Comprehend merges (knowledge artifacts) and worktree-less trees keep the
  // emission-derived merge.
  const worktreeDerived =
    comprehendMerge.kind === 'skipped' && params.worktree !== undefined
      ? worktreeFilesArtifact(params.worktree.root, params.worktree.baseSha)
      : null;
  const mergedArtifact =
    comprehendMerge.kind === 'handled'
      ? comprehendMerge.mergedArtifact
      : worktreeDerived ?? mergeGenericChildArtifacts(childReports);
  const comprehendFindings =
    comprehendMerge.kind === 'handled' ? comprehendMerge.findings : [];
  const comprehendBlockers =
    comprehendMerge.kind === 'handled' ? comprehendMerge.blockers : [];

  const brainConfig = (params.brain as { config?: { modelByTier?: Record<string, string> } }).config;
  const integration = await judgeSplitIntegration({
    goal: params.goal,
    artifact: mergedArtifact,
    registry: params.registry,
    brain: params.brain,
    goldenCapture: params.goldenCapture,
    store: params.store,
    now: params.now,
    ...(brainConfig !== undefined ? { brainConfig } : {}),
  });

  const promotion = await promoteChildReports({
    childGoals,
    childReports,
    store: params.store,
    now: params.now,
  });
  const report = buildSplitRoundReport({
    mergedArtifact,
    childReports,
    promotion,
    extraFindings: params.extraFindings ?? [],
    integrationFindings: integration.findings,
    integrationBlockers: integration.blockers,
    comprehendFindings,
    comprehendBlockers,
  });

  return {
    report,
    mergedArtifact,
    passingCount: 0,
    childOutcomes: childOutcomes(params.children, childReports),
  };
}

function splitRoundRepoRoot(goal: Goal, activeRepoRoot: string | undefined): string {
  const specRepoRoot = (goal.spec as Record<string, unknown>)['repoRoot'];
  return activeRepoRoot ?? (typeof specRepoRoot === 'string' ? specRepoRoot : '');
}
