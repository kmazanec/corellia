import type { DecisionBrief } from '../contract/decision.js';
import type { EventStore } from '../contract/events.js';
import type { Goal, Tier } from '../contract/goal.js';
import type { GoalTypeDef, Registry } from '../contract/goal-type.js';
import type { Report } from '../contract/report.js';
import type { RiskClass, SensitivityFact } from '../contract/risk.js';
import { classifyRisk } from '../library/risk.js';
import { runAuthorityGate } from './authority-gate.js';
import { blockedReport, unknownTypeBrief } from './reports.js';

export type GoalEntryResult =
  | {
      kind: 'ready';
      typeDef: GoalTypeDef;
      tier: Tier;
      tierIndex: number;
      tierLadder: Tier[];
      entryRisk: RiskClass;
      deadline: number;
    }
  | { kind: 'emitted'; report: Report }
  | { kind: 'ceiling' };

export async function enterGoal(params: {
  goal: Goal;
  registry: Registry;
  store: EventStore;
  now: () => number;
  sensitivity: readonly SensitivityFact[];
  onGate: ((goal: Goal, risk: RiskClass) => Promise<'granted' | 'denied'>) | undefined;
  onBrief: ((brief: DecisionBrief) => Promise<'deny' | 'park' | 'bounce' | 'answered'>) | undefined;
  hasReachedCeiling: () => boolean;
}): Promise<GoalEntryResult> {
  const deadline = params.now() + params.goal.budget.wallClockMs;

  await params.store.append({
    type: 'goal-received',
    at: params.now(),
    goalId: params.goal.id,
    goal: params.goal,
  });

  if (params.hasReachedCeiling()) {
    return { kind: 'ceiling' };
  }

  if (!params.registry.has(params.goal.type)) {
    return {
      kind: 'emitted',
      report: await blockUnknownType(params),
    };
  }

  const typeDef = params.registry.get(params.goal.type);
  const inputViolation = typeDef.validateInput?.(params.goal.spec) ?? null;
  if (inputViolation !== null) {
    const report = blockedReport(`Invalid input for goal type "${params.goal.type}": ${inputViolation}`);
    await params.store.append({
      type: 'emitted',
      at: params.now(),
      goalId: params.goal.id,
      report,
    });
    return { kind: 'emitted', report };
  }

  const entryRisk = classifyRisk(params.goal.scope, [...params.sensitivity]);
  await params.store.append({
    type: 'risk-classified',
    at: params.now(),
    goalId: params.goal.id,
    risk: entryRisk,
  });

  const authorityReport = await runAuthorityGate({
    shouldGate: typeDef.gated === true || entryRisk === 'high',
    goal: params.goal,
    risk: entryRisk,
    typeGated: typeDef.gated === true,
    store: params.store,
    now: params.now,
    onGate: params.onGate,
    onBrief: params.onBrief,
    deniedMessage: (brief) => `Authority gate denied: ${brief.question}`,
  });
  if (authorityReport !== null) {
    return { kind: 'emitted', report: authorityReport };
  }

  return {
    kind: 'ready',
    typeDef,
    tier: typeDef.tier.default,
    tierIndex: 0,
    tierLadder: typeDef.tier.ladder,
    entryRisk,
    deadline,
  };
}

async function blockUnknownType(params: {
  goal: Goal;
  store: EventStore;
  now: () => number;
  onBrief: ((brief: DecisionBrief) => Promise<'deny' | 'park' | 'bounce' | 'answered'>) | undefined;
}): Promise<Report> {
  const brief = unknownTypeBrief(params.goal);
  const resolution = params.onBrief
    ? await params.onBrief(brief)
    : brief.onTimeout;
  await params.store.append({
    type: 'blocked',
    at: params.now(),
    goalId: params.goal.id,
    brief,
    resolution,
  });
  const report = blockedReport(`Unknown goal type: ${params.goal.type}`);
  await params.store.append({
    type: 'emitted',
    at: params.now(),
    goalId: params.goal.id,
    report,
  });
  return report;
}
