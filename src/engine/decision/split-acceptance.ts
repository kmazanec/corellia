import type { Brain } from '../../contract/brain.js';
import type { Decision } from '../../contract/decision.js';
import type { EventStore } from '../../contract/events.js';
import type { Goal, Tier, Usage } from '../../contract/goal.js';
import type { GoalTypeDef, Registry } from '../../contract/goal-type.js';
import type { Report } from '../../contract/report.js';
import type { Verdict } from '../../contract/verdict.js';
import {
  runKnowledgeCoverageSplitGate,
  type KnowledgeCoverageGateway,
} from '../coverage/split-gate.js';
import { debitAttempt } from '../budget-events.js';
import { blockedReport } from '../reports.js';
import { renormalizeShares, validateSplit } from '../split-validation.js';
import {
  mustDecomposeCorrectionContext,
  rejectedSplitSatisfyReport,
} from './must-decompose-guard.js';
import {
  invalidSplitStructureVerdict,
  isomorphicSplitFailure,
  judgeSplitDecision,
  splitPlanArtifact,
} from './split-eval.js';

type SplitDecision = Extract<Decision, { kind: 'split' }>;

/** judgeType label for the deterministic structural check on a proposed split. */
const SPLIT_STRUCTURE_CHECK = 'split-structure';

export type SplitAcceptanceResult =
  | { kind: 'accepted'; decision: Decision; decideUsage: Usage | undefined }
  | { kind: 'emitted'; report: Report }
  | { kind: 'ceiling' };

export async function acceptSplitDecision(params: {
  goal: Goal;
  typeDef: GoalTypeDef;
  decision: SplitDecision;
  decideUsage: Usage | undefined;
  tier: Tier;
  registry: Registry;
  brain: Brain;
  store: EventStore;
  now: () => number;
  repoRoot?: string;
  knowledge?: KnowledgeCoverageGateway;
  goldenCapture: boolean;
  brainConfig?: { modelByTier?: Record<string, string> };
  debitUsage: (usage: Usage) => void;
  hasReachedCeiling: () => boolean;
}): Promise<SplitAcceptanceResult> {
  if (params.typeDef.leafOnly) {
    const report = blockedReport(
      `Type "${params.goal.type}" is leafOnly but brain returned a split decision`,
    );
    await appendDecided(params, params.decision, undefined);
    await appendEmitted(params, report);
    return { kind: 'emitted', report };
  }

  let decision: Decision = params.decision;
  let decideUsage = params.decideUsage;
  let budget = params.goal.budget;
  let priorVerdict: Verdict | undefined;

  while (decision.kind === 'split') {
    // Over-allocated budgetShares are mechanically repairable — models often
    // return relative weights (e.g. five children at 1.0 each) rather than
    // fractions of the whole. Renormalize before validating, exactly as the
    // coverage gate does, instead of bouncing the split to a re-decide
    // (observed: live-tail run 2026-07-01, "budgetShares sum to 5.0000").
    decision = { ...decision, children: renormalizeShares(decision.children) };
    const structErr = validateSplit(
      decision.children,
      (type) => (params.registry.has(type) ? params.registry.get(type) : undefined),
    );
    if (structErr !== null) {
      budget = await debitAttempt({
        budget,
        goal: params.goal,
        store: params.store,
        now: params.now,
      });
      const failVerdict = invalidSplitStructureVerdict(structErr);
      // Event the rejection: without this the run's own record shows only the
      // re-decision, not WHY the proposed split was thrown away (observed:
      // live-tail re-run 2026-07-01, an 8-event log that could not explain its
      // own block). Deterministic verdict, so no usage.
      await params.store.append({
        type: 'judge-verdict',
        at: params.now(),
        goalId: params.goal.id,
        judgeType: SPLIT_STRUCTURE_CHECK,
        verdict: failVerdict,
        tier: params.tier,
      });

      if (isomorphicSplitFailure(priorVerdict, failVerdict)) {
        const report = blockedReport(
          `Isomorphic split structural failure (signature: ${failVerdict.failureSignature})`,
        );
        await appendEmitted(params, report);
        return { kind: 'emitted', report };
      }

      priorVerdict = failVerdict;
      const reDecision = await reDecideAfterSplitFailure(params, decision, failVerdict);
      decision = reDecision.decision;
      decideUsage = reDecision.decideUsage;

      if (params.hasReachedCeiling()) {
        await appendDecided(params, decision, decideUsage);
        return { kind: 'ceiling' };
      }

      if (decision.kind === 'satisfy' && params.typeDef.mustDecompose) {
        const report = rejectedSplitSatisfyReport(params.goal);
        await appendDecided(params, decision, decideUsage);
        await appendEmitted(params, report);
        return { kind: 'emitted', report };
      }
      continue;
    }

    const coverageResult = await augmentSplitForCoverage(params, decision);
    if (coverageResult.kind === 'blocked') {
      return { kind: 'emitted', report: coverageResult.report };
    }
    decision = coverageResult.decision;

    if (!params.registry.has('judge-split')) {
      break;
    }

    const splitJudgeResult = await judgeSplitDecision({
      goal: params.goal,
      children: decision.children,
      tier: params.tier,
      registry: params.registry,
      brain: params.brain,
      store: params.store,
      now: params.now,
      goldenCapture: params.goldenCapture,
      ...(params.brainConfig !== undefined ? { brainConfig: params.brainConfig } : {}),
    });
    const splitVerdict = splitJudgeResult.verdict;
    params.debitUsage(splitJudgeResult.usage);
    if (params.hasReachedCeiling()) {
      return { kind: 'ceiling' };
    }

    if (splitVerdict.pass) {
      break;
    }

    budget = await debitAttempt({
      budget,
      goal: params.goal,
      store: params.store,
      now: params.now,
    });

    if (isomorphicSplitFailure(priorVerdict, splitVerdict)) {
      const sig = splitVerdict.failureSignature ?? 'unsignatured';
      const report = blockedReport(`Isomorphic split failure (signature: ${sig})`);
      await appendDecided(params, decision, decideUsage);
      await appendEmitted(params, report);
      return { kind: 'emitted', report };
    }

    priorVerdict = splitVerdict;
    const reDecision = await reDecideAfterSplitFailure(params, decision, splitVerdict);
    decision = reDecision.decision;
    decideUsage = reDecision.decideUsage;

    if (params.hasReachedCeiling()) {
      await appendDecided(params, decision, decideUsage);
      return { kind: 'ceiling' };
    }

    // Same guard as the structural branch: a satisfy here would otherwise fall
    // out of the while loop and return as "accepted" — letting a must-decompose
    // type satisfy directly through the judge-rejection path.
    if (decision.kind === 'satisfy' && params.typeDef.mustDecompose) {
      const report = rejectedSplitSatisfyReport(params.goal);
      await appendDecided(params, decision, decideUsage);
      await appendEmitted(params, report);
      return { kind: 'emitted', report };
    }
  }

  return { kind: 'accepted', decision, decideUsage };
}

