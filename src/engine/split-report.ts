import type { ChildPlan } from '../contract/decision.js';
import type { EventStore } from '../contract/events.js';
import type { Goal, MemoryPointer } from '../contract/goal.js';
import type { Artifact, BlockedModule, Report } from '../contract/report.js';

export interface SplitPromotion {
  lessons: string[];
  learned: string;
}

export async function promoteChildReports(params: {
  childGoals: Goal[];
  childReports: Report[];
  store: EventStore;
  now: () => number;
}): Promise<SplitPromotion> {
  const allLessons: string[] = [];
  const allLearnedLines: string[] = [];

  for (let index = 0; index < params.childReports.length; index++) {
    const report = params.childReports[index]!;
    const childGoal = params.childGoals[index]!;
    const succeeded = report.blockers.length === 0;

    for (const lesson of report.lessons) {
      const pointer: MemoryPointer = {
        id: `${childGoal.id}:lesson:${lesson.slice(0, 40)}`,
        layer: 'project',
        content: lesson,
        provenance: 'provisional',
      };
      await params.store.append({
        type: 'memory-written',
        at: params.now(),
        goalId: childGoal.id,
        pointer,
      });
      allLessons.push(lesson);
    }

    for (const memoryId of report.memoriesUsed) {
      await params.store.append({
        type: 'memory-reinforced',
        at: params.now(),
        goalId: childGoal.id,
        memoryId,
        outcome: succeeded ? 'success' : 'failure',
      });
    }

    if (report.learned) allLearnedLines.push(report.learned);
  }

  return {
    lessons: [...new Set(allLessons)],
    learned: [...new Set(allLearnedLines)].join('\n'),
  };
}

export function buildSplitRoundReport(params: {
  mergedArtifact: Artifact | null;
  childGoals: Goal[];
  childReports: Report[];
  promotion: SplitPromotion;
  extraFindings: string[];
  integrationFindings: string[];
  integrationBlockers: string[];
  comprehendFindings: string[];
  comprehendBlockers: string[];
}): Report {
  const childBlockers = params.childReports.flatMap((report) => report.blockers);
  const partialDelivery = buildPartialDelivery(params.childGoals, params.childReports, childBlockers);
  return {
    artifact: params.mergedArtifact,
    proof: [],
    lessons: params.promotion.lessons,
    memoriesUsed: params.childReports.flatMap((report) => report.memoriesUsed),
    blockers: [
      ...params.integrationBlockers,
      ...params.comprehendBlockers,
      ...childBlockers,
    ],
    findings: [
      ...params.extraFindings,
      ...params.integrationFindings,
      ...params.comprehendFindings,
      ...params.childReports.flatMap((report) => report.findings),
    ],
    learned: params.promotion.learned,
    ...(partialDelivery !== undefined ? { partialDelivery } : {}),
  };
}

/**
 * Enumerate the child modules that blocked (issue A5), for the ship-what's-green
 * report. Records both the operator-facing {goalId, title, blocker} list and the
 * exact blocker strings those modules contributed, so the collect decision can
 * separate child-origin blockers from root-level acceptance/integration
 * failures. Returns undefined when no child blocked (nothing partial to surface).
 */
function buildPartialDelivery(
  childGoals: Goal[],
  childReports: Report[],
  childBlockers: string[],
): Report['partialDelivery'] {
  const blockedModules: BlockedModule[] = [];
  for (let index = 0; index < childReports.length; index++) {
    const report = childReports[index]!;
    if (report.blockers.length === 0) continue;
    const childGoal = childGoals[index];
    blockedModules.push({
      goalId: childGoal?.id ?? `child-${index}`,
      title: childGoal?.title ?? '(unknown module)',
      blocker: report.blockers[0] ?? 'unknown',
    });
  }
  if (blockedModules.length === 0) return undefined;
  return { blockedModules, childBlockers };
}

export function childOutcomes(
  children: ChildPlan[],
  childReports: Report[],
): { plan: ChildPlan; report: Report }[] {
  return children.map((plan, index) => ({ plan, report: childReports[index]! }));
}
