/**
 * The dive→build floor handoff: how a build leaf survives a dependency dive that
 * produced nothing.
 *
 * When a `deep-dive-region` dependency emits a null artifact (issue
 * dive-anchor-hallucination-blocks-region), ADR-037's cascade would hard-block the
 * dependent builder ("produced nothing → hard block"). But a *comprehension* dive
 * is floorable: its region can be re-mapped mechanically. This module decides which
 * null dependencies are floorable and, for those, gives the builder a structural
 * floor (a provisional file/symbol map) instead of hard-blocking — while a null
 * `make` dependency (behavior the dependent consumes) still hard-blocks, unchanged.
 */

import type { ChildPlan } from '../contract/decision.js';
import type { EventStore } from '../contract/events.js';
import type { Goal, Kind } from '../contract/goal.js';
import type { Report } from '../contract/report.js';
import { structuralFloorMemories, type RegionScanner } from './structural-floor.js';

/** A dependency that produced no artifact and whose blocker would starve the dependent. */
export interface FatalDep {
  blocker: string;
}

/** Fatal dependencies split into the hard-blocking ones and the floorable dive regions. */
export interface FatalDepClassification {
  hard: FatalDep[];
  floorableRegions: string[];
}

/**
 * Partition the dependencies that produced nothing into the ones a build leaf can
 * survive on a structural floor — null-producing comprehension **dives** (their
 * regions can be re-mapped mechanically) — and the ones that must still hard-block
 * (a `make` dependency whose behavior the dependent consumes; ADR-037).
 */
export function classifyFatalDeps(
  depReports: Report[],
  depPlans: (ChildPlan | undefined)[],
  kindOf: (typeName: string) => Kind | undefined,
): FatalDepClassification {
  const hard: FatalDep[] = [];
  const floorableRegions: string[] = [];

  for (let index = 0; index < depReports.length; index++) {
    const report = depReports[index]!;
    if (report.blockers.length === 0 || report.artifact !== null) continue;

    const plan = depPlans[index];
    const isDive = plan !== undefined && kindOf(plan.type) === 'learn';
    if (isDive && plan.scope.length > 0) {
      floorableRegions.push(...plan.scope);
    } else {
      hard.push({ blocker: report.blockers[0] ?? 'unknown' });
    }
  }

  return { hard, floorableRegions };
}

/**
 * Give a build leaf a structural floor for the regions whose dive produced
 * nothing, and carry the null dive forward as a finding (so the block is surfaced,
 * not silently swallowed). Returns the child goal with floor memories appended and
 * the findings to attach to its report; a no-op (empty findings) when there is no
 * floorable region or nothing scannable.
 */
export async function injectStructuralFloor(params: {
  child: ChildPlan;
  childGoal: Goal;
  repoRoot: string;
  regionScanner: RegionScanner | undefined;
  nullDiveRegions: string[];
  store: EventStore;
  now: () => number;
}): Promise<{ childGoal: Goal; findings: string[] }> {
  if (params.nullDiveRegions.length === 0 || params.regionScanner === undefined) {
    return { childGoal: params.childGoal, findings: [] };
  }

  const memories = structuralFloorMemories({
    regions: params.nullDiveRegions,
    scanner: params.regionScanner,
    repoRoot: params.repoRoot,
  });
  if (memories.length === 0) {
    return { childGoal: params.childGoal, findings: [] };
  }

  const regions = [...new Set(params.nullDiveRegions)].join(', ');
  await params.store.append({
    type: 'dependency-degraded',
    at: params.now(),
    goalId: params.childGoal.id,
    dependency: params.child.dependsOn.join(', '),
    blocker: `dive produced no facts for ${regions}; proceeding on a structural floor`,
  });

  return {
    childGoal: { ...params.childGoal, memories: [...params.childGoal.memories, ...memories] },
    findings: [
      `Proceeded on a structural floor for ${regions}: the region dive produced no usable facts, so the builder started from a mechanically-derived file/symbol map (provisional) instead of re-surveying from scratch.`,
    ],
  };
}
