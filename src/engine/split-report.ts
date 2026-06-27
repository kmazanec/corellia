import type { ChildPlan } from '../contract/decision.js';
import type { EventStore } from '../contract/events.js';
import type { Goal, MemoryPointer } from '../contract/goal.js';
import type { Artifact, Report } from '../contract/report.js';

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
  childReports: Report[];
  promotion: SplitPromotion;
  extraFindings: string[];
  integrationFindings: string[];
  integrationBlockers: string[];
  comprehendFindings: string[];
  comprehendBlockers: string[];
}): Report {
  return {
    artifact: params.mergedArtifact,
    proof: [],
    lessons: params.promotion.lessons,
    memoriesUsed: params.childReports.flatMap((report) => report.memoriesUsed),
    blockers: [
      ...params.integrationBlockers,
      ...params.comprehendBlockers,
      ...params.childReports.flatMap((report) => report.blockers),
    ],
    findings: [
      ...params.extraFindings,
      ...params.integrationFindings,
      ...params.comprehendFindings,
      ...params.childReports.flatMap((report) => report.findings),
    ],
    learned: params.promotion.learned,
  };
}

export function childOutcomes(
  children: ChildPlan[],
  childReports: Report[],
): { plan: ChildPlan; report: Report }[] {
  return children.map((plan, index) => ({ plan, report: childReports[index]! }));
}
