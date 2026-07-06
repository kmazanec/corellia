/**
 * Integration tests for the tree worktree lifecycle module.
 *
 * Tests run against throwaway tmp git repos created with fs.mkdtemp + git init.
 * Zero live API; git is the system under test.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { InMemoryEventStore } from '../../src/eventlog/memory-store.js';
import {
  openTreeWorktree,
  diffWithinScope,
  treeChangedWithinScope,
  collectTree,
  preserveTree,
  sanitizeTreeId,
  worktreeFilesArtifact,
} from '../../src/engine/worktree.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

/**
 * Create a fresh temp git repo with user.name and user.email configured so
 * git commits work without a global config.
 */
function makeTempRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'corellia-wt-'));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));

  execFileSync('git', ['init'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: dir, stdio: 'pipe' });

  // Create an initial commit so HEAD exists (required for some git commands).
  writeFileSync(join(dir, 'README.md'), '# test\n');
  execFileSync('git', ['add', 'README.md'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['commit', '-m', 'init'], { cwd: dir, stdio: 'pipe' });

  return dir;
}

/** Read .git/info/exclude from a repo root, returning '' if absent. */
function readExclude(repoRoot: string): string {
  const excludePath = join(repoRoot, '.git', 'info', 'exclude');
  if (!existsSync(excludePath)) return '';
  return readFileSync(excludePath, 'utf-8');
}

// ---------------------------------------------------------------------------
// open worktree
// ---------------------------------------------------------------------------

describe('open worktree', () => {
  it('branch exists in the repo after open', async () => {
    const repo = makeTempRepo();
    const store = new InMemoryEventStore();

    const result = await openTreeWorktree(repo, 'root-goal-1', store);

    // Verify the branch was created.
    const branches = execFileSync('git', ['branch', '--list', result.branch], {
      cwd: repo,
      stdio: 'pipe',
      encoding: 'utf-8',
    }).trim();
    expect(branches).toContain(result.branch);
  });

  it('worktree directory exists at the returned absolute root', async () => {
    const repo = makeTempRepo();
    const store = new InMemoryEventStore();

    const result = await openTreeWorktree(repo, 'root-goal-1', store);

    expect(existsSync(result.root)).toBe(true);
  });

  it('returned root is an absolute path inside the repo', async () => {
    const repo = makeTempRepo();
    const store = new InMemoryEventStore();

    const result = await openTreeWorktree(repo, 'root-goal-1', store);

    expect(result.root.startsWith('/')).toBe(true);
    expect(result.root).toContain('.corellia/worktrees/');
  });

  it('.git/info/exclude gains the .corellia/worktrees/ entry when absent', async () => {
    const repo = makeTempRepo();
    const store = new InMemoryEventStore();

    // Verify exclude does not have the entry before.
    const before = readExclude(repo);
    expect(before).not.toContain('.corellia/worktrees/');

    await openTreeWorktree(repo, 'root-goal-1', store);

    const after = readExclude(repo);
    expect(after).toContain('.corellia/worktrees/');
  });

  it('tracked .gitignore is left byte-for-byte unmodified when present', async () => {
    const repo = makeTempRepo();
    const store = new InMemoryEventStore();

    // Add a tracked .gitignore (committed).
    const gitignorePath = join(repo, '.gitignore');
    const originalContent = 'node_modules/\ndist/\n';
    writeFileSync(gitignorePath, originalContent);
    execFileSync('git', ['add', '.gitignore'], { cwd: repo, stdio: 'pipe' });
    execFileSync('git', ['commit', '-m', 'add gitignore'], { cwd: repo, stdio: 'pipe' });

    await openTreeWorktree(repo, 'root-goal-2', store);

    // .gitignore must be byte-for-byte identical.
    const after = readFileSync(gitignorePath, 'utf-8');
    expect(after).toBe(originalContent);
  });

  it('appends a worktree-created event with correct fields', async () => {
    const repo = makeTempRepo();
    const store = new InMemoryEventStore();

    const result = await openTreeWorktree(repo, 'goal/tree-root', store);

    const events = await store.list({ type: 'worktree-created' });
    expect(events).toHaveLength(1);
    const e = events[0];
    expect(e).toBeDefined();
    if (!e || e.type !== 'worktree-created') throw new Error('wrong event type');
    expect(e.goalId).toBe('goal/tree-root');
    expect(e.treeId).toBe(result.treeId);
    expect(e.branch).toBe(result.branch);
    expect(e.path).toBe(result.root);
  });

  it('sanitizes tree id from goal id with slashes', async () => {
    const repo = makeTempRepo();
    const store = new InMemoryEventStore();

    const result = await openTreeWorktree(repo, 'parent/child/leaf', store);

    // treeId must not contain '/' — branch name would be invalid otherwise.
    expect(result.treeId).not.toContain('/');
    expect(result.branch).toContain('tree/');
  });
});

