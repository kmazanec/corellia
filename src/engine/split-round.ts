import type { Brain } from '../contract/brain.js';
import type { ChildPlan } from '../contract/decision.js';
import type { EventStore } from '../contract/events.js';
import type { Goal } from '../contract/goal.js';
import type { CheckContext, Registry } from '../contract/goal-type.js';
import type { MemoryView } from '../contract/memory.js';
import type { Artifact, Report } from '../contract/report.js';
import type { FactsForRegions } from './knowledge-memory.js';
import type { RegionScanner } from './structural-floor.js';
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
  type ComprehendMergeResult,
  type SplitIntegrationJudgment,
} from './split-integration.js';
import { repairIntegration } from './repair-integration.js';
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
  /** The shared type/global memory store (ADR-049); omit to keep every layer in `store`. */
  sharedStore?: EventStore;
  now: () => number;
  activeRepoRoot: string | undefined;
  worktree: TreeWorktree | undefined;
  factsForRegions: FactsForRegions | undefined;
  headSha: ((repoRoot: string) => Promise<string>) | undefined;
  regionScanner: RegionScanner | undefined;
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
    regionScanner: params.regionScanner,
    kindOf: (typeName: string) =>
      params.registry.has(typeName) ? params.registry.get(typeName).kind : undefined,
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
  const comprehendFindings =
    comprehendMerge.kind === 'handled' ? comprehendMerge.findings : [];
  const comprehendBlockers =
    comprehendMerge.kind === 'handled' ? comprehendMerge.blockers : [];

  const { mergedArtifact, integration } = await integrateWithRepair({
    ...params,
    comprehendMerge,
    childReports,
  });

  const promotion = await promoteChildReports({
    childGoals,
    childReports,
    store: params.store,
    ...(params.sharedStore !== undefined ? { sharedStore: params.sharedStore } : {}),
    now: params.now,
  });
  const report = buildSplitRoundReport({
    mergedArtifact,
    childGoals,
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

interface IntegrateResult {
  mergedArtifact: Artifact | null;
  integration: SplitIntegrationJudgment;
}

/**
 * The integrate edge: judge the assembled tree, and if the judge fails with an
 * actionable verdict, run the repair rung once (ADR-047) and re-judge the
 * repaired tree. A cross-module seam bug the integration judge finds has no leaf
 * that owns the fix, so it used to be terminal; the rung spawns ONE implement
 * child scoped to the union of the failing children's scopes, fed the verdict's
 * findings. Escalated findings are not repaired (they skip straight to block,
 * handled inside `repairIntegration`); a second failure returns the failing
 * judgment for the round to block on.
 */
async function integrateWithRepair(params: {
  goal: Goal;
  children: ChildPlan[];
  memory: MemoryView;
  registry: Registry;
  brain: Brain;
  goldenCapture: boolean;
  store: EventStore;
  now: () => number;
  worktree: TreeWorktree | undefined;
  comprehendMerge: ComprehendMergeResult;
  childReports: Report[];
  runChild: (goal: Goal) => Promise<Report>;
}): Promise<IntegrateResult> {
  const first = await integrateAndJudge(params);

  const repair = await repairIntegration({
    goal: params.goal,
    verdict: first.integration.verdict,
    children: params.children,
    memory: params.memory,
    store: params.store,
    now: params.now,
    runChild: params.runChild,
  });

  return repair.repaired ? integrateAndJudge(params) : first;
}

/**
 * Derive the integrated artifact and run the integration judge over it. Called
 * once for the initial integrate, and again after the repair rung edits the tree
 * so the re-judge sees the repaired state.
 *
 * For a sandboxed tree the WORKTREE is the delivered state: rounds commit as they
 * go and salvage preserves partial work, so child emissions understate (and can
 * double-ship) what the branch actually carries. Derive the merged files artifact
 * from the tree's changed files — one content per path — so the integration judge
 * assesses what was actually delivered. Comprehend merges (knowledge artifacts)
 * and worktree-less trees keep the emission-derived merge.
 */
async function integrateAndJudge(params: {
  goal: Goal;
  registry: Registry;
  brain: Brain;
  goldenCapture: boolean;
  store: EventStore;
  now: () => number;
  worktree: TreeWorktree | undefined;
  comprehendMerge: ComprehendMergeResult;
  childReports: Report[];
}): Promise<{ mergedArtifact: Artifact | null; integration: SplitIntegrationJudgment }> {
  const worktreeDerived =
    params.comprehendMerge.kind === 'skipped' && params.worktree !== undefined
      ? worktreeFilesArtifact(params.worktree.root, params.worktree.baseSha)
      : null;
  const mergedArtifact =
    params.comprehendMerge.kind === 'handled'
      ? params.comprehendMerge.mergedArtifact
      : worktreeDerived ?? mergeGenericChildArtifacts(params.childReports);

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

  return { mergedArtifact, integration };
}

function splitRoundRepoRoot(goal: Goal, activeRepoRoot: string | undefined): string {
  const specRepoRoot = (goal.spec as Record<string, unknown>)['repoRoot'];
  return activeRepoRoot ?? (typeof specRepoRoot === 'string' ? specRepoRoot : '');
}
