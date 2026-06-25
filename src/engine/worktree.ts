/**
 * Tree worktree lifecycle: open, diff-vs-scope, collect/preserve, and teardown.
 *
 * Each tree gets one git worktree on a fresh branch under the target repo's
 * .corellia/worktrees/<tree-id>/ (gitignored). The broker binds to that root;
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
  /**
   * The commit the worktree branch forked from (repo HEAD at `worktree add`).
   * The hollow-emit gate counts changes since THIS, not since the moving HEAD —
   * milestone rounds commit their work (advancing HEAD), so `git diff HEAD` would
   * show nothing even though the tree delivered real changes vs. its base.
   */
  baseSha: string;
}

// ---------------------------------------------------------------------------
// Ensure .corellia/worktrees is gitignored via .git/info/exclude.
// Never touches a tracked .gitignore.
//
// Per-tree worktrees live under the target repo's own `.corellia/` namespace,
// which the factory owns end to end.
// ---------------------------------------------------------------------------

const WORKTREES_PATTERN = '.corellia/worktrees/';

// Patterns excluded from git in every worktree (via .git/info/exclude). Beyond
// the worktrees dir itself, the dependency dirs the lifecycle symlinks in
// (node_modules, .venv) must be excluded so they are neither staged by
// collectTree's `git add --all` nor flagged by the scope diff — they are shared
// infrastructure, never part of a tree's deliverable.
//
// NB: NO trailing slash. The lifecycle creates these as SYMLINKS, not
// directories (see openTreeWorktree below). A gitignore pattern ending in `/`
// matches directories ONLY, so `.venv/` does NOT ignore a `.venv` symlink — and
// AC-4 run #8 committed exactly that `.venv` symlink into a cats PR. The bare
// name matches both a directory and a symlink of that name.
const EXCLUDE_PATTERNS = [WORKTREES_PATTERN, 'node_modules', '.venv'];

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

  const presentLines = new Set(existing.split('\n').map((l) => l.trim()));
  const isPresent = (pattern: string): boolean =>
    presentLines.has(pattern) || presentLines.has(pattern.replace(/\/$/, ''));

  // Append any EXCLUDE_PATTERNS not already present (matched with or without a
  // trailing slash). Idempotent: a second open adds nothing.
  const toAdd = EXCLUDE_PATTERNS.filter((p) => !isPresent(p));
  if (toAdd.length > 0) {
    const suffix = existing.length > 0 && !existing.endsWith('\n') ? '\n' : '';
    writeFileSync(excludeFile, existing + suffix + toAdd.join('\n') + '\n', 'utf-8');
  }
}

// ---------------------------------------------------------------------------
// openTreeWorktree
// ---------------------------------------------------------------------------

/**
 * Create a git worktree on a fresh branch under <repoRoot>/.corellia/worktrees/<treeId>/,
 * ensure .corellia/worktrees is gitignored via .git/info/exclude (never touches a
 * tracked .gitignore), and append a worktree-created event.
 *
 * Returns { treeId, branch, root } where root is the absolute worktree path a
 * future broker will bind to as its sandbox root.
 */
