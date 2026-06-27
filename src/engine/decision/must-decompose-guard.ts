import type { Brain, BrainContext } from '../../contract/brain.js';
import type { Decision } from '../../contract/decision.js';
import type { EventStore } from '../../contract/events.js';
import type { Goal, Tier, Usage } from '../../contract/goal.js';
import type { Report } from '../../contract/report.js';
import { blockedReport } from '../reports.js';

export type MustDecomposeGuardResult =
  | { kind: 'unchanged'; decision: Decision; decideUsage: Usage | undefined }
  | { kind: 'adopted'; decision: Exclude<Decision, { kind: 'satisfy' }>; decideUsage: Usage }
  | { kind: 'blocked'; report: Report }
  | { kind: 'ceiling' };

export async function runMustDecomposeGuard(params: {
  enabled: boolean;
  goal: Goal;
  decision: Decision;
  decideUsage: Usage | undefined;
  tier: Tier;
  skill: string | undefined;
  repoShape: string | undefined;
  brain: Brain;
  store: EventStore;
  now: () => number;
  debitUsage: (usage: Usage) => void;
  hasReachedCeiling: () => boolean;
}): Promise<MustDecomposeGuardResult> {
  if (!params.enabled || params.decision.kind !== 'satisfy') {
    return {
      kind: 'unchanged',
      decision: params.decision,
      decideUsage: params.decideUsage,
    };
  }

  await appendDecided(params.store, params.now, params.goal.id, params.decision, params.decideUsage);

  const retry = await params.brain.decide(params.goal, mustDecomposeCorrectionContext({
    goal: params.goal,
    tier: params.tier,
    skill: params.skill,
    repoShape: params.repoShape,
  }));
  params.debitUsage(retry.usage);

  if (params.hasReachedCeiling()) {
    await appendDecided(params.store, params.now, params.goal.id, retry.value, retry.usage);
    return { kind: 'ceiling' };
  }

  if (retry.value.kind === 'satisfy') {
    const report = repeatedSatisfyReport(params.goal);
    await appendDecided(params.store, params.now, params.goal.id, retry.value, retry.usage);
    await params.store.append({
      type: 'emitted',
      at: params.now(),
      goalId: params.goal.id,
      report,
    });
    return { kind: 'blocked', report };
  }

  return { kind: 'adopted', decision: retry.value, decideUsage: retry.usage };
}

export function rejectedSplitSatisfyReport(goal: Goal): Report {
  return blockedReport(
    `Type "${goal.type}" must decompose and cannot satisfy directly -- after a ` +
      `rejected split it re-decided to satisfy, which is invalid for a type with ` +
      `no producing tool. Re-commission with a clearer, decomposable intent, or ` +
      `the split must propose valid typed children.`,
  );
}

function mustDecomposeCorrectionContext(params: {
  goal: Goal;
  tier: Tier;
  skill: string | undefined;
  repoShape: string | undefined;
}): BrainContext {
  return {
    tier: params.tier,
    memories: params.goal.memories,
    mustDecompose: true,
    decideCorrection:
      `Your last decision was "satisfy". That is structurally INVALID for type ` +
      `"${params.goal.type}": it has no tool with which to produce the product -- its only ` +
      `job is to decompose. Return a "split" that breaks this intent into typed ` +
      `children (e.g. comprehension dives over the regions you must understand, ` +
      `then implement leaves that do the work), or "block" with a brief ONLY if you ` +
      `genuinely cannot decompose. Do NOT return satisfy again.`,
    ...(params.skill ? { skill: params.skill } : {}),
    ...(params.repoShape ? { repoShape: params.repoShape } : {}),
  };
}

function repeatedSatisfyReport(goal: Goal): Report {
  return blockedReport(
    `Type "${goal.type}" must decompose and cannot satisfy directly -- it has no ` +
      `tool with which to produce the product. The decision-maker returned satisfy ` +
      `twice (once after an explicit correction); re-commission with a clearer, ` +
      `decomposable intent, or the split must propose typed children.`,
  );
}

async function appendDecided(
  store: EventStore,
  now: () => number,
  goalId: string,
  decision: Decision,
  usage: Usage | undefined,
): Promise<void> {
  await store.append({
    type: 'decided',
    at: now(),
    goalId,
    decision,
    ...(usage !== undefined ? { usage } : {}),
  });
}
