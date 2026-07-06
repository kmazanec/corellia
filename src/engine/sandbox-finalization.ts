import type { EventStore } from '../contract/events.js';
import type { Goal } from '../contract/goal.js';
import type { Report } from '../contract/report.js';
import {
  deriveCollectCommitMessage,
  type ContributingGoal,
} from './collect-commit-message.js';
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
  const contributing = await gatherContributingGoals(params.store, params.goal.id);
  const commitMessage = deriveCollectCommitMessage(params.goal, contributing);
  await collectTree(params.worktree, params.store, commitMessage);
}

/**
 * Collect the goals that contributed to this tree — the root and its
 * descendants — from the `goal-received` events in the log, ordered root-first.
 * Descent is followed through `parentId`, so goals from unrelated concurrent
 * trees sharing the same log are excluded.
 */
async function gatherContributingGoals(
  store: EventStore,
  rootGoalId: string,
): Promise<ContributingGoal[]> {
  const received = await store.list({ type: 'goal-received' });
  const goals = received
    .filter((e): e is Extract<typeof e, { type: 'goal-received' }> => e.type === 'goal-received')
    .map((e) => e.goal);

  const inTree = new Set<string>([rootGoalId]);
  // A single forward pass is not enough if children precede parents in the log;
  // iterate to a fixpoint (the tree is small, so a bounded loop is cheap).
  let grew = true;
  while (grew) {
    grew = false;
    for (const g of goals) {
      if (!inTree.has(g.id) && g.parentId !== null && inTree.has(g.parentId)) {
        inTree.add(g.id);
        grew = true;
      }
    }
  }

  const root = goals.find((g) => g.id === rootGoalId);
  const descendants = goals.filter((g) => g.id !== rootGoalId && inTree.has(g.id));
  const ordered = root !== undefined ? [root, ...descendants] : descendants;
  return ordered.map((g) => ({ id: g.id, title: g.title, type: g.type }));
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
