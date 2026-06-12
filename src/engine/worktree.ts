/**
 * Tree worktree lifecycle: open, diff-vs-scope, collect/preserve, and teardown.
 *
 * Each tree gets one git worktree on a fresh branch under the target repo's
 * .claude/worktrees/<tree-id>/ (gitignored). The broker binds to that root;
 * on collection the branch's commits are retained and the worktree is removed.
 * On failure/block, the worktree is preserved for inspection and the
 * preservation recorded as an event. (ADR-016)
 */

import { execFileSync } from 'node:child_process';
import { existsSync, symlinkSync, readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { join, normalize, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import type { EventStore } from '../contract/events.js';
import { isInScope } from './tools.js';

// ---------------------------------------------------------------------------
// Sanitize a goal id to a branch/directory-safe string.
// ---------------------------------------------------------------------------

/**
 * Derive a filesystem- and git-ref-safe tree id from a root goal id.
 * Replaces path separators (/) and whitespace with '-'; strips characters
 * that are not safe in branch names. Appends an 8-hex-char sha1 content hash
 * of the raw goalId so that distinct goal ids that sanitize to the same stem
 * (e.g. 'a/b' and 'a-b') always produce DISTINCT tree ids.
 */
export function sanitizeTreeId(goalId: string): string {
  const stem = goalId
    .replace(/[\s/\\]+/g, '-')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/^[-_]+|[-_]+$/g, '') // trim leading/trailing separators
    .substring(0, 80); // cap length for filesystem safety
  const hash = createHash('sha1').update(goalId).digest('hex').slice(0, 8);
  return `${stem}-${hash}`;
}

// ---------------------------------------------------------------------------
// Worktree descriptor
// ---------------------------------------------------------------------------

export interface TreeWorktree {
  /** The sanitized tree id (used for branch name and directory). */
  treeId: string;
  /** The branch created for this worktree. */
  branch: string;
  /** The absolute path of the worktree directory. */
  root: string;
  /** The repo root against which this worktree was created. */
  repoRoot: string;
  /** The goal id of the tree-root goal (for event emission). */
  goalId: string;
}

// ---------------------------------------------------------------------------
// Ensure .claude/worktrees is gitignored via .git/info/exclude.
// Never touches a tracked .gitignore.
// ---------------------------------------------------------------------------

const WORKTREES_PATTERN = '.claude/worktrees/';

/**
 * Resolve the real .git directory for a repo root, following the `gitdir:`
 * indirection a linked worktree's .git FILE carries. Consumers that read or
 * write .git/info/exclude must use this so they target the same file the
 * lifecycle writes.
 */
export function resolveGitDir(repoRoot: string): string {
  const gitFile = join(repoRoot, '.git');
  if (existsSync(gitFile)) {
    const st = statSync(gitFile);
    if (st.isFile()) {
      const content = readFileSync(gitFile, 'utf-8').trim();
      if (content.startsWith('gitdir:')) {
        // The worktree gitdir is <main>/.git/worktrees/<name>; main .git is two up.
        const worktreeGitDir = content.slice('gitdir:'.length).trim();
        return join(worktreeGitDir, '..', '..');
      }
      return gitFile;
    }
    return gitFile;
  }
  return gitFile;
}

function ensureGitignored(repoRoot: string): void {
  const gitDir = resolveGitDir(repoRoot);
  const infoDir = join(gitDir, 'info');
  const excludeFile = join(infoDir, 'exclude');

  // Ensure info/ exists.
  if (!existsSync(infoDir)) {
    mkdirSync(infoDir, { recursive: true });
  }

  // Read existing content (may not exist).
  let existing = '';
  if (existsSync(excludeFile)) {
    existing = readFileSync(excludeFile, 'utf-8');
  }

  // Check if the pattern is already present (any form: with or without trailing slash).
  const alreadyPresent =
    existing.split('\n').some((line) => {
      const t = line.trim();
      return t === WORKTREES_PATTERN || t === WORKTREES_PATTERN.replace(/\/$/, '');
    });

  if (!alreadyPresent) {
    const suffix = existing.length > 0 && !existing.endsWith('\n') ? '\n' : '';
    writeFileSync(excludeFile, existing + suffix + WORKTREES_PATTERN + '\n', 'utf-8');
  }
}

// ---------------------------------------------------------------------------
// openTreeWorktree
// ---------------------------------------------------------------------------

/**
 * Create a git worktree on a fresh branch under <repoRoot>/.claude/worktrees/<treeId>/,
 * ensure .claude/worktrees is gitignored via .git/info/exclude (never touches a
 * tracked .gitignore), and append a worktree-created event.
 *
 * Returns { treeId, branch, root } where root is the absolute worktree path a
 * future broker will bind to as its sandbox root.
 */
export async function openTreeWorktree(
  repoRoot: string,
  rootGoalId: string,
  store: EventStore,
): Promise<{ treeId: string; branch: string; root: string }> {
  const treeId = sanitizeTreeId(rootGoalId);
  const branch = `tree/${treeId}`;
  const root = join(repoRoot, '.claude', 'worktrees', treeId);

  // Ensure .claude/worktrees is gitignored before creating the directory.
  ensureGitignored(repoRoot);

  // Create the worktree on a new branch.
  // execFileSync with args-array (no shell string).
  execFileSync('git', ['-C', repoRoot, 'worktree', 'add', '-b', branch, root], {
    stdio: 'pipe',
  });

  // A fresh worktree has no installed dependencies, so a target repo's declared
  // scripts (test runners, linters) would fail on toolchain resolution. Link the
  // repo root's node_modules in when present — the worktree shares the install,
  // exactly as a human running the suite from a worktree would arrange.
  const rootModules = join(repoRoot, 'node_modules');
  const treeModules = join(root, 'node_modules');
  if (existsSync(rootModules) && !existsSync(treeModules)) {
    symlinkSync(rootModules, treeModules, 'dir');
  }

  await store.append({
    type: 'worktree-created',
    at: Date.now(),
    goalId: rootGoalId,
    treeId,
    branch,
    path: root,
  });

  return { treeId, branch, root };
}

// ---------------------------------------------------------------------------
// diffWithinScope
// ---------------------------------------------------------------------------

/**
 * Run the actual git diff in the worktree (staged + unstaged + untracked) and
 * check every changed path against the declared scope using the same
 * normalize + boundary-suffix predicate as isInScope in tools.ts.
 *
 * Returns { ok: true } when all changed paths are within scope, or
 * { ok: false, scopeInsufficiency } naming the offending paths.
 */
export function diffWithinScope(
  worktreeRoot: string,
  scope: string[],
): { ok: boolean; scopeInsufficiency?: string } {
  // Collect changed paths: all tracked changes (staged + unstaged) via diff HEAD,
  // plus untracked files via ls-files. diff HEAD is a strict superset of
  // diff --cached HEAD, so the redundant --cached exec is omitted.
  const diffOutput = execFileSync(
    'git',
    ['-C', worktreeRoot, 'diff', '--name-only', 'HEAD'],
    { stdio: 'pipe', encoding: 'utf-8' },
  ).trim();

  // Untracked files.
  const untrackedOutput = execFileSync(
    'git',
    ['-C', worktreeRoot, 'ls-files', '--others', '--exclude-standard'],
    { stdio: 'pipe', encoding: 'utf-8' },
  ).trim();

  // Collect all changed paths (de-duplicate).
  const all = new Set<string>();
  for (const line of [...diffOutput.split('\n'), ...untrackedOutput.split('\n')]) {
    const p = line.trim();
    if (p.length > 0) all.add(p);
  }

  if (all.size === 0) {
    return { ok: true };
  }

  // If scope is empty, allow everything (consistent with isInScope behavior).
  if (scope.length === 0) {
    return { ok: true };
  }

  const offending: string[] = [];
  for (const p of all) {
    // Reject absolute paths and traversals outright.
    if (isAbsolute(p) || normalize(p).startsWith('..')) {
      offending.push(p);
      continue;
    }
    if (!isInScope(p, scope)) {
      offending.push(p);
    }
  }

  if (offending.length === 0) {
    return { ok: true };
  }

  return {
    ok: false,
    scopeInsufficiency: `File(s) outside declared scope: ${offending.join(', ')}`,
  };
}

// ---------------------------------------------------------------------------
// collectTree / preserveTree
// ---------------------------------------------------------------------------

/**
 * For a completed (successful) tree: stage all changes, commit them onto the
 * branch, remove the worktree, and append a worktree-collected event.
 *
 * Uses synchronous execFileSync for metadata-mutating git ops so concurrent
 * trees serialize on the shared .git.
 */
export async function collectTree(
  worktree: TreeWorktree,
  store: EventStore,
): Promise<{ commits: string[] }> {
  const { root, repoRoot, branch, treeId, goalId } = worktree;

  // Stage all changes in the worktree. Relies on the target repo's own ignore
  // rules (git add --all respects .git/info/exclude) per ADR-016's trust posture:
  // the operator controls the sandbox root and its contents.
  execFileSync('git', ['-C', root, 'add', '--all'], { stdio: 'pipe' });

  // Check if there's anything to commit.
  const statusOutput = execFileSync(
    'git',
    ['-C', root, 'status', '--porcelain'],
    { stdio: 'pipe', encoding: 'utf-8' },
  ).trim();

  const commits: string[] = [];

  if (statusOutput.length > 0) {
    // Commit the staged changes.
    execFileSync(
      'git',
      ['-C', root, 'commit', '-m', `feat(tree): collect worktree ${treeId}`],
      { stdio: 'pipe' },
    );

    // Get the commit SHA.
    const sha = execFileSync(
      'git',
      ['-C', root, 'rev-parse', 'HEAD'],
      { stdio: 'pipe', encoding: 'utf-8' },
    ).trim();
    commits.push(sha);
  }

  // Remove the worktree.
  execFileSync('git', ['-C', repoRoot, 'worktree', 'remove', root], { stdio: 'pipe' });

  await store.append({
    type: 'worktree-collected',
    at: Date.now(),
    goalId,
    treeId,
    branch,
    commits,
  });

  return { commits };
}

/**
 * For a failed or blocked tree: leave the worktree in place, append a
 * worktree-preserved event with the stated reason.
 */
export async function preserveTree(
  worktree: TreeWorktree,
  store: EventStore,
  reason: string,
): Promise<void> {
  const { root, branch, treeId, goalId } = worktree;

  await store.append({
    type: 'worktree-preserved',
    at: Date.now(),
    goalId,
    treeId,
    branch,
    path: root,
    reason,
  });
}
