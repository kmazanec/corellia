/**
 * Reap stale tree worktrees (issue D4).
 *
 * Blocked/preserved runs leave `.corellia/worktrees/<id>/` directories and their
 * `tree/*` branches behind on purpose — ADR-026 preserves blocked work as
 * salvage. This reaper does NOT delete that salvage; it only removes worktrees
 * whose work is safely captured elsewhere:
 *
 *   - the DEFAULT pass (run at the start of each sandboxed run) prunes a tree
 *     worktree only when its branch is fully merged into the current branch AND
 *     the worktree has no uncommitted changes — its commits are already in
 *     history, so removing the checkout loses nothing.
 *   - the EXPLICIT pass (CORELLIA_REAP_WORKTREES=1 / reapAll) additionally prunes
 *     UNMERGED but CLEAN tree worktrees (nothing to lose: no uncommitted edits,
 *     and an unmerged branch tip survives the checkout removal).
 *
 * A worktree carrying uncommitted changes is ALWAYS preserved — those edits are
 * unrecoverable once the checkout is gone and are never captured by a merged
 * branch tip. Deleting work is the one irreversible act here, so every ambiguous
 * case is skipped and reported, never pruned.
 */

import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { join, normalize } from 'node:path';
import type { EventStore } from '../contract/events.js';

/** One tree worktree as reported by `git worktree list --porcelain`. */
interface TreeWorktreeEntry {
  path: string;
  branch: string | undefined;
}

export interface ReapOutcome {
  /** Absolute paths of worktrees removed. */
  reaped: string[];
  /** Worktrees left in place, each with the reason it was skipped. */
  skipped: { path: string; reason: string }[];
}

export interface ReapOptions {
  /**
   * Prune all non-active clean tree worktrees, not just merged ones. Still never
   * touches a worktree with uncommitted changes whose tip is unmerged.
   */
  reapAll?: boolean;
  /**
   * A worktree path to treat as active (the run currently opening) — never reaped.
   */
  activePath?: string;
  now?: () => number;
}

const WORKTREES_SEGMENT = join('.corellia', 'worktrees') + '/';

/** Synthetic goalId for reaper events — the reaper is not a live goal. */
const REAPER_ACTOR = 'worktree-reaper';

/**
 * Resolve a path through symlinks for comparison. Falls back to the input when
 * the path no longer exists (a removed worktree), so a missing path still
 * compares stably by its literal form.
 */
