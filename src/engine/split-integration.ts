import type { EventStore } from '../contract/events.js';
import type { Goal } from '../contract/goal.js';
import type { Brain, BrainContext } from '../contract/brain.js';
import type { CheckContext, GoalTypeDef, Registry } from '../contract/goal-type.js';
import type { Artifact, Report } from '../contract/report.js';
import type { Verdict } from '../contract/verdict.js';
import { childShaFallback, mergeComprehensionArtifacts } from '../library/comprehend-merge.js';
import { appendGoldenCandidate, enrichRubric } from './judge-support.js';

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

export interface SplitIntegrationJudgment {
  findings: string[];
  blockers: string[];
  /**
   * The judge's structured verdict when one was rendered, so the repair rung can
   * read its findings' prescriptions and `escalated` flags. Absent when the judge
   * did not run (no `judge-integration` type, a null artifact, or a terminal
   * provider error degraded to a blocker).
   */
  verdict?: Verdict;
}

/**
 * A provider error that retrying cannot fix — a 4xx the brain surfaces as
 * `LLM request failed (<status>): …`. The size-limit case (400 "input size
 * exceeds N MB") is the motivating one: identical on retry, so the integration
 * judge degrades to a blocker rather than letting it crash the tree.
 */
function isTerminalProviderError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const m = /LLM request failed \((\d{3})\)/.exec(err.message);
  if (m === null) return false;
  const status = Number(m[1]);
  return status >= 400 && status < 500;
}

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

export async function judgeSplitIntegration(params: {
  goal: Goal;
  artifact: Artifact | null;
  registry: Registry;
  brain: Brain;
  goldenCapture: boolean;
  store: EventStore;
  now: () => number;
  brainConfig?: { modelByTier?: Record<string, string> };
}): Promise<SplitIntegrationJudgment> {
  if (!params.registry.has('judge-integration') || params.artifact === null) {
    return { findings: [], blockers: [] };
  }

  const rubric = enrichRubric(params.registry,
    `Does the integrated artifact satisfy the original goal: "${params.goal.title}"?`,
    'judge-integration',
    params.goal.intent,
  );
  const goalTypeDef = params.registry.get(params.goal.type);
  const tier = goalTypeDef.tier.default;
  const judgeCtx: BrainContext = {
    tier,
    memories: params.goal.memories,
  };
  let verdict: Verdict;
  let usage;
  try {
    ({ value: verdict, usage } = await params.brain.judge(
      params.goal,
      params.artifact,
      rubric,
      judgeCtx,
    ));
  } catch (err) {
    // A terminal provider error here (e.g. the input size still exceeds the
    // provider ceiling despite the bounded subject summary) must not crash the
    // whole tree: the children already did real, preserved work. Degrade to a
    // blocker so the round fails gracefully and the work can be collected and
    // reported, rather than throwing through the milestone loop.
    if (isTerminalProviderError(err)) {
      const reason = `Integration eval could not run: ${err instanceof Error ? err.message : String(err)}`;
      return { findings: [reason], blockers: [reason] };
    }
    throw err;
  }

  if (params.goldenCapture) {
    await params.store.append({
      type: 'judge-verdict',
      at: params.now(),
      goalId: params.goal.id,
      judgeType: 'judge-integration',
      verdict,
      tier,
      usage,
    });
    await appendGoldenCandidate({
      enabled: params.goldenCapture,
      store: params.store,
      now: params.now,
      goalId: params.goal.id,
      judgeType: 'judge-integration',
      artifact: params.artifact,
      rubric,
      verdict,
      tier,
      ...(params.brainConfig !== undefined ? { brainConfig: params.brainConfig } : {}),
    });
  }

  if (verdict.pass) return { findings: [], blockers: [], verdict };

  const msg = `Integration eval failed: ${verdict.findings.map((f) => f.title).join(', ')}`;
  return { findings: [msg], blockers: [msg], verdict };
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
