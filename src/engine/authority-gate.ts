import type { DecisionBrief } from '../contract/decision.js';
import type { EventStore } from '../contract/events.js';
import type { Goal } from '../contract/goal.js';
import type { RiskClass } from '../contract/risk.js';
import type { Report } from '../contract/report.js';
import { blockedReport, gateDeniedBrief } from './reports.js';

export interface AuthorityGateParams {
  shouldGate: boolean;
  goal: Goal;
  risk: RiskClass;
  typeGated: boolean;
  store: EventStore;
  now: () => number;
  onGate: ((goal: Goal, risk: RiskClass) => Promise<'granted' | 'denied'>) | undefined;
  onBrief: ((brief: DecisionBrief) => Promise<'deny' | 'park' | 'bounce' | 'answered'>) | undefined;
  deniedMessage: (brief: DecisionBrief) => string;
}

export async function runAuthorityGate(params: AuthorityGateParams): Promise<Report | null> {
  if (!params.shouldGate) return null;

  const gateDecision = params.onGate
    ? await params.onGate(params.goal, params.risk)
    : 'denied';

  await params.store.append({
    type: 'gate-decision',
    at: params.now(),
    goalId: params.goal.id,
    resolution: gateDecision,
  });

  if (gateDecision === 'granted') return null;

  const brief = gateDeniedBrief(params.goal, params.risk, params.typeGated);
  const report = blockedReport(params.deniedMessage(brief));
  const resolution = params.onBrief ? await params.onBrief(brief) : brief.onTimeout;
  await params.store.append({
    type: 'blocked',
    at: params.now(),
    goalId: params.goal.id,
    brief,
    resolution,
  });
  await params.store.append({
    type: 'emitted',
    at: params.now(),
    goalId: params.goal.id,
    report,
  });

  return report;
}
