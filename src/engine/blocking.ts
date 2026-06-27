import type { DecisionBrief } from '../contract/decision.js';
import type { EventStore } from '../contract/events.js';
import type { Goal } from '../contract/goal.js';
import type { Report } from '../contract/report.js';
import { blockedReport } from './reports.js';
import type { TreeState } from './tree-spend.js';

type BriefResolution = 'deny' | 'park' | 'bounce' | 'answered';

export async function runBlock(params: {
  goal: Goal;
  brief: DecisionBrief;
  store: EventStore;
  now: () => number;
  onBrief: ((brief: DecisionBrief) => Promise<BriefResolution>) | undefined;
}): Promise<Report> {
  const resolution = params.onBrief
    ? await params.onBrief(params.brief)
    : params.brief.onTimeout;
  await params.store.append({
    type: 'blocked',
    at: params.now(),
    goalId: params.goal.id,
    brief: params.brief,
    resolution,
  });
  const report = blockedReport(params.brief.question);
  await params.store.append({
    type: 'emitted',
    at: params.now(),
    goalId: params.goal.id,
    report,
  });
  return report;
}

export async function ceilingReachedOnce(params: {
  goal: Goal;
  treeState: TreeState;
  store: EventStore;
  now: () => number;
}): Promise<void> {
  if (params.treeState.ceilingEmitted) {
    return;
  }

  params.treeState.ceilingEmitted = true;
  await params.store.append({
    type: 'ceiling-reached',
    at: params.now(),
    goalId: params.goal.id,
    spentUsd: params.treeState.spentUsd,
    ceilingUsd: params.treeState.ceilingUsd,
  });
}

export async function ceilingReport(params: {
  goal: Goal;
  treeState: TreeState;
  store: EventStore;
  now: () => number;
  onBrief: ((brief: DecisionBrief) => Promise<BriefResolution>) | undefined;
}): Promise<Report> {
  await ceilingReachedOnce(params);
  return runBlock({
    goal: params.goal,
    brief: {
      question: `Tree spend ceiling of $${params.treeState.ceilingUsd.toFixed(2)} reached (spent $${params.treeState.spentUsd.toFixed(4)}). Tree halted.`,
      options: ['deny', 'park', 'bounce'],
      links: [params.goal.id],
      deadlineMs: 30_000,
      onTimeout: 'deny',
    },
    store: params.store,
    now: params.now,
    onBrief: params.onBrief,
  });
}
