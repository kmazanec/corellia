/**
 * Invariant (e) worktree lifecycle well-nested: a tree's worktree lifecycle must
 * be well-nested by `treeId` — it is created before it is used (collected /
 * preserved / pushed / pr-opened), and it is not used again after a terminal
 * event (collected or preserved removes/finalises it — a subsequent use is
 * use-after-remove). `worktree-reaped` carries no treeId (it works from `git
 * worktree list`, events.ts:80-86), so it cannot join this check and is excluded
 * — stated honestly rather than guessed.
 *
 * The events express this cleanly (every lifecycle event but reap carries a
 * `treeId`), so this invariant is kept as specified.
 */

import type { FactoryEvent } from '../../contract/events.js';
import type { ConformanceViolation } from './types.js';

export function checkWorktreeLifecycle(events: FactoryEvent[]): ConformanceViolation[] {
  const violations: ConformanceViolation[] = [];

  // Per treeId: index of its creation, and index of its terminal event (if any).
  const createdAt = new Map<string, number>();
  const terminatedAt = new Map<string, number>();

  for (let i = 0; i < events.length; i++) {
    const e = events[i]!;
    const treeId = treeIdOf(e);
    if (treeId === undefined) continue;

    if (e.type === 'worktree-created') {
      // A second create for a live treeId is a lifecycle error (re-create before
      // teardown). A create after termination re-opens the id cleanly — reset.
      if (createdAt.has(treeId) && !terminatedAt.has(treeId)) {
        violations.push({
          invariant: 'worktree-well-nested',
          goalId: e.goalId,
          indices: [createdAt.get(treeId)!, i],
          detail: `worktree "${treeId}" created again (index ${i}) before its prior instance (index ${createdAt.get(treeId)!}) was collected or preserved`,
        });
      }
      createdAt.set(treeId, i);
      terminatedAt.delete(treeId);
      continue;
    }

    // A use event: collected / preserved / branch-pushed / pr-opened.
    if (!createdAt.has(treeId)) {
      violations.push({
        invariant: 'worktree-well-nested',
        goalId: e.goalId,
        indices: [i],
        detail: `worktree "${treeId}" used by ${e.type} (index ${i}) but was never created`,
      });
      continue;
    }
    if (terminatedAt.has(treeId)) {
      violations.push({
        invariant: 'worktree-well-nested',
        goalId: e.goalId,
        indices: [terminatedAt.get(treeId)!, i],
        detail: `worktree "${treeId}" used by ${e.type} (index ${i}) after it was already collected/preserved (index ${terminatedAt.get(treeId)!})`,
      });
      continue;
    }
    if (e.type === 'worktree-collected' || e.type === 'worktree-preserved') {
      terminatedAt.set(treeId, i);
    }
  }

  return violations;
}

/** The treeId a lifecycle event carries, or undefined for events that carry none. */
function treeIdOf(e: FactoryEvent): string | undefined {
  switch (e.type) {
    case 'worktree-created':
    case 'worktree-collected':
    case 'worktree-preserved':
    case 'branch-pushed':
    case 'pr-opened':
      return e.treeId;
    default:
      return undefined;
  }
}