export async function openTreeWorktree(
  repoRoot: string,
  rootGoalId: string,
  store: EventStore,
): Promise<{ treeId: string; branch: string; root: string; baseSha: string }> {
  const treeId = sanitizeTreeId(rootGoalId);
  const branch = `tree/${treeId}`;
  const root = join(repoRoot, '.corellia', 'worktrees', treeId);

  // Ensure .corellia/worktrees is gitignored before creating the directory.
  ensureGitignored(repoRoot);

  // The commit the new branch will fork from = the repo's current HEAD. Captured
  // so the hollow-emit gate can diff against it rather than the moving HEAD (which
  // milestone round commits advance). Empty string if the repo has no commits yet.
  let baseSha = '';
  try {
    baseSha = execFileSync('git', ['-C', repoRoot, 'rev-parse', 'HEAD'], {
      stdio: 'pipe', encoding: 'utf-8',
    }).trim();
  } catch {
    baseSha = '';
  }

  // Create the worktree on a new branch.
  // execFileSync with args-array (no shell string).
  execFileSync('git', ['-C', repoRoot, 'worktree', 'add', '-b', branch, root], {
    stdio: 'pipe',
  });

  // A fresh worktree has no installed dependencies, so a target repo's declared
  // scripts (test runners, linters) would fail on toolchain resolution. Link the
  // repo root's per-stack dependency dir in when present — the worktree shares the
  // install, exactly as a human running the suite from a worktree would arrange.
  //   - node_modules: Node/npm toolchains.
  //   - .venv: Python (uv/venv) toolchains. Without this a fresh worktree's
  //     `uv run pytest`/`mypy`/`ruff` auto-creates a venv with RUNTIME deps only
  //     (test/lint deps live in optional-dependencies) → "Failed to spawn pytest"
  //     and the leaf cannot self-verify (AC-4 cats run #1 finding 1).
  // A symlink is enough: tools resolve the dir by path, and it is never committed
  // (the diff/scope check only sees real changed files). The repo root's install
  // is the source of truth, exactly as the node_modules precedent.
  for (const depDir of ['node_modules', '.venv']) {
    const rootDep = join(repoRoot, depDir);
    const treeDep = join(root, depDir);
    if (existsSync(rootDep) && !existsSync(treeDep)) {
      symlinkSync(rootDep, treeDep, 'dir');
    }
  }

  await store.append({
    type: 'worktree-created',
    at: Date.now(),
    goalId: rootGoalId,
    treeId,
    branch,
    path: root,
  });

  return { treeId, branch, root, baseSha };
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
): { ok: boolean; scopeInsufficiency?: string; changedCount: number } {
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

  // Collect all changed paths (de-duplicate). The dependency links the
  // lifecycle itself creates are infrastructure, not work — a symlink named
  // node_modules or .venv evades a `node_modules/`/`.venv/` gitignore rule (a
  // link is not a directory), so they are dropped here explicitly. (AC-4 cats
  // run #4: the .venv symlink surfaced as an out-of-scope change and downgraded
  // a green deliver to a spurious scope-insufficiency block.)
  const DEP_LINKS = ['node_modules', '.venv'];
  const isDepLink = (p: string): boolean =>
    DEP_LINKS.some((d) => p === d || p.startsWith(`${d}/`));
  const all = new Set<string>();
  for (const line of [...diffOutput.split('\n'), ...untrackedOutput.split('\n')]) {
    const p = line.trim();
    if (p.length > 0 && !isDepLink(p)) all.add(p);
  }

  if (all.size === 0) {
    // No worktree change at all. In-scope by vacuity, but the count is 0 — the
    // caller uses changedCount to distinguish a real delivery from a hollow emit
    // (a make root that "succeeded" without writing anything).
    return { ok: true, changedCount: 0 };
  }

  // If scope is empty, allow everything (consistent with isInScope behavior).
  if (scope.length === 0) {
    return { ok: true, changedCount: all.size };
  }

  const offending: string[] = [];
  let inScope = 0;
  for (const p of all) {
    // Reject absolute paths and traversals outright.
    if (isAbsolute(p) || normalize(p).startsWith('..')) {
      offending.push(p);
      continue;
    }
    if (!isInScope(p, scope)) {
      offending.push(p);
    } else {
      inScope++;
    }
  }

  if (offending.length === 0) {
    return { ok: true, changedCount: inScope };
  }

  return {
    ok: false,
    scopeInsufficiency: `File(s) outside declared scope: ${offending.join(', ')}`,
    changedCount: inScope,
  };
}

/**
 * Count files changed within `scope` since the worktree's BASE commit — both
 * committed (`base..HEAD`, which captures milestone round commits) and
 * uncommitted (the single-pass case). This is the hollow-emit signal: a make root
 * that "succeeded" with 0 changes here delivered nothing. Distinct from
 * `diffWithinScope`, which checks the UNCOMMITTED diff against scope at emit and
 * would see nothing once round commits have advanced HEAD. Dep-link paths are
 * dropped (same as diffWithinScope). Any git error → returns a positive count
 * (fail-open: never block a real delivery on a git hiccup).
 */
export function treeChangedWithinScope(
  worktreeRoot: string,
  baseSha: string,
  scope: string[],
): number {
  const gitLines = (args: string[]): string[] => {
    try {
      return execFileSync('git', ['-C', worktreeRoot, ...args], { stdio: 'pipe', encoding: 'utf-8' })
        .trim().split('\n').map((s) => s.trim()).filter(Boolean);
    } catch {
      return [];
    }
  };
  const DEP_LINKS = ['node_modules', '.venv'];
  const isDepLink = (p: string): boolean =>
    DEP_LINKS.some((d) => p === d || p.startsWith(`${d}/`));

  const committed = baseSha ? gitLines(['diff', '--name-only', `${baseSha}..HEAD`]) : [];
  const uncommittedTracked = gitLines(['diff', '--name-only', 'HEAD']);
  const untracked = gitLines(['ls-files', '--others', '--exclude-standard']);

  const all = new Set<string>();
  for (const p of [...committed, ...uncommittedTracked, ...untracked]) {
    if (!isDepLink(p)) all.add(p);
  }
  if (all.size === 0) {
    // Genuinely no change. (If git errored on EVERY query we'd also land here;
    // that is acceptable — the gate treats 0 as hollow only for a make root that
    // ALSO reported success, and a totally broken git would have failed earlier.)
    return 0;
  }
  if (scope.length === 0) return all.size;
  let inScope = 0;
  for (const p of all) {
    if (!isAbsolute(p) && !normalize(p).startsWith('..') && isInScope(p, scope)) inScope++;
  }
  return inScope;
}

// ---------------------------------------------------------------------------
// commitRound  (ADR-031 / ADR-032 §4)
// ---------------------------------------------------------------------------

