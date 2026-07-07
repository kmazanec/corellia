import type { Brain, BrainContext } from '../../contract/brain.js';
import type { DeclaredCaptures } from '../../contract/capture.js';
import type { EventStore } from '../../contract/events.js';
import type { Goal, Tier, Usage } from '../../contract/goal.js';
import type { CheckContext, Registry } from '../../contract/goal-type.js';
import type { Artifact } from '../../contract/report.js';
import type { Verdict } from '../../contract/verdict.js';
import {
  criterionToCheck,
  parseAcceptanceCriteria,
  type AcceptanceCriterion,
} from '../../library/acceptance-criteria.js';
import { criteriaNeedVision } from '../../library/capture-vision.js';
import { appendGoldenCandidate, enrichRubric } from '../judge-support.js';

export interface RoundAssessment {
  passingCount: number;
  criteriaTotal: number;
  judgeVerdict: Verdict;
  criteria: AcceptanceCriterion[];
  checkResults: { id: string; ok: boolean; detail: string }[];
  diffDigest: string[];
}

export async function assessMilestoneRound(params: {
  goal: Goal;
  criteriaArtifact: Artifact | null;
  mergedArtifact: Artifact | null;
  registry: Registry;
  brain: Brain;
  store: EventStore;
  now: () => number;
  checkContext: CheckContext | undefined;
  goldenCapture: boolean;
  brainConfig?: { modelByTier?: Record<string, string> };
  debitUsage: (usage: Usage) => void;
}): Promise<RoundAssessment> {
  const parsed = parseAcceptanceCriteria(params.criteriaArtifact);
  const criteria = parsed.ok ? parsed.criteria : [];
  const checkResults = await runCriteriaChecks({
    goal: params.goal,
    artifact: params.mergedArtifact,
    criteria,
    checkContext: params.checkContext,
  });

  const passingCount = checkResults.filter((result) => result.ok).length;
  const judgeVerdict = await judgeAcceptanceIfAvailable({
    ...params,
    criteria,
    checkResults,
    declaredCaptures: params.checkContext?.declaredCaptures,
  });
  const diffDigest = checkResults
    .filter((result) => !result.ok)
    .map((result) => `unmet:${result.id}`);

  return {
    passingCount,
    criteriaTotal: criteria.length,
    judgeVerdict,
    criteria,
    checkResults,
    diffDigest,
  };
}

export function iterativeAcceptanceJudge(registry: Registry, goalType: string): string {
  return registry.get(goalType).iterative!.acceptanceJudge;
}

async function runCriteriaChecks(params: {
  goal: Goal;
  artifact: Artifact | null;
  criteria: AcceptanceCriterion[];
  checkContext: CheckContext | undefined;
}): Promise<{ id: string; ok: boolean; detail: string }[]> {
  const results: { id: string; ok: boolean; detail: string }[] = [];
  for (const criterion of params.criteria) {
    const result = await criterionToCheck(criterion).run(
      params.goal,
      params.artifact,
      params.checkContext,
    );
    results.push({ id: criterion.id, ok: result.ok, detail: result.detail });
  }
  return results;
}

async function judgeAcceptanceIfAvailable(params: {
  goal: Goal;
  mergedArtifact: Artifact | null;
  criteria: AcceptanceCriterion[];
  checkResults: { id: string; ok: boolean; detail: string }[];
  registry: Registry;
  brain: Brain;
  store: EventStore;
  now: () => number;
  goldenCapture: boolean;
  brainConfig?: { modelByTier?: Record<string, string> };
  declaredCaptures: DeclaredCaptures | undefined;
  debitUsage: (usage: Usage) => void;
}): Promise<Verdict> {
  const judgeType = iterativeAcceptanceJudge(params.registry, params.goal.type);
  if (!params.registry.has(judgeType) || params.mergedArtifact === null) {
    return { pass: false, findings: [] };
  }

  const rubric = enrichRubric(
    params.registry,
    `Are the frozen acceptance criteria satisfied to a shippable bar for the intent: "${params.goal.title}"?\n\nFrozen criteria and this round's deterministic check results:\n${criteriaSummary(params.criteria, params.checkResults)}`,
    judgeType,
    params.goal.intent,
  );
  const judgeTier = params.registry.get(judgeType).tier.default;
  const judgeCtx: BrainContext = {
    tier: judgeTier,
    memories: params.goal.memories,
    // A `{ capture }` criterion feeding the judge an image (render-document,
    // screenshot-ui) forces a vision-capable model regardless of band (ADR-042 ×
    // ADR-044); absent an image-producing capture the judge resolves as usual.
    ...(criteriaNeedVision(params.criteria, params.declaredCaptures)
      ? { needs: { vision: true } }
      : {}),
  };
  const { value, usage } = await params.brain.judge(
    params.goal,
    params.mergedArtifact,
    rubric,
    judgeCtx,
  );

  if (params.goldenCapture) {
    await params.store.append({
      type: 'judge-verdict',
      at: params.now(),
      goalId: params.goal.id,
      judgeType,
      verdict: value,
      tier: judgeTier,
      usage,
    });
    await appendGoldenCandidate({
      enabled: params.goldenCapture,
      store: params.store,
      now: params.now,
      goalId: params.goal.id,
      judgeType,
      artifact: params.mergedArtifact,
      rubric,
      verdict: value,
      tier: judgeTier,
      ...(params.brainConfig !== undefined ? { brainConfig: params.brainConfig } : {}),
    });
  }

  params.debitUsage(usage);
  return value;
}

function criteriaSummary(
  criteria: AcceptanceCriterion[],
  checkResults: { id: string; ok: boolean; detail: string }[],
): string {
  return criteria
    .map((criterion) => {
      const result = checkResults.find((candidate) => candidate.id === criterion.id);
      return `- [${result?.ok ? 'PASS' : 'FAIL'}] ${criterion.id}: ${criterion.claim} (${result?.detail ?? 'not run'})`;
    })
    .join('\n');
}
