import type { EventStore } from '../contract/events.js';
import type { Goal } from '../contract/goal.js';
import type { CheckContext, GoalTypeDef } from '../contract/goal-type.js';
import type { Artifact, Report } from '../contract/report.js';
import type { Verdict } from '../contract/verdict.js';
import { childShaFallback, mergeComprehensionArtifacts } from '../library/comprehend-merge.js';

export interface ComprehendMergeHandled {
  kind: 'handled';
  mergedArtifact: Artifact | null;
  blockers: string[];
  findings: string[];
}

export interface ComprehendMergeSkipped {
  kind: 'skipped';
}

export type ComprehendMergeResult = ComprehendMergeHandled | ComprehendMergeSkipped;

export function mergeGenericChildArtifacts(childReports: Report[]): Artifact | null {
  const allFiles: { path: string; content: string }[] = [];
  const allTexts: string[] = [];

  for (const report of childReports) {
    if (report.artifact === null) continue;
    if (report.artifact.kind === 'files' && report.artifact.files) {
      allFiles.push(...report.artifact.files);
    } else if (report.artifact.kind === 'text' && report.artifact.text) {
      allTexts.push(report.artifact.text);
    }
  }

  if (allFiles.length > 0) return { kind: 'files', files: allFiles };
  if (allTexts.length > 0) return { kind: 'text', text: allTexts.join('\n') };
  return null;
}

export async function mergeComprehendChildArtifacts(params: {
  goal: Goal;
  typeDef: GoalTypeDef;
  childReports: Report[];
  activeRepoRoot: string | undefined;
  headSha: ((repoRoot: string) => Promise<string>) | undefined;
  checkContext: CheckContext | undefined;
  store: EventStore;
  now: () => number;
  persist: (goal: Goal, artifact: Artifact) => Promise<void>;
}): Promise<ComprehendMergeResult> {
  const comprehendType = comprehendMergeType(params.goal, params.typeDef);
  if (comprehendType === null) return { kind: 'skipped' };

  const childArtifacts = params.childReports.map((report) => report.artifact);
  const headSha = await resolveMergeHeadSha({
    goal: params.goal,
    activeRepoRoot: params.activeRepoRoot,
    headSha: params.headSha,
    childArtifacts,
    comprehendType,
  });
  const merged = mergeComprehensionArtifacts(comprehendType, childArtifacts, headSha);
  if (merged === null) {
    return { kind: 'handled', mergedArtifact: null, blockers: [], findings: [] };
  }

  const findings: string[] = [];
  let allOk = true;
  for (const check of params.typeDef.deterministic) {
    const result = await check.run(params.goal, merged, params.checkContext);
    if (!result.ok) {
      allOk = false;
      findings.push(`comprehend-merge ${check.name}: ${result.detail}`);
    }
  }

  const mergeVerdict: Verdict = {
    pass: allOk,
    findings: [],
    ...(allOk ? {} : { failureSignature: `comprehend-merge:${findings.join(',')}` }),
  };
  await params.store.append({
    type: 'deterministic-checked',
    at: params.now(),
    goalId: params.goal.id,
    verdict: mergeVerdict,
  });

  if (!allOk) {
    return {
      kind: 'handled',
      mergedArtifact: null,
      blockers: [`Comprehension integrate merge failed its deterministic gate: ${findings.join('; ')}`],
      findings,
    };
  }

  await params.persist(params.goal, merged);
  return { kind: 'handled', mergedArtifact: merged, blockers: [], findings };
}

function comprehendMergeType(
  goal: Goal,
  typeDef: GoalTypeDef,
): 'map-repo' | 'deep-dive-region' | null {
  return typeDef.family === 'comprehend' &&
    (goal.type === 'map-repo' || goal.type === 'deep-dive-region')
    ? goal.type
    : null;
}

async function resolveMergeHeadSha(params: {
  goal: Goal;
  activeRepoRoot: string | undefined;
  headSha: ((repoRoot: string) => Promise<string>) | undefined;
  childArtifacts: (Artifact | null)[];
  comprehendType: 'map-repo' | 'deep-dive-region';
}): Promise<string> {
  const specRepoRoot = (params.goal.spec as Record<string, unknown>)['repoRoot'];
  const repoRoot = params.activeRepoRoot ?? (typeof specRepoRoot === 'string' ? specRepoRoot : '');
  if (params.headSha !== undefined && repoRoot.length > 0) {
    try {
      const sha = await params.headSha(repoRoot);
      if (sha.length > 0) return sha;
    } catch {
      // Fall through to child artifact SHA fallback.
    }
  }
  return childShaFallback(params.childArtifacts, params.comprehendType);
}
