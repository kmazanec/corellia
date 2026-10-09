/**
 * Preserve-don't-await on shutdown (ADR-026): record each in-flight tree's
 * worktree as preserved, derived from its intent id exactly as the engine
 * derives it, so the event matches what the engine would have written. The
 * worktrees stay on disk for inspection; nothing waits for a run to finish.
 */

import { join } from 'node:path';

import type { EventStore } from '../contract/events.js';
import { preserveTree, sanitizeTreeId } from '../engine/worktree.js';

export async function preserveInFlight(intentIds: string[], repoRoot: string, store: EventStore, reason: string): Promise<void> {
  await Promise.all(
    intentIds.map(async (intentId) => {
      const treeId = sanitizeTreeId(intentId);
      const branch = `tree/${treeId}`;
      // Same path layout as openTreeWorktree (worktree.ts).
      const root = join(repoRoot, '.corellia', 'worktrees', treeId);
      const worktree = { treeId, branch, root, repoRoot, goalId: intentId, baseSha: '' };
      try {
        await preserveTree(worktree, store, reason);
        console.log(`[shutdown] preserved worktree for intent ${intentId}`);
      } catch (err) {
        console.error(`[shutdown] failed to preserve worktree for ${intentId}:`, err);
      }
    }),
  );
}