// ---------------------------------------------------------------------------
// diff vs scope
// ---------------------------------------------------------------------------

describe('ignored files and the diff scope check', () => {
  it('gitignored paths (including the dependency link) never trip diffWithinScope', async () => {
    const repo = makeTempRepo();
    writeFileSync(join(repo, '.gitignore'), 'node_modules/\n');
    execFileSync('git', ['-C', repo, 'add', '.gitignore'], { stdio: 'pipe' });
    execFileSync('git', ['-C', repo, 'commit', '-m', 'ignore deps'], { stdio: 'pipe' });
    mkdirSync(join(repo, 'node_modules', 'fixture-pkg'), { recursive: true });
    writeFileSync(join(repo, 'node_modules', 'fixture-pkg', 'index.js'), 'module.exports = 1;\n');
    const store = new InMemoryEventStore();
    const wt = await openTreeWorktree(repo, 'ignored-goal', store);
    const res = diffWithinScope(wt.root, ['src/']);
    expect(res.ok).toBe(true);
  });

  it('the .venv dependency symlink never trips diffWithinScope (AC-4 run #4)', async () => {
    // The repo does NOT gitignore .venv; the worktree-creation exclude + the
    // diff-filter must both keep the symlinked .venv out of the scope diff, or a
    // green deliver downgrades to a spurious scope-insufficiency block.
    const repo = makeTempRepo();
    mkdirSync(join(repo, '.venv', 'bin'), { recursive: true });
    writeFileSync(join(repo, '.venv', 'bin', 'pytest'), '#!/bin/sh\n');
    const store = new InMemoryEventStore();
    const wt = await openTreeWorktree(repo, 'venv-scope-goal', store);
    // Write an in-scope change so the diff is non-empty but valid.
    mkdirSync(join(wt.root, 'src'), { recursive: true });
    writeFileSync(join(wt.root, 'src', 'feature.txt'), 'work\n');
    const res = diffWithinScope(wt.root, ['src/']);
    expect(res.ok).toBe(true);
  });
});

describe('dependency link', () => {
  it('links the repo root node_modules into a fresh worktree when present', async () => {
    const repo = makeTempRepo();
    mkdirSync(join(repo, 'node_modules', 'fixture-pkg'), { recursive: true });
    writeFileSync(join(repo, 'node_modules', 'fixture-pkg', 'index.js'), 'module.exports = 1;\n');
    const store = new InMemoryEventStore();
    const wt = await openTreeWorktree(repo, 'link-goal', store);
    expect(existsSync(join(wt.root, 'node_modules', 'fixture-pkg', 'index.js'))).toBe(true);
  });

  it('links the repo root .venv into a fresh worktree when present (Python toolchain)', async () => {
    // AC-4 cats run #1 finding 1: a fresh worktree without the synced .venv makes
    // `uv run pytest`/`mypy`/`ruff` fail to spawn, so the leaf cannot self-verify.
    const repo = makeTempRepo();
    mkdirSync(join(repo, '.venv', 'bin'), { recursive: true });
    writeFileSync(join(repo, '.venv', 'bin', 'pytest'), '#!/bin/sh\n');
    const store = new InMemoryEventStore();
    const wt = await openTreeWorktree(repo, 'venv-goal', store);
    expect(existsSync(join(wt.root, '.venv', 'bin', 'pytest'))).toBe(true);
  });
});

