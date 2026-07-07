import type { ChildPlan } from '../contract/decision.js';
import type { EventStore } from '../contract/events.js';
import type { Goal, MemoryPointer } from '../contract/goal.js';
import type { Artifact, BlockedModule, Report } from '../contract/report.js';
import { chooseMemoryLayer } from './memory-layer.js';

export interface SplitPromotion {
  lessons: string[];
  learned: string;
}

export async function promoteChildReports(params: {
  childGoals: Goal[];
  childReports: Report[];
  /** The per-project store — project-layer memory and all reinforcement writes. */
  store: EventStore;
  /**
   * The shared store that outlives any one project (ADR-049) — the home of the
   * compounding type/global layers. Omitted ⇒ every layer falls back to the
   * per-project store, so a caller without a shared store keeps the pre-ADR-049
   * behavior (nothing regresses, the type layer simply does not compound).
   */
  sharedStore?: EventStore;
  now: () => number;
}): Promise<SplitPromotion> {
  const allLessons: string[] = [];
  const allLearnedLines: string[] = [];

  for (let index = 0; index < params.childReports.length; index++) {
    const report = params.childReports[index]!;
    const childGoal = params.childGoals[index]!;
    const succeeded = report.blockers.length === 0;

    for (const lesson of report.lessons) {
      const { layer, content } = chooseMemoryLayer(lesson);
      const pointer: MemoryPointer = {
        id: `${childGoal.id}:lesson:${content.slice(0, 40)}`,
        layer,
        ...(layer === 'type' ? { namespace: childGoal.type } : {}),
        content,
        provenance: 'provisional',
      };
      // Type/global memory routes to the shared store so it survives the project
      // it was learned in; project memory stays in the per-project log.
      const target = layer === 'project' ? params.store : (params.sharedStore ?? params.store);
      await target.append({
        type: 'memory-written',
        at: params.now(),
        goalId: childGoal.id,
        pointer,
      });
      allLessons.push(content);
    }

    for (const memoryId of report.memoriesUsed) {
      // A used memory may live in either store and we only carry its id here, so
      // reinforce in both. Each store's projection folds only reinforcements for a
      // memory it actually wrote (`projectMemory` skips unknown ids), so the
      // duplicate is a no-op on the store that never held the memory.
      const event = {
        type: 'memory-reinforced' as const,
        at: params.now(),
        goalId: childGoal.id,
        memoryId,
        outcome: (succeeded ? 'success' : 'failure') as 'success' | 'failure',
      };
      await params.store.append(event);
      if (params.sharedStore && params.sharedStore !== params.store) {
        await params.sharedStore.append({ ...event });
      }
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
