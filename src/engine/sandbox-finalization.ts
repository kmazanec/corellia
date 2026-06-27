import type { EventStore } from '../contract/events.js';
import type { Goal } from '../contract/goal.js';
import type { Report } from '../contract/report.js';
import { createIterationRecord, deleteProvenanceIssue } from './iteration-tools.js';
import { collectTree, preserveTree, type TreeWorktree } from './worktree.js';

export async function finalizeSandboxedRun(params: {
  goal: Goal;
  report: Report | undefined;
  worktree: TreeWorktree;
  store: EventStore;
  now: () => number;
}): Promise<void> {
  if (params.report === undefined || params.report.blockers.length > 0) {
    await preserveTree(params.worktree, params.store, preservationReason(params.report));
    return;
  }

  integrateDeliveredIntent(params.goal, params.worktree.root, params.now);
  await collectTree(params.worktree, params.store);
}

function preservationReason(report: Report | undefined): string {
  return report === undefined
    ? 'tree threw before producing a report'
    : `tree blocked: ${report.blockers[0] ?? 'unknown'}`;
}

function integrateDeliveredIntent(
  goal: Goal,
  worktreeRoot: string,
  now: () => number,
): void {
  if (goal.type !== 'deliver-intent') return;

  try {
    createIterationRecord(worktreeRoot, goal, now);
    deleteProvenanceIssue(worktreeRoot, goal);
  } catch (err) {
    console.warn(
      `[corellia] deliver-intent lifecycle integration (ADR-034) failed post-success for ${goal.id}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