/**
 * Commit a milestone round's work onto the tree branch WITHOUT removing the
 * worktree. Reuses collectTree's git ops — `git add --all`, check
 * `status --porcelain`, commit if dirty — with a per-round message
 * (`feat(round N): <title>`) and returns the new HEAD sha (null when the round
 * left nothing to commit).
 *
 * This is what advances HEAD within a tree (ADR-032 §4): without it, ADR-019
 * verify-on-read is a no-op across rounds (HEAD never moves, so a round-0
 * knowledge artifact always reads as fresh). Per-round commits are PRESERVED
 * (decision 5): collectTree at tree-end does not squash them — it now commits
 * only residual uncommitted changes after the last round commit.
 */
export function commitRound(
  worktree: TreeWorktree,
  roundIndex: number,
  title: string,
): string | null {
  const { root } = worktree;

  // Stage all changes (respects .git/info/exclude, same trust posture as collectTree).
  execFileSync('git', ['-C', root, 'add', '--all'], { stdio: 'pipe' });

  // Nothing to commit → HEAD does not advance this round.
  const statusOutput = execFileSync(
    'git',
    ['-C', root, 'status', '--porcelain'],
    { stdio: 'pipe', encoding: 'utf-8' },
  ).trim();
  if (statusOutput.length === 0) {
    return null;
  }

  execFileSync(
    'git',
    ['-C', root, 'commit', '-m', `feat(round ${roundIndex}): ${title}`],
    { stdio: 'pipe' },
  );

  return execFileSync(
    'git',
    ['-C', root, 'rev-parse', 'HEAD'],
    { stdio: 'pipe', encoding: 'utf-8' },
  ).trim();
}

// ---------------------------------------------------------------------------
// diffBodiesWithinScope  (ADR-032 §6)
// ---------------------------------------------------------------------------

/** The default per-file body cap (chars) before truncation, and the total cap. */
const DIFF_BODY_PER_FILE_CAP = 8_000;
const DIFF_BODY_TOTAL_CAP = 40_000;

/**
 * One in-scope file changed since a ref, with its (capped) body. Feeds round N's
 * decide context as quoted DATA (weighed, not obeyed).
 */
export interface ChangedBody {
  path: string;
  /** The file's current body in the worktree, truncated to the per-file cap. */
  body: string;
  /** True when the body was truncated at the per-file cap. */
  truncated: boolean;
}

/**
 * Sibling of {@link diffWithinScope}: the same `git diff --name-only` +
 * `ls-files` machinery, restricted to `sinceRef..HEAD` (plus any working-tree
 * changes since), returning the capped/truncated BODIES of in-scope changed
 * paths. This is the real cross-round read path (ADR-032 §6): it reads the
 * working tree + commits, which actually contain round N-1's built files, not a
 * function returning a count.
 *
 * Reuses {@link isInScope} and the same DEP_LINKS drop as diffWithinScope. The
 * total body output is capped so a fat round yields a truncated digest, not an
 * unbounded context blow-up.
 */
export function diffBodiesWithinScope(
  worktreeRoot: string,
  scope: string[],
  sinceRef: string,
): ChangedBody[] {
  // Tracked changes since the ref (committed across rounds AND working-tree).
  const diffOutput = execFileSync(
    'git',
    ['-C', worktreeRoot, 'diff', '--name-only', sinceRef],
    { stdio: 'pipe', encoding: 'utf-8' },
  ).trim();

  // Untracked files (newly written this round, not yet committed).
  const untrackedOutput = execFileSync(
    'git',
    ['-C', worktreeRoot, 'ls-files', '--others', '--exclude-standard'],
    { stdio: 'pipe', encoding: 'utf-8' },
  ).trim();

  // Same dependency-link drop as diffWithinScope: a node_modules/.venv symlink is
  // infrastructure, never a tree's deliverable.
  const DEP_LINKS = ['node_modules', '.venv'];
  const isDepLink = (p: string): boolean =>
    DEP_LINKS.some((d) => p === d || p.startsWith(`${d}/`));

  const paths: string[] = [];
  const seen = new Set<string>();
  for (const line of [...diffOutput.split('\n'), ...untrackedOutput.split('\n')]) {
    const p = line.trim();
    if (p.length === 0 || isDepLink(p) || seen.has(p)) continue;
    if (isAbsolute(p) || normalize(p).startsWith('..')) continue;
    if (!isInScope(p, scope)) continue;
    seen.add(p);
    paths.push(p);
  }

  const bodies: ChangedBody[] = [];
  let total = 0;
  for (const p of paths) {
    if (total >= DIFF_BODY_TOTAL_CAP) break;
    const abs = join(worktreeRoot, p);
    let raw: string;
    try {
      raw = readFileSync(abs, 'utf-8');
    } catch {
      // File was deleted this round (in the diff, gone on disk) — skip its body.
      continue;
    }
    const remaining = DIFF_BODY_TOTAL_CAP - total;
    const perFileCap = Math.min(DIFF_BODY_PER_FILE_CAP, remaining);
    const truncated = raw.length > perFileCap;
    const body = truncated ? raw.slice(0, perFileCap) : raw;
    total += body.length;
    bodies.push({ path: p, body, truncated });
  }

  return bodies;
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
