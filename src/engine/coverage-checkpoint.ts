import type { ChildPlan } from '../contract/decision.js';
import type { EventStore } from '../contract/events.js';
import type { Goal } from '../contract/goal.js';
import type { KnowledgeArtifact, KnowledgeCategory } from '../contract/knowledge.js';
import type { KnowledgeForCoverage, MissingRequirement } from '../library/coverage.js';

export interface CoverageCheckpointKnowledge {
  validate: (artifact: KnowledgeArtifact) => Promise<boolean>;
  mintComprehension: (missing: MissingRequirement[]) => ChildPlan[];
}

export interface CoverageCheckpointResult {
  refreshChildren: ChildPlan[];
  validatedOk: Set<KnowledgeCategory>;
  refreshedCategories: Set<KnowledgeCategory>;
}

export async function checkpointVerifyArtifacts(params: {
  goal: Goal;
  knowledge: KnowledgeForCoverage;
  repoRoot: string;
  knowledgeGateway: CoverageCheckpointKnowledge;
  store: EventStore;
  now: () => number;
}): Promise<CoverageCheckpointResult> {
  const refreshChildren: ChildPlan[] = [];
  const validatedOk = new Set<KnowledgeCategory>();
  const refreshedCategories = new Set<KnowledgeCategory>();

  for (const artifact of params.knowledge.artifacts) {
    if (artifact.generatedAtSha === params.knowledge.headSha) continue;

    const fullArtifact: KnowledgeArtifact = {
      repoRoot: params.repoRoot,
      category: artifact.category,
      generatedAtSha: artifact.generatedAtSha,
      confidence: 'medium',
      status: 'provisional',
      pointers: [],
      summary: '',
    };

    if (await params.knowledgeGateway.validate(fullArtifact)) {
      await params.store.append({
        type: 'knowledge-checked',
        at: params.now(),
        goalId: params.goal.id,
        repoRoot: params.repoRoot,
        category: artifact.category,
        sha: artifact.generatedAtSha,
        outcome: 'stale-validated',
      });
      validatedOk.add(artifact.category);
      continue;
    }

    await params.store.append({
      type: 'knowledge-checked',
      at: params.now(),
      goalId: params.goal.id,
      repoRoot: params.repoRoot,
      category: artifact.category,
      sha: artifact.generatedAtSha,
      outcome: 'invalid',
    });

    const refreshMissing: MissingRequirement[] = [{
      category: artifact.category,
      reason: `SHA-drift validation failed for ${artifact.category} at ${artifact.generatedAtSha}`,
    }];
    refreshChildren.push(...params.knowledgeGateway.mintComprehension(refreshMissing));
    refreshedCategories.add(artifact.category);
  }

  return { refreshChildren, validatedOk, refreshedCategories };
}
