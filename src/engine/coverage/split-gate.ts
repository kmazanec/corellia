import type { ChildPlan } from '../../contract/decision.js';
import type { EventStore } from '../../contract/events.js';
import type { Goal } from '../../contract/goal.js';
import type { GoalTypeDef, Registry } from '../../contract/goal-type.js';
import type { KnowledgeArtifact } from '../../contract/knowledge.js';
import {
  coverageCheck,
  type CoverageGoal,
  type KnowledgeForCoverage,
  type MissingRequirement,
} from '../../library/coverage.js';
import { checkpointVerifyArtifacts } from '../coverage-checkpoint.js';
import {
  filterMissingCoveredByRefresh,
  gateMissingLabels,
  injectCoverageChildren,
} from '../coverage-gate.js';

export interface KnowledgeCoverageGateway {
  query: (repoRoot: string) => Promise<KnowledgeForCoverage>;
  validate: (artifact: KnowledgeArtifact) => Promise<boolean>;
  mintComprehension: (missing: MissingRequirement[]) => ChildPlan[];
  regionExists?: (repoRoot: string, region: string) => boolean;
}

export async function runKnowledgeCoverageSplitGate(params: {
  goal: Goal;
  kind: GoalTypeDef['kind'];
  children: ChildPlan[];
  repoRoot: string;
  knowledge: KnowledgeCoverageGateway;
  registry: Registry;
  store: EventStore;
  now: () => number;
}): Promise<ChildPlan[]> {
  const knowledgeState = await params.knowledge.query(params.repoRoot);
  const { refreshChildren, validatedOk, refreshedCategories } =
    await checkpointVerifyArtifacts({
      goal: params.goal,
      knowledge: knowledgeState,
      repoRoot: params.repoRoot,
      knowledgeGateway: params.knowledge,
      store: params.store,
      now: params.now,
    });

  const coverageGoal = buildCoverageGoal({
    goal: params.goal,
    kind: params.kind,
    children: params.children,
    repoRoot: params.repoRoot,
    registry: params.registry,
    ...(params.knowledge.regionExists !== undefined
      ? { regionExists: params.knowledge.regionExists }
      : {}),
  });
  const result = coverageCheck(coverageGoal, knowledgeState, validatedOk);
  const filteredMissing = filterMissingCoveredByRefresh(
    result.missing,
    refreshedCategories,
  );
  const filteredResult = {
    ok: filteredMissing.length === 0,
    missing: filteredMissing,
  };

  await params.store.append({
    type: 'gate-checked',
    at: params.now(),
    goalId: params.goal.id,
    ok: filteredResult.ok && refreshChildren.length === 0,
    missing: gateMissingLabels(filteredResult.missing, refreshChildren),
  });

  if (filteredResult.ok && refreshChildren.length === 0) {
    return params.children;
  }

  return injectCoverageChildren({
    children: params.children,
    missing: filteredResult.missing,
    refreshChildren,
    mintComprehension: params.knowledge.mintComprehension,
    resolveType: (type) =>
      params.registry.has(type) ? params.registry.get(type) : undefined,
  });
}

export function buildCoverageGoal(params: {
  goal: Goal;
  kind: GoalTypeDef['kind'];
  children: ChildPlan[];
  repoRoot: string;
  registry: Registry;
  regionExists?: (repoRoot: string, region: string) => boolean;
}): CoverageGoal {
  const childScopeEntries = makeLeafChildScopes(params.children, params.registry);
  const effectiveScope =
    childScopeEntries.length > 0
      ? [...params.goal.scope, ...childScopeEntries]
      : params.goal.scope;

  const regionExists = params.regionExists ?? (() => true);
  const existsByRegion = Object.fromEntries(
    effectiveScope.map((scopeEntry) => {
      const region = scopeEntry.replace(/\/$/, '');
      return [region, regionExists(params.repoRoot, region)];
    }),
  );

  return {
    kind: params.kind,
    isRootSplit: childScopeEntries.length === 0 && !params.registry.get(params.goal.type).leafOnly,
    scope: effectiveScope,
    typeName: params.goal.type,
    existsByRegion,
  };
}

function makeLeafChildScopes(children: ChildPlan[], registry: Registry): string[] {
  return children.flatMap((child) => {
    if (!registry.has(child.type)) return [];
    const childDef = registry.get(child.type);
    return childDef.kind === 'make' && childDef.leafOnly ? child.scope : [];
  });
}
