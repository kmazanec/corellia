import type { Brain, BrainContext } from '../../contract/brain.js';
import type { Decision } from '../../contract/decision.js';
import type { EventStore } from '../../contract/events.js';
import type { Goal, Tier, Usage } from '../../contract/goal.js';
import type { Registry } from '../../contract/goal-type.js';
import type { Verdict } from '../../contract/verdict.js';
import { judgeSplitDecision, splitPlanArtifact } from './split-eval.js';

export type TerracedScanResult =
  | { decision: Decision; loserFindings: string[]; winnerUsage?: Usage }
  | { ceiling: true };

interface Candidate {
  decision: Extract<Decision, { kind: 'split' }>;
  verdict: Verdict;
  lens: string;
  decideUsage: Usage;
  judgeUsage: Usage;
}

export async function runTerracedScan(params: {
  goal: Goal;
  k: number;
  lenses: readonly string[];
  baseCtx: BrainContext;
  tier: Tier;
  brain: Brain;
  registry: Registry;
  store: EventStore;
  now: () => number;
  goldenCapture: boolean;
  brainConfig?: { modelByTier?: Record<string, string> };
  debitUsage: (usage: Usage) => void;
  hasReachedCeiling: () => boolean;
}): Promise<TerracedScanResult> {
  const candidates: Candidate[] = [];

  for (let i = 0; i < params.k; i++) {
    const lens = params.lenses[i % params.lenses.length] ?? params.lenses[0]!;
    const lensCtx: BrainContext = { ...params.baseCtx, lens };
    const decideResult = await params.brain.decide(params.goal, lensCtx);
    const candidate = decideResult.value;
    params.debitUsage(decideResult.usage);

    if (params.hasReachedCeiling()) {
      return { ceiling: true };
    }

    if (candidate.kind !== 'split') {
      return { decision: candidate, loserFindings: [], winnerUsage: decideResult.usage };
    }

    const judgeResult = await judgeSplitDecision({
      goal: params.goal,
      children: candidate.children,
      tier: params.tier,
      registry: params.registry,
      brain: params.brain,
      store: params.store,
      now: params.now,
      goldenCapture: params.goldenCapture,
      ...(params.brainConfig !== undefined ? { brainConfig: params.brainConfig } : {}),
    });
    params.debitUsage(judgeResult.usage);

    if (params.hasReachedCeiling()) {
      return { ceiling: true };
    }

    candidates.push({
      decision: candidate,
      verdict: judgeResult.verdict,
      lens,
      decideUsage: decideResult.usage,
      judgeUsage: judgeResult.usage,
    });
  }

  const winner = winningCandidate(candidates);
  const losers = winner
    ? candidates.filter((candidate) => candidate !== winner)
    : candidates;
  const loserFindings = losers.map(alternativeFinding);

  if (winner !== undefined) {
    return { decision: winner.decision, loserFindings, winnerUsage: winner.decideUsage };
  }

  const bestLoser = bestCandidate(candidates);
  const fallbackResult = await params.brain.decide(params.goal, {
    ...params.baseCtx,
    priorAttempt: {
      artifact: splitPlanArtifact(bestLoser.decision.children),
      verdict: bestLoser.verdict,
    },
  });
  params.debitUsage(fallbackResult.usage);

  if (params.hasReachedCeiling()) {
    return { ceiling: true };
  }

  return {
    decision: fallbackResult.value,
    loserFindings,
    winnerUsage: fallbackResult.usage,
  };
}

function winningCandidate(candidates: Candidate[]): Candidate | undefined {
  const passing = candidates.filter((candidate) => candidate.verdict.pass);
  if (passing.length === 0) return undefined;
  return bestCandidate(passing);
}

function bestCandidate(candidates: Candidate[]): Candidate {
  return candidates.reduce((best, candidate) =>
    candidate.verdict.findings.length < best.verdict.findings.length ? candidate : best,
  );
}

function alternativeFinding(candidate: Candidate): string {
  const summary = candidate.verdict.findings.length > 0
    ? candidate.verdict.findings[0]!.title
    : (candidate.verdict.pass ? 'passed' : 'failed judge');
  return `alternative considered (lens=${candidate.lens}): ${summary}`;
}