function canonical(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/**
 * Reap stale tree worktrees under `<repoRoot>/.corellia/worktrees/`. Safe to call
 * on any repo; a repo with no such worktrees is a no-op. Never throws on a git
 * hiccup for an individual worktree — that worktree is skipped and reported.
 */
export async function reapTreeWorktrees(
  repoRoot: string,
  store: EventStore,
  options: ReapOptions = {},
): Promise<ReapOutcome> {
  const now = options.now ?? (() => Date.now());
  const outcome: ReapOutcome = { reaped: [], skipped: [] };

  // git worktree list reports realpath-resolved paths (on macOS /var → /private/var),
  // so the active-path guard must compare resolved paths or it silently misses.
  const activePath = options.activePath !== undefined ? canonical(options.activePath) : undefined;

  for (const entry of listTreeWorktrees(repoRoot)) {
    if (activePath !== undefined && canonical(entry.path) === activePath) {
      continue; // the run currently opening — never reaped
    }

    const decision = decideReap(repoRoot, entry, options.reapAll ?? false);
    if (!decision.reap) {
      outcome.skipped.push({ path: entry.path, reason: decision.reason });
      continue;
    }

    if (pruneWorktree(repoRoot, entry)) {
      outcome.reaped.push(entry.path);
      await store.append({
        type: 'worktree-reaped',
        at: now(),
        goalId: REAPER_ACTOR,
        path: entry.path,
        ...(entry.branch !== undefined ? { branch: entry.branch } : {}),
        reason: decision.reason,
      });
    } else {
      outcome.skipped.push({ path: entry.path, reason: 'git remove failed' });
    }
  }

  return outcome;
}

/**
 * Whether a tree worktree should be reaped, and why. Encodes the conservative
 * policy: uncommitted changes are only prunable when the branch tip is already
 * merged; otherwise merged→reap always, unmerged→reap only under reapAll.
 */
function decideReap(
  repoRoot: string,
  entry: TreeWorktreeEntry,
  reapAll: boolean,
): { reap: true; reason: string } | { reap: false; reason: string } {
  // Uncommitted changes are unrecoverable once the checkout is removed, and they
  // are never part of a merged branch tip — so a dirty worktree is ALWAYS
  // preserved, regardless of merge state or reapAll. Deleting work is the one
  // irreversible act here; this is the conservative floor.
  if (!isWorktreeClean(entry.path)) {
    return { reap: false, reason: 'worktree has uncommitted changes — preserved as salvage' };
  }

  const merged = entry.branch !== undefined && isBranchMerged(repoRoot, entry.branch);
  if (merged) {
    return { reap: true, reason: 'branch merged into current, worktree clean' };
  }

  if (reapAll) {
    return { reap: true, reason: 'explicit reap: unmerged branch, worktree clean (tip survives)' };
  }

  return { reap: false, reason: 'unmerged branch — preserved (use CORELLIA_REAP_WORKTREES=1 to force)' };
}

/**
 * Parse `git worktree list --porcelain` and return only the tree worktrees the
 * factory owns (those under `.corellia/worktrees/`). The main worktree and any
 * unrelated linked worktrees are excluded.
 */
function listTreeWorktrees(repoRoot: string): TreeWorktreeEntry[] {
  let raw: string;
  try {
    raw = execFileSync('git', ['-C', repoRoot, 'worktree', 'list', '--porcelain'], {
      stdio: 'pipe',
      encoding: 'utf-8',
    });
  } catch {
    return [];
  }

  const entries: TreeWorktreeEntry[] = [];
  let path: string | undefined;
  let branch: string | undefined;
  const flush = (): void => {
    if (path !== undefined && normalize(path + '/').includes(WORKTREES_SEGMENT)) {
      entries.push({ path, branch });
    }
    path = undefined;
    branch = undefined;
  };

  for (const line of raw.split('\n')) {
    if (line.startsWith('worktree ')) {
      flush();
      path = line.slice('worktree '.length).trim();
    } else if (line.startsWith('branch ')) {
      branch = line.slice('branch '.length).trim().replace(/^refs\/heads\//, '');
    }
  }
  flush();
  return entries;
}

/** True when the branch is fully merged into the current branch (HEAD). */
function isBranchMerged(repoRoot: string, branch: string): boolean {
  try {
    execFileSync('git', ['-C', repoRoot, 'merge-base', '--is-ancestor', branch, 'HEAD'], {
      stdio: 'pipe',
    });
    return true;
  } catch {
    return false;
  }
}

/** True when the worktree has no staged/unstaged/untracked changes. */
function isWorktreeClean(worktreePath: string): boolean {
  try {
    const status = execFileSync('git', ['-C', worktreePath, 'status', '--porcelain'], {
      stdio: 'pipe',
      encoding: 'utf-8',
    }).trim();
    return status.length === 0;
  } catch {
    // Cannot determine cleanliness → treat as dirty (conservative: never reap).
    return false;
  }
}

/**
 * Remove one worktree and delete its branch. Returns false on failure so the
 * caller can report it as skipped rather than reaped. `--force` on remove tolerates
 * the dep-symlinks the lifecycle links in; the caller only reaches here for a
 * worktree the policy already judged safe to drop.
 */
function pruneWorktree(repoRoot: string, entry: TreeWorktreeEntry): boolean {
  try {
    execFileSync('git', ['-C', repoRoot, 'worktree', 'remove', '--force', entry.path], {
      stdio: 'pipe',
    });
  } catch {
    return false;
  }
  try {
    execFileSync('git', ['-C', repoRoot, 'worktree', 'prune'], { stdio: 'pipe' });
  } catch {
    /* best-effort */
  }
  if (entry.branch !== undefined) {
    try {
      execFileSync('git', ['-C', repoRoot, 'branch', '-D', entry.branch], { stdio: 'pipe' });
    } catch {
      /* branch already gone, or unmerged under default git -d — -D forces it */
    }
  }
  return true;
}
