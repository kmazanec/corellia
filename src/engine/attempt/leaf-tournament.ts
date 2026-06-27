import type { Brain, BrainContext } from '../../contract/brain.js';
import type { EventStore } from '../../contract/events.js';
import type { Budget, Goal, Tier, Usage } from '../../contract/goal.js';
import type { GoalTypeDef, Registry } from '../../contract/goal-type.js';
import type { Artifact } from '../../contract/report.js';
import type { Verdict } from '../../contract/verdict.js';
import { debitTokenUsage } from '../budget-events.js';
import { judgeLeafArtifact } from '../leaf-judge.js';

type ScanConfig = NonNullable<GoalTypeDef['scan']>;

type Candidate = {
  artifact: Artifact;
  verdict: Verdict;
};

type CandidateArtifact =
  | { kind: 'artifact'; artifact: Artifact; budget: Budget }
  | { kind: 'ceiling'; budget: Budget };

export type LeafTournamentResult =
  | { kind: 'winner'; artifact: Artifact; budget: Budget }
  | { kind: 'ceiling'; budget: Budget };

export async function runLeafTournament(params: {
  goal: Goal;
  firstArtifact: Artifact;
  scan: ScanConfig;
  judgeType: string;
  typeDef: GoalTypeDef;
  tier: Tier;
  budget: Budget;
  ctx: BrainContext;
  registry: Registry;
  brain: Brain;
  store: EventStore;
  now: () => number;
  goldenCapture: boolean;
  brainConfig?: { modelByTier?: Record<string, string> };
  debitUsage: (usage: Usage) => void;
  hasReachedCeiling: () => boolean;
}): Promise<LeafTournamentResult> {
  let budget = params.budget;
  const candidates: Candidate[] = [];

  for (let index = 0; index < params.scan.k; index++) {
    const candidate = index === 0
      ? { kind: 'artifact' as const, artifact: params.firstArtifact, budget }
      : await produceCandidate(params, budget, params.scan.lenses[index % params.scan.lenses.length] ?? params.scan.lenses[0]!);

    if (candidate.kind === 'ceiling') {
      return { kind: 'ceiling', budget: candidate.budget };
    }

    budget = candidate.budget;
    const judgeResult = await judgeLeafArtifact({
      goal: params.goal,
      artifact: candidate.artifact,
      typeDef: params.typeDef,
      judgeType: params.judgeType,
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
      return { kind: 'ceiling', budget };
    }

    candidates.push({
      artifact: candidate.artifact,
      verdict: judgeResult.verdict,
    });
  }

  return {
    kind: 'winner',
    artifact: selectWinner(candidates).artifact,
    budget,
  };
}

async function produceCandidate(
  params: {
    goal: Goal;
    ctx: BrainContext;
    brain: Brain;
    store: EventStore;
    now: () => number;
    debitUsage: (usage: Usage) => void;
    hasReachedCeiling: () => boolean;
  },
  budget: Budget,
  lens: string,
): Promise<CandidateArtifact> {
  const produceResult = await params.brain.produce(params.goal, { ...params.ctx, lens });
  params.debitUsage(produceResult.usage);

  if (params.hasReachedCeiling()) {
    return { kind: 'ceiling', budget };
  }

  return {
    kind: 'artifact',
    artifact: produceResult.value,
    budget: await debitTokenUsage({
      budget,
      usage: produceResult.usage,
      goal: params.goal,
      store: params.store,
      now: params.now,
      emitOnlyOnCrossing: true,
    }),
  };
}

function selectWinner(candidates: Candidate[]): Candidate {
  const passing = candidates.filter((candidate) => candidate.verdict.pass);
  return bestByFewestFindings(passing.length > 0 ? passing : candidates);
}

function bestByFewestFindings(candidates: Candidate[]): Candidate {
  return candidates.reduce((best, candidate) =>
    candidate.verdict.findings.length < best.verdict.findings.length
      ? candidate
      : best,
  );
}
