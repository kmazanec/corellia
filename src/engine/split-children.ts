import type { ChildPlan } from '../contract/decision.js';
import type { EventStore } from '../contract/events.js';
import type { Goal, MemoryPointer } from '../contract/goal.js';
import type { MemoryView } from '../contract/memory.js';
import type { Report } from '../contract/report.js';
import { subdivide } from './budget.js';
import { diveFactsAsMemories, type FactsForRegions } from './knowledge-memory.js';
import { blockedReport } from './reports.js';

export async function buildSplitChildGoals(params: {
  parent: Goal;
  children: ChildPlan[];
  memory: MemoryView;
}): Promise<Goal[]> {
  const budgets = subdivide(
    params.parent.budget,
    params.children.map((child) => child.budgetShare),
  );

  return Promise.all(params.children.map(async (child, index) => {
    const childMemories = await params.memory.query(child.title, child.scope);
    const childBudget = budgets[index] ?? {
      attempts: 1,
      tokens: 1,
      toolCalls: 1,
      wallClockMs: 1,
    };

    return {
      id: `${params.parent.id}/${child.localId}`,
      type: child.type,
      parentId: params.parent.id,
      title: child.title,
      spec: child.spec,
      intent: child.intent ?? params.parent.intent,
      scope: child.scope,
      budget: childBudget,
      memories: childMemories,
      ...(params.parent.spendCeilingUsd !== undefined
        ? { spendCeilingUsd: params.parent.spendCeilingUsd }
        : {}),
    };
  }));
}

export async function appendChildSpawnedEvents(params: {
  parent: Goal;
  children: ChildPlan[];
  childGoals: Goal[];
  store: EventStore;
  now: () => number;
}): Promise<void> {
  for (let index = 0; index < params.children.length; index++) {
    const child = params.children[index]!;
    const childGoal = params.childGoals[index]!;
    await params.store.append({
      type: 'child-spawned',
      at: params.now(),
      goalId: params.parent.id,
      childId: childGoal.id,
      childType: child.type,
      dependsOn: child.dependsOn.map((localId) => `${params.parent.id}/${localId}`),
    });
  }
}

export async function runSplitChildren(params: {
  parent: Goal;
  children: ChildPlan[];
  childGoals: Goal[];
  store: EventStore;
  now: () => number;
  repoRoot: string;
  factsForRegions: FactsForRegions | undefined;
  headSha: ((repoRoot: string) => Promise<string>) | undefined;
  runChild: (goal: Goal) => Promise<Report>;
}): Promise<Report[]> {
  const reportByLocalId = new Map<string, Promise<Report>>();
  const childByLocalId = new Map(params.children.map((child, index) => [
    child.localId,
    { child, goal: params.childGoals[index]! },
  ]));

  const startChild = (localId: string): Promise<Report> => {
    const existing = reportByLocalId.get(localId);
    if (existing !== undefined) return existing;

    const entry = childByLocalId.get(localId);
    if (entry === undefined) {
      throw new Error(`Dependency "${localId}" not found — this should have been caught in validateSplit`);
    }

    const promise = runOneSplitChild({
      ...params,
      child: entry.child,
      childGoal: entry.goal,
      dependencyReports: () => Promise.all(entry.child.dependsOn.map(startChild)),
    });
    reportByLocalId.set(localId, promise);
    return promise;
  };

  return Promise.all(params.children.map((child) => startChild(child.localId)));
}

async function runOneSplitChild(params: {
  parent: Goal;
  child: ChildPlan;
  childGoal: Goal;
  store: EventStore;
  now: () => number;
  repoRoot: string;
  factsForRegions: FactsForRegions | undefined;
  headSha: ((repoRoot: string) => Promise<string>) | undefined;
  runChild: (goal: Goal) => Promise<Report>;
  dependencyReports: () => Promise<Report[]>;
}): Promise<Report> {
  try {
    const depReports = await params.dependencyReports();
    const fatalDep = depReports.find((report) =>
      report.blockers.length > 0 && report.artifact === null
    );
    if (fatalDep !== undefined) {
      const report = blockedReport(
        `Blocked because a dependency failed without producing any usable artifact: ${fatalDep.blockers[0] ?? 'unknown'}`,
      );
      await params.store.append({
        type: 'emitted',
        at: params.now(),
        goalId: params.childGoal.id,
        report,
      });
      return report;
    }

    const degradedFindings = await appendDependencyDegradedEvents({
      parent: params.parent,
      child: params.child,
      childGoal: params.childGoal,
      depReports,
      store: params.store,
      now: params.now,
    });

    const childGoalWithFacts = await injectDiveMemories({
      childGoal: params.childGoal,
      repoRoot: params.repoRoot,
      factsForRegions: params.factsForRegions,
      headSha: params.headSha,
    });

    const report = await params.runChild(childGoalWithFacts);
    return degradedFindings.length > 0
      ? { ...report, findings: [...report.findings, ...degradedFindings] }
      : report;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const report = blockedReport(`child threw: ${message}`);
    await params.store.append({
      type: 'emitted',
      at: params.now(),
      goalId: params.childGoal.id,
      report,
    });
    return report;
  }
}

async function appendDependencyDegradedEvents(params: {
  parent: Goal;
  child: ChildPlan;
  childGoal: Goal;
  depReports: Report[];
  store: EventStore;
  now: () => number;
}): Promise<string[]> {
  const degradedFindings: string[] = [];
  for (let index = 0; index < params.depReports.length; index++) {
    const report = params.depReports[index]!;
    if (report.blockers.length === 0 || report.artifact === null) continue;

    const depLocalId = params.child.dependsOn[index]!;
    const blocker = report.blockers[0] ?? 'unknown';
    await params.store.append({
      type: 'dependency-degraded',
      at: params.now(),
      goalId: params.childGoal.id,
      dependency: `${params.parent.id}/${depLocalId}`,
      blocker,
    });
    degradedFindings.push(
      `Proceeded on a degraded dependency (${depLocalId}) that blocked but produced a usable partial: ${blocker}`,
    );
  }
  return degradedFindings;
}

async function injectDiveMemories(params: {
  childGoal: Goal;
  repoRoot: string;
  factsForRegions: FactsForRegions | undefined;
  headSha: ((repoRoot: string) => Promise<string>) | undefined;
}): Promise<Goal> {
  const memories = await lateDiveMemories(params);
  return memories.length > 0
    ? { ...params.childGoal, memories: [...params.childGoal.memories, ...memories] }
    : params.childGoal;
}

async function lateDiveMemories(params: {
  childGoal: Goal;
  repoRoot: string;
  factsForRegions: FactsForRegions | undefined;
  headSha: ((repoRoot: string) => Promise<string>) | undefined;
}): Promise<MemoryPointer[]> {
  let headSha = '';
  if (params.headSha !== undefined && params.repoRoot.length > 0) {
    try {
      headSha = await params.headSha(params.repoRoot);
    } catch {
      headSha = '';
    }
  }

  return diveFactsAsMemories({
    factsForRegions: params.factsForRegions,
    repoRoot: params.repoRoot,
    scope: params.childGoal.scope,
    headSha,
  });
}