async function augmentSplitForCoverage(
  params: {
    goal: Goal;
    typeDef: GoalTypeDef;
    decision: SplitDecision;
    registry: Registry;
    store: EventStore;
    now: () => number;
    repoRoot?: string;
    knowledge?: KnowledgeCoverageGateway;
  },
  decision: SplitDecision,
): Promise<{ kind: 'ready'; decision: SplitDecision } | { kind: 'blocked'; report: Report }> {
  if (params.knowledge === undefined || params.repoRoot === undefined) {
    return { kind: 'ready', decision };
  }

  try {
    const children = await runKnowledgeCoverageSplitGate({
      goal: params.goal,
      kind: params.typeDef.kind,
      children: decision.children,
      repoRoot: params.repoRoot,
      knowledge: params.knowledge,
      registry: params.registry,
      store: params.store,
      now: params.now,
    });
    return { kind: 'ready', decision: { ...decision, children } };
  } catch (gateErr) {
    const msg = gateErr instanceof Error ? gateErr.message : String(gateErr);
    const report = blockedReport(`Split structural validation failed after coverage injection: ${msg}`);
    await params.store.append({
      type: 'emitted',
      at: params.now(),
      goalId: params.goal.id,
      report,
    });
    return { kind: 'blocked', report };
  }
}

async function reDecideAfterSplitFailure(
  params: {
    goal: Goal;
    typeDef: GoalTypeDef;
    tier: Tier;
    brain: Brain;
    debitUsage: (usage: Usage) => void;
  },
  decision: SplitDecision,
  verdict: Verdict,
): Promise<{ decision: Decision; decideUsage: Usage }> {
  const priorAttempt = {
    artifact: splitPlanArtifact(decision.children),
    verdict,
  };
  // Carry mustDecompose into the re-decide: without it the prompt offers
  // {"kind":"satisfy"} as a valid shape to a type that can never satisfy,
  // inviting the model to burn its corrected retry on an invalid answer
  // (observed: live-tail run 4, 2026-07-01).
  const reDecideResult = await params.brain.decide(params.goal, {
    tier: params.tier,
    memories: params.goal.memories,
    priorAttempt,
    ...(params.typeDef.mustDecompose === true ? { mustDecompose: true } : {}),
  });
  params.debitUsage(reDecideResult.usage);
  if (reDecideResult.value.kind !== 'satisfy' || params.typeDef.mustDecompose !== true) {
    return {
      decision: reDecideResult.value,
      decideUsage: reDecideResult.usage,
    };
  }

  // A satisfy is structurally invalid for a must-decompose type. Mirror the
  // must-decompose guard: ONE explicitly-corrected retry (carrying the rejected
  // split as the prior attempt) before the caller blocks. Without it a single
  // uncorrected "satisfy" hard-blocked a whole commission at the first decide
  // (observed: live-tail re-run 2026-07-01).
  const corrected = await params.brain.decide(
    params.goal,
    mustDecomposeCorrectionContext({
      goal: params.goal,
      tier: params.tier,
      skill: undefined,
      repoShape: undefined,
      priorAttempt,
    }),
  );
  params.debitUsage(corrected.usage);
  return { decision: corrected.value, decideUsage: corrected.usage };
}

async function appendDecided(
  params: { goal: Goal; store: EventStore; now: () => number },
  decision: Decision,
  usage: Usage | undefined,
): Promise<void> {
  await params.store.append({
    type: 'decided',
    at: params.now(),
    goalId: params.goal.id,
    decision,
    ...(usage !== undefined ? { usage } : {}),
  });
}

async function appendEmitted(
  params: { goal: Goal; store: EventStore; now: () => number },
  report: Report,
): Promise<void> {
  await params.store.append({
    type: 'emitted',
    at: params.now(),
    goalId: params.goal.id,
    report,
  });
}
