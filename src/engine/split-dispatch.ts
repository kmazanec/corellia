import type { ChildPlan, Decision } from '../contract/decision.js';
import type { EventStore } from '../contract/events.js';
import type { Goal } from '../contract/goal.js';
import type { GoalTypeDef, Registry } from '../contract/goal-type.js';
import type { PatternStore } from '../contract/pattern.js';
import type { Report } from '../contract/report.js';
import {
  runKnowledgeCoverageSplitGate,
  type KnowledgeCoverageGateway,
} from './coverage/split-gate.js';
import { blockedReport } from './reports.js';

type SplitDecision = Extract<Decision, { kind: 'split' }>;

export async function runSplitDispatch(params: {
  goal: Goal;
  typeDef: GoalTypeDef;
  decision: SplitDecision;
  terracedLoserFindings: string[];
  goalShape: string | null;
  repoRoot: string | undefined;
  knowledge: KnowledgeCoverageGateway | undefined;
  patterns: PatternStore | undefined;
  registry: Registry;
  store: EventStore;
  now: () => number;
  runMilestone: (children: ChildPlan[]) => Promise<Report>;
  runSplit: (children: ChildPlan[], terracedLoserFindings: string[]) => Promise<Report>;
}): Promise<Report> {
  const childrenToSplit = await applyCoverageGate(params);
  if (childrenToSplit.kind === 'blocked') {
    return childrenToSplit.report;
  }

  const splitReport = await executeSplit({
    typeDef: params.typeDef,
    goal: params.goal,
    children: childrenToSplit.children,
    terracedLoserFindings: params.terracedLoserFindings,
    store: params.store,
    now: params.now,
    runMilestone: params.runMilestone,
    runSplit: params.runSplit,
  });

  await recordSplitPattern({
    goal: params.goal,
    decision: params.decision,
    report: splitReport,
    goalShape: params.goalShape,
    patterns: params.patterns,
    store: params.store,
    now: params.now,
  });

  return splitReport;
}

type CoverageGateResult =
  | { kind: 'ready'; children: ChildPlan[] }
  | { kind: 'blocked'; report: Report };

async function applyCoverageGate(params: {
  goal: Goal;
  typeDef: GoalTypeDef;
  decision: SplitDecision;
  repoRoot: string | undefined;
  knowledge: KnowledgeCoverageGateway | undefined;
  registry: Registry;
  store: EventStore;
  now: () => number;
}): Promise<CoverageGateResult> {
  if (params.knowledge === undefined || params.repoRoot === undefined) {
    return { kind: 'ready', children: params.decision.children };
  }

  try {
    const children = await runKnowledgeCoverageSplitGate({
      goal: params.goal,
      kind: params.typeDef.kind,
      children: params.decision.children,
      repoRoot: params.repoRoot,
      knowledge: params.knowledge,
      registry: params.registry,
      store: params.store,
      now: params.now,
    });
    return { kind: 'ready', children };
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

async function executeSplit(params: {
  typeDef: GoalTypeDef;
  goal: Goal;
  children: ChildPlan[];
  terracedLoserFindings: string[];
  store: EventStore;
  now: () => number;
  runMilestone: (children: ChildPlan[]) => Promise<Report>;
  runSplit: (children: ChildPlan[], terracedLoserFindings: string[]) => Promise<Report>;
}): Promise<Report> {
  if (!params.typeDef.iterative) {
    return params.runSplit(params.children, params.terracedLoserFindings);
  }

  const effectiveMaxRounds = params.goal.maxRounds ?? params.typeDef.iterative.maxRounds;
  if (!Number.isInteger(effectiveMaxRounds) || effectiveMaxRounds < 1) {
    const report = blockedReport(
      `iterative maxRounds must be an integer >= 1 (effective value ${effectiveMaxRounds})`,
    );
    await params.store.append({
      type: 'emitted',
      at: params.now(),
      goalId: params.goal.id,
      report,
    });
    return report;
  }

  return params.runMilestone(params.children);
}

async function recordSplitPattern(params: {
  goal: Goal;
  decision: SplitDecision;
  report: Report;
  goalShape: string | null;
  patterns: PatternStore | undefined;
  store: EventStore;
  now: () => number;
}): Promise<void> {
  if (params.patterns === undefined || params.goalShape === null) {
    return;
  }

  const outcome: 'success' | 'failure' =
    params.report.blockers.length === 0 ? 'success' : 'failure';
  await params.patterns.record(params.goalShape, params.decision, outcome);
  await params.store.append({
    type: 'pattern-recorded',
    at: params.now(),
    goalId: params.goal.id,
    shape: params.goalShape,
    outcome,
  });
}
