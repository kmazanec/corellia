import type { EventStore } from '../contract/events.js';
import type { Goal } from '../contract/goal.js';
import type { Report } from '../contract/report.js';
import {
  deriveCollectCommitMessage,
  type ContributingGoal,
} from './collect-commit-message.js';
import { createIterationRecord, deleteProvenanceIssue } from './iteration-tools.js';
import { decidePartialDelivery, renderBlockedModules } from './partial-delivery.js';
import {
  collectTree,
  preserveTree,
  treeFilesTouchedVsScope,
  type TreeWorktree,
} from './worktree.js';

export async function finalizeSandboxedRun(params: {
  goal: Goal;
  report: Report | undefined;
  worktree: TreeWorktree;
  store: EventStore;
  now: () => number;
}): Promise<void> {
  const { report, worktree, store, goal, now } = params;
  if (report === undefined) {
    await preserveTree(worktree, store, preservationReason(report));
    return;
  }

  if (report.blockers.length > 0) {
    // A blocked tree preserves as salvage — UNLESS ship-what's-green applies: a
    // mix of green work and blocked-with-nothing modules, where the delivered
    // green subtree passed the root's own gates. Then collect the green work and
    // surface the blocked remainder rather than sink the whole tree (issue A5).
    const decision = decidePartialDelivery({
      report,
      worktreeRoot: worktree.root,
      baseSha: worktree.baseSha,
      scope: goal.scope,
    });
    if (!decision.shipGreen) {
      await preserveTree(worktree, store, preservationReason(report));
      return;
    }
  }

  await collectGreenSubtree({ goal, report, worktree, store, now });
}

/**
 * Collect the worktree and record the collateral events. Shared by the clean and
 * ship-what's-green paths; on a partial delivery it also emits `partial-delivered`
 * and folds the blocked-module enumeration into the collect commit body so the
 * partiality is unmissable to whoever merges the green work.
 */
async function collectGreenSubtree(params: {
  goal: Goal;
  report: Report;
  worktree: TreeWorktree;
  store: EventStore;
  now: () => number;
}): Promise<void> {
  const partial = params.report.partialDelivery;
  const isPartial = params.report.blockers.length > 0 && partial !== undefined;

  if (isPartial) {
    await params.store.append({
      type: 'partial-delivered',
      at: params.now(),
      goalId: params.goal.id,
      blockedModules: partial!.blockedModules,
    });
  }

  integrateDeliveredIntent(params.goal, params.worktree.root, params.now);
  await recordFilesTouched(params);
  const contributing = await gatherContributingGoals(params.store, params.goal.id);
  const commitMessage = deriveCollectCommitMessage(params.goal, contributing);
  const finalMessage = isPartial
    ? {
        subject: commitMessage.subject,
        body: `${commitMessage.body}\n\n${renderBlockedModules(params.report)}`,
      }
    : commitMessage;
  await collectTree(params.worktree, params.store, finalMessage);
}

/**
 * Record every file the tree touched vs its declared scope (C1). Computed while
 * the worktree still exists (collectTree removes it) so the diff is available,
 * and emitted as a `files-touched` event — the report surface a reviewer reads
 * to catch an out-of-scope edit without running `git show`.
 */
async function recordFilesTouched(params: {
  goal: Goal;
  worktree: TreeWorktree;
  store: EventStore;
  now: () => number;
}): Promise<void> {
  const files = treeFilesTouchedVsScope(
    params.worktree.root,
    params.worktree.baseSha,
    params.goal.scope,
  );
  if (files.length === 0) return;
  await params.store.append({
    type: 'files-touched',
    at: params.now(),
    goalId: params.goal.id,
    scope: params.goal.scope,
    files,
  });
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