describe('diff vs scope', () => {
  it('returns ok:true when no files are changed', async () => {
    const repo = makeTempRepo();
    const store = new InMemoryEventStore();

    const wt = await openTreeWorktree(repo, 'goal-diff-1', store);

    const result = diffWithinScope(wt.root, ['src/']);
    expect(result.ok).toBe(true);
    expect(result.scopeInsufficiency).toBeUndefined();
    // changedCount 0 is the hollow-emit signal the emission gate reads.
    expect(result.changedCount).toBe(0);
  });

  it('returns ok:true with a positive changedCount when changed file is within scope', async () => {
    const repo = makeTempRepo();
    const store = new InMemoryEventStore();

    const wt = await openTreeWorktree(repo, 'goal-diff-2', store);

    // Write a file inside scope directly to the worktree filesystem.
    const srcDir = join(wt.root, 'src');
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(join(srcDir, 'index.ts'), 'export const x = 1;\n');

    const result = diffWithinScope(wt.root, ['src/']);
    expect(result.ok).toBe(true);
    expect(result.scopeInsufficiency).toBeUndefined();
    expect(result.changedCount).toBe(1);
  });

  it('returns ok:false when an out-of-scope file was written (script-mutated-file case)', async () => {
    const repo = makeTempRepo();
    const store = new InMemoryEventStore();

    const wt = await openTreeWorktree(repo, 'goal-diff-3', store);

    // Write an out-of-scope file directly to the worktree fs (simulates run_script side effect).
    const outsideDir = join(wt.root, 'outside');
    mkdirSync(outsideDir, { recursive: true });
    writeFileSync(join(outsideDir, 'secret.ts'), 'export const bad = true;\n');

    const result = diffWithinScope(wt.root, ['src/']);
    expect(result.ok).toBe(false);
    expect(result.scopeInsufficiency).toBeDefined();
    expect(result.scopeInsufficiency).toContain('outside/secret.ts');
  });

  it('treeChangedWithinScope: 0 for an untouched tree (the hollow-emit signal)', async () => {
    const repo = makeTempRepo();
    const store = new InMemoryEventStore();
    const wt = await openTreeWorktree(repo, 'goal-tc-0', store);
    expect(treeChangedWithinScope(wt.root, wt.baseSha, ['src/'])).toBe(0);
  });

  it('treeChangedWithinScope: counts an uncommitted in-scope write', async () => {
    const repo = makeTempRepo();
    const store = new InMemoryEventStore();
    const wt = await openTreeWorktree(repo, 'goal-tc-1', store);
    mkdirSync(join(wt.root, 'src'), { recursive: true });
    writeFileSync(join(wt.root, 'src', 'new.ts'), 'export const x = 1;\n');
    expect(treeChangedWithinScope(wt.root, wt.baseSha, ['src/'])).toBe(1);
  });

  it('treeChangedWithinScope: counts COMMITTED changes since base (the milestone-round case)', async () => {
    // The bug the base-SHA fix addresses: a milestone round COMMITS its work,
    // advancing HEAD, so `git diff HEAD` shows nothing — but the change is real
    // vs. the base the worktree forked from.
    const repo = makeTempRepo();
    const store = new InMemoryEventStore();
    const wt = await openTreeWorktree(repo, 'goal-tc-2', store);
    mkdirSync(join(wt.root, 'src'), { recursive: true });
    writeFileSync(join(wt.root, 'src', 'committed.ts'), 'export const y = 2;\n');
    execFileSync('git', ['-C', wt.root, 'add', '--all'], { stdio: 'pipe' });
    execFileSync('git', ['-C', wt.root, 'commit', '-m', 'feat(round 1): work'], { stdio: 'pipe' });
    // git diff HEAD now sees nothing...
    expect(diffWithinScope(wt.root, ['src/']).changedCount).toBe(0);
    // ...but treeChangedWithinScope counts it against the base.
    expect(treeChangedWithinScope(wt.root, wt.baseSha, ['src/'])).toBe(1);
  });

  it('treeChangedWithinScope: an out-of-scope change does not count', async () => {
    const repo = makeTempRepo();
    const store = new InMemoryEventStore();
    const wt = await openTreeWorktree(repo, 'goal-tc-3', store);
    mkdirSync(join(wt.root, 'other'), { recursive: true });
    writeFileSync(join(wt.root, 'other', 'x.ts'), 'export const z = 3;\n');
    expect(treeChangedWithinScope(wt.root, wt.baseSha, ['src/'])).toBe(0);
  });

  it('names all offending paths in the insufficiency report', async () => {
    const repo = makeTempRepo();
    const store = new InMemoryEventStore();

    const wt = await openTreeWorktree(repo, 'goal-diff-4', store);

    // Two out-of-scope files.
    mkdirSync(join(wt.root, 'other'), { recursive: true });
    writeFileSync(join(wt.root, 'other', 'a.ts'), 'a');
    writeFileSync(join(wt.root, 'other', 'b.ts'), 'b');

    const result = diffWithinScope(wt.root, ['src/']);
    expect(result.ok).toBe(false);
    expect(result.scopeInsufficiency).toContain('other/a.ts');
    expect(result.scopeInsufficiency).toContain('other/b.ts');
  });

  it('returns ok:true when scope is empty (no scope declared: allow all)', async () => {
    const repo = makeTempRepo();
    const store = new InMemoryEventStore();

    const wt = await openTreeWorktree(repo, 'goal-diff-5', store);

    writeFileSync(join(wt.root, 'anywhere.ts'), 'anything');

    const result = diffWithinScope(wt.root, []);
    expect(result.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// collect completed tree
// ---------------------------------------------------------------------------

describe('collect completed tree', () => {
  it('commits work on the branch and the worktree dir is removed', async () => {
    const repo = makeTempRepo();
    const store = new InMemoryEventStore();

    const wtResult = await openTreeWorktree(repo, 'goal-collect-1', store);
    const worktree = {
      treeId: wtResult.treeId,
      branch: wtResult.branch,
      root: wtResult.root,
      repoRoot: repo,
      goalId: 'goal-collect-1',
    };

    // Write a file in the worktree.
    const srcDir = join(wtResult.root, 'src');
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(join(srcDir, 'feature.ts'), 'export const done = true;\n');

    const { commits } = await collectTree(worktree, store);

    // Commits list should be non-empty.
    expect(commits.length).toBeGreaterThan(0);

    // The commit must exist on the branch.
    const logOutput = execFileSync(
      'git',
      ['log', '--oneline', wtResult.branch],
      { cwd: repo, stdio: 'pipe', encoding: 'utf-8' },
    ).trim();
    expect(logOutput).toContain(commits[0]!.substring(0, 7));

    // Worktree directory must be gone.
    expect(existsSync(wtResult.root)).toBe(false);
  });

  it('writes the supplied descriptive commit subject+body (D1)', async () => {
    const repo = makeTempRepo();
    const store = new InMemoryEventStore();

    const wtResult = await openTreeWorktree(repo, 'goal-descriptive', store);
    const worktree = {
      treeId: wtResult.treeId,
      branch: wtResult.branch,
      root: wtResult.root,
      repoRoot: repo,
      goalId: 'goal-descriptive',
    };

    writeFileSync(join(wtResult.root, 'feature.ts'), 'export const done = true;\n');

    await collectTree(worktree, store, {
      subject: 'feat(settings): add a dark-mode toggle',
      body: 'Goals that contributed to this collection:\n- root-1 (deliver-intent): add a dark-mode toggle',
    });

    const message = execFileSync('git', ['log', '-1', '--format=%B', wtResult.branch], {
      cwd: repo,
      stdio: 'pipe',
      encoding: 'utf-8',
    }).trim();
    expect(message).toContain('feat(settings): add a dark-mode toggle');
    expect(message).toContain('- root-1 (deliver-intent): add a dark-mode toggle');
    // The generic placeholder subject must NOT appear.
    expect(message).not.toContain('collect worktree');
  });

  it('does NOT commit the .venv dependency SYMLINK (AC-4 run #8)', async () => {
    // The lifecycle symlinks the repo root's .venv into the worktree. A gitignore
    // pattern ending in `/` matches directories only, so `.venv/` would NOT ignore
    // the .venv SYMLINK — and run #8 committed exactly that symlink into a cats PR.
    // The exclude pattern must be the bare name so `git add --all` skips it.
    const repo = makeTempRepo();
    const store = new InMemoryEventStore();

    // A real .venv at the repo root so openTreeWorktree symlinks it in.
    mkdirSync(join(repo, '.venv', 'bin'), { recursive: true });
    writeFileSync(join(repo, '.venv', 'bin', 'pytest'), '#!/bin/sh\n');

    const wtResult = await openTreeWorktree(repo, 'goal-venv-symlink', store);
    const worktree = {
      treeId: wtResult.treeId,
      branch: wtResult.branch,
      root: wtResult.root,
      repoRoot: repo,
      goalId: 'goal-venv-symlink',
    };
    // The worktree's .venv is a symlink (not a dir).
    expect(existsSync(join(wtResult.root, '.venv', 'bin', 'pytest'))).toBe(true);

    // Write a real feature so the commit is non-empty.
    const srcDir = join(wtResult.root, 'src');
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(join(srcDir, 'feature.ts'), 'export const ok = true;\n');

    await collectTree(worktree, store);

    // List the files in the COMMITTED tree on the tree's branch (the worktree is
    // gone after collect; the commit lives on wtResult.branch).
    const tracked = execFileSync(
      'git',
      ['ls-tree', '-r', '--name-only', wtResult.branch],
      { cwd: repo, stdio: 'pipe', encoding: 'utf-8' },
    );
    expect(tracked).toContain('src/feature.ts');
    expect(tracked).not.toContain('.venv');
  });

  it('appends worktree-collected event with commits and treeId', async () => {
    const repo = makeTempRepo();
    const store = new InMemoryEventStore();

    const wtResult = await openTreeWorktree(repo, 'goal-collect-2', store);
    const worktree = {
      treeId: wtResult.treeId,
      branch: wtResult.branch,
      root: wtResult.root,
      repoRoot: repo,
      goalId: 'goal-collect-2',
    };

    writeFileSync(join(wtResult.root, 'work.ts'), 'export const work = 1;\n');

    await collectTree(worktree, store);

    const events = await store.list({ type: 'worktree-collected' });
    expect(events).toHaveLength(1);
    const e = events[0];
    if (!e || e.type !== 'worktree-collected') throw new Error('wrong event type');
    expect(e.goalId).toBe('goal-collect-2');
    expect(e.treeId).toBe(wtResult.treeId);
    expect(e.branch).toBe(wtResult.branch);
    expect(e.commits).toBeInstanceOf(Array);
  });

  it('works when there are no changes (empty commits array)', async () => {
    const repo = makeTempRepo();
    const store = new InMemoryEventStore();

    const wtResult = await openTreeWorktree(repo, 'goal-collect-empty', store);
    const worktree = {
      treeId: wtResult.treeId,
      branch: wtResult.branch,
      root: wtResult.root,
      repoRoot: repo,
      goalId: 'goal-collect-empty',
    };

    // No changes — collect should still succeed with empty commits.
    const { commits } = await collectTree(worktree, store);
    expect(commits).toHaveLength(0);
    expect(existsSync(wtResult.root)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// preserve failed tree
// ---------------------------------------------------------------------------

describe('preserve failed tree', () => {
  it('worktree directory still exists after preserve', async () => {
    const repo = makeTempRepo();
    const store = new InMemoryEventStore();

    const wtResult = await openTreeWorktree(repo, 'goal-preserve-1', store);
    const worktree = {
      treeId: wtResult.treeId,
      branch: wtResult.branch,
      root: wtResult.root,
      repoRoot: repo,
      goalId: 'goal-preserve-1',
    };

    await preserveTree(worktree, store, 'scope violation detected');

    expect(existsSync(wtResult.root)).toBe(true);
  });

  it('no forced commit is made on preserve', async () => {
    const repo = makeTempRepo();
    const store = new InMemoryEventStore();

    const wtResult = await openTreeWorktree(repo, 'goal-preserve-2', store);
    const worktree = {
      treeId: wtResult.treeId,
      branch: wtResult.branch,
      root: wtResult.root,
      repoRoot: repo,
      goalId: 'goal-preserve-2',
    };

    // Write an uncommitted file.
    writeFileSync(join(wtResult.root, 'dirty.ts'), 'dirty');

    await preserveTree(worktree, store, 'budget exhausted');

    // Log on the branch must only have the initial commit — no new commit.
    const logOutput = execFileSync(
      'git',
      ['log', '--oneline', wtResult.branch],
      { cwd: repo, stdio: 'pipe', encoding: 'utf-8' },
    ).trim();
    const lines = logOutput.split('\n').filter((l) => l.trim().length > 0);
    // Branch starts from main's HEAD, so only 1 commit (init).
    expect(lines).toHaveLength(1);
  });

  it('appends worktree-preserved event with reason and path', async () => {
    const repo = makeTempRepo();
    const store = new InMemoryEventStore();

    const wtResult = await openTreeWorktree(repo, 'goal-preserve-3', store);
    const worktree = {
      treeId: wtResult.treeId,
      branch: wtResult.branch,
      root: wtResult.root,
      repoRoot: repo,
      goalId: 'goal-preserve-3',
    };

    await preserveTree(worktree, store, 'tree failed: scope violation');

    const events = await store.list({ type: 'worktree-preserved' });
    expect(events).toHaveLength(1);
    const e = events[0];
    if (!e || e.type !== 'worktree-preserved') throw new Error('wrong event type');
    expect(e.goalId).toBe('goal-preserve-3');
    expect(e.treeId).toBe(wtResult.treeId);
    expect(e.branch).toBe(wtResult.branch);
    expect(e.path).toBe(wtResult.root);
    expect(e.reason).toBe('tree failed: scope violation');
  });
});

// ---------------------------------------------------------------------------
// concurrent trees on one repo
// ---------------------------------------------------------------------------

describe('concurrent trees', () => {
  it('two trees get distinct branch names and root paths', async () => {
    const repo = makeTempRepo();
    const store = new InMemoryEventStore();

    const wt1 = await openTreeWorktree(repo, 'tree-a', store);
    const wt2 = await openTreeWorktree(repo, 'tree-b', store);

    expect(wt1.branch).not.toBe(wt2.branch);
    expect(wt1.root).not.toBe(wt2.root);
    expect(wt1.treeId).not.toBe(wt2.treeId);
  });

  it('file written in tree A is absent from tree B (mutual write-invisibility)', async () => {
    const repo = makeTempRepo();
    const store = new InMemoryEventStore();

    const wt1 = await openTreeWorktree(repo, 'tree-alpha', store);
    const wt2 = await openTreeWorktree(repo, 'tree-beta', store);

    // Write a file only in tree A.
    const fileInA = join(wt1.root, 'only-in-a.ts');
    writeFileSync(fileInA, 'export const a = true;\n');

    // The file must NOT exist in tree B's root.
    const fileInB = join(wt2.root, 'only-in-a.ts');
    expect(existsSync(fileInB)).toBe(false);
  });

  it('two trees emit distinct worktree-created events', async () => {
    const repo = makeTempRepo();
    const store = new InMemoryEventStore();

    const wt1 = await openTreeWorktree(repo, 'tree-x', store);
    const wt2 = await openTreeWorktree(repo, 'tree-y', store);

    const events = await store.list({ type: 'worktree-created' });
    expect(events).toHaveLength(2);

    const paths = events
      .filter((e) => e.type === 'worktree-created')
      .map((e) => (e.type === 'worktree-created' ? e.path : ''));
    expect(paths[0]).not.toBe(paths[1]);

    // Cleanup: collect both trees so tmp dirs are fully removed.
    const w1 = { treeId: wt1.treeId, branch: wt1.branch, root: wt1.root, repoRoot: repo, goalId: 'tree-x' };
    const w2 = { treeId: wt2.treeId, branch: wt2.branch, root: wt2.root, repoRoot: repo, goalId: 'tree-y' };
    await collectTree(w1, store);
    await collectTree(w2, store);
  });
});

// ---------------------------------------------------------------------------
// sanitizeTreeId
// ---------------------------------------------------------------------------

describe('sanitizeTreeId', () => {
  it('replaces slashes with dashes and appends 8-hex hash', () => {
    // 'parent/child' → stem 'parent-child' + '-' + sha1('parent/child').slice(0,8)
    expect(sanitizeTreeId('parent/child')).toMatch(/^parent-child-[0-9a-f]{8}$/);
    expect(sanitizeTreeId('parent/child')).toBe('parent-child-f8682dbc');
  });

  it('replaces spaces with dashes and appends 8-hex hash', () => {
    expect(sanitizeTreeId('hello world')).toMatch(/^hello-world-[0-9a-f]{8}$/);
    expect(sanitizeTreeId('hello world')).toBe('hello-world-2aae6c35');
  });

  it('produces a non-empty string for a plain id with hash suffix', () => {
    expect(sanitizeTreeId('simple-id')).toMatch(/^simple-id-[0-9a-f]{8}$/);
    expect(sanitizeTreeId('simple-id')).toBe('simple-id-8cf4cd6e');
  });

  it('is filesystem-safe (no special chars)', () => {
    const result = sanitizeTreeId('a:b?c*d');
    expect(result).toMatch(/^[a-zA-Z0-9._-]+$/);
  });

  it('two goal ids that sanitize to the same stem produce DISTINCT tree ids', () => {
    // 'a/b' and 'a-b' both sanitize to stem 'a-b', but their hashes differ.
    const id1 = sanitizeTreeId('a/b');
    const id2 = sanitizeTreeId('a-b');
    expect(id1).not.toBe(id2);
    // Both must still be filesystem-safe.
    expect(id1).toMatch(/^[a-zA-Z0-9._-]+$/);
    expect(id2).toMatch(/^[a-zA-Z0-9._-]+$/);
  });

  it('collision test: a/b and a-b open distinct branches and dirs successfully', async () => {
    const repo = makeTempRepo();
    const store = new InMemoryEventStore();

    const wt1 = await openTreeWorktree(repo, 'a/b', store);
    const wt2 = await openTreeWorktree(repo, 'a-b', store);

    expect(wt1.branch).not.toBe(wt2.branch);
    expect(wt1.root).not.toBe(wt2.root);
    expect(existsSync(wt1.root)).toBe(true);
    expect(existsSync(wt2.root)).toBe(true);

    // Cleanup.
    const w1 = { treeId: wt1.treeId, branch: wt1.branch, root: wt1.root, repoRoot: repo, goalId: 'a/b' };
    const w2 = { treeId: wt2.treeId, branch: wt2.branch, root: wt2.root, repoRoot: repo, goalId: 'a-b' };
    await collectTree(w1, store);
    await collectTree(w2, store);
  });
});

// ---------------------------------------------------------------------------
// New named-gap tests
// ---------------------------------------------------------------------------

describe('exclude idempotency', () => {
  it('opening a second tree in the same repo adds .corellia/worktrees/ exactly once', async () => {
    const repo = makeTempRepo();
    const store = new InMemoryEventStore();

    // Open two trees sequentially in the same repo.
    const wt1 = await openTreeWorktree(repo, 'idem-goal-1', store);
    const wt2 = await openTreeWorktree(repo, 'idem-goal-2', store);

    const exclude = readExclude(repo);
    // Count occurrences of the exact pattern.
    const occurrences = exclude.split('\n').filter((line) => line.trim() === '.corellia/worktrees/').length;
    expect(occurrences).toBe(1);

    // Cleanup.
    const w1 = { treeId: wt1.treeId, branch: wt1.branch, root: wt1.root, repoRoot: repo, goalId: 'idem-goal-1' };
    const w2 = { treeId: wt2.treeId, branch: wt2.branch, root: wt2.root, repoRoot: repo, goalId: 'idem-goal-2' };
    await collectTree(w1, store);
    await collectTree(w2, store);
  });
});

describe('rename-out-of-scope', () => {
  it('a tracked in-scope file renamed to an out-of-scope path is caught by diffWithinScope', async () => {
    const repo = makeTempRepo();
    const store = new InMemoryEventStore();

    // Commit an in-scope file in the base repo first so the worktree has it tracked.
    mkdirSync(join(repo, 'src'), { recursive: true });
    writeFileSync(join(repo, 'src', 'tracked.ts'), 'export const x = 1;\n');
    execFileSync('git', ['add', 'src/tracked.ts'], { cwd: repo, stdio: 'pipe' });
    execFileSync('git', ['commit', '-m', 'add tracked file'], { cwd: repo, stdio: 'pipe' });

    const wt = await openTreeWorktree(repo, 'rename-goal', store);

    // In the worktree, git mv the in-scope file to an out-of-scope path.
    mkdirSync(join(wt.root, 'lib'), { recursive: true });
    execFileSync('git', ['mv', 'src/tracked.ts', 'lib/moved.ts'], { cwd: wt.root, stdio: 'pipe' });

    // diffWithinScope must detect the out-of-scope destination.
    const result = diffWithinScope(wt.root, ['src/']);
    expect(result.ok).toBe(false);
    expect(result.scopeInsufficiency).toContain('lib/moved.ts');

    // Cleanup: reset and remove worktree.
    execFileSync('git', ['reset', '--hard', 'HEAD'], { cwd: wt.root, stdio: 'pipe' });
    await collectTree(
      { treeId: wt.treeId, branch: wt.branch, root: wt.root, repoRoot: repo, goalId: 'rename-goal' },
      store,
    );
  });
});

// ---------------------------------------------------------------------------
// worktreeFilesArtifact — the tree's delivered state as a files artifact
// ---------------------------------------------------------------------------

describe('worktreeFilesArtifact', () => {
  it('returns committed, uncommitted, and untracked changes at their CURRENT content', () => {
    const repo = makeTempRepo();
    const baseSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, stdio: 'pipe', encoding: 'utf-8' }).trim();

    // Committed round work.
    mkdirSync(join(repo, 'src'), { recursive: true });
    writeFileSync(join(repo, 'src', 'a.ts'), 'export const a = 1;\n');
    execFileSync('git', ['add', '--all'], { cwd: repo, stdio: 'pipe' });
    execFileSync('git', ['commit', '-m', 'round 0'], { cwd: repo, stdio: 'pipe' });
    // Then edited again WITHOUT committing — current content must win.
    writeFileSync(join(repo, 'src', 'a.ts'), 'export const a = 2;\n');
    // Untracked salvage-style work.
    writeFileSync(join(repo, 'src', 'b.ts'), 'export const b = 1;\n');

    const artifact = worktreeFilesArtifact(repo, baseSha);
    expect(artifact?.kind).toBe('files');
    const byPath = new Map((artifact?.files ?? []).map((f) => [f.path, f.content]));
    expect(byPath.get('src/a.ts')).toBe('export const a = 2;\n');
    expect(byPath.get('src/b.ts')).toBe('export const b = 1;\n');
    expect(byPath.has('README.md')).toBe(false); // unchanged since base
  });

  it('returns null for a clean tree and skips deleted files', () => {
    const repo = makeTempRepo();
    const baseSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, stdio: 'pipe', encoding: 'utf-8' }).trim();
    expect(worktreeFilesArtifact(repo, baseSha)).toBeNull();

    // A deletion committed since base cannot appear in a files artifact.
    execFileSync('git', ['rm', 'README.md'], { cwd: repo, stdio: 'pipe' });
    execFileSync('git', ['commit', '-m', 'delete readme'], { cwd: repo, stdio: 'pipe' });
    expect(worktreeFilesArtifact(repo, baseSha)).toBeNull();
  });
});
