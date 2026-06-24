/**
 * Integration tests for the milestone-loop worktree primitives (ADR-031/032 §5):
 * commitRound (HEAD advances per round, preserved per-round commits) and
 * diffBodiesWithinScope (in-scope bodies returned since a ref).
 *
 * Tests run against throwaway tmp git repos created with git init.
 * Zero live API; git is the system under test.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { InMemoryEventStore } from '../../src/eventlog/memory-store.js';
import {
  openTreeWorktree,
  commitRound,
  diffBodiesWithinScope,
  collectTree,
  type TreeWorktree,
} from '../../src/engine/worktree.js';

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

function makeTempRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'corellia-round-'));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  execFileSync('git', ['init'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: dir, stdio: 'pipe' });
  writeFileSync(join(dir, 'README.md'), '# test\n');
  execFileSync('git', ['add', 'README.md'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['commit', '-m', 'init'], { cwd: dir, stdio: 'pipe' });
  return dir;
}

/** Open a worktree and return the full TreeWorktree descriptor. */
async function openWorktree(repo: string, goalId: string): Promise<TreeWorktree> {
  const store = new InMemoryEventStore();
  const { treeId, branch, root } = await openTreeWorktree(repo, goalId, store);
  return { treeId, branch, root, repoRoot: repo, goalId };
}

/** HEAD sha in a worktree. */
function head(root: string): string {
  return execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], {
    stdio: 'pipe',
    encoding: 'utf-8',
  }).trim();
}

/** Number of commits reachable from HEAD in a worktree. */
function commitCount(root: string): number {
  return Number(
    execFileSync('git', ['-C', root, 'rev-list', '--count', 'HEAD'], {
      stdio: 'pipe',
      encoding: 'utf-8',
    }).trim(),
  );
}

/** Write a file at a (possibly nested) path within the worktree. */
function writeAt(root: string, rel: string, content: string): void {
  const abs = join(root, rel);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, content);
}

// ---------------------------------------------------------------------------
// commitRound — HEAD advances
// ---------------------------------------------------------------------------

describe('commitRound', () => {
  it('advances HEAD when the round wrote changes and returns the new sha', async () => {
    const repo = makeTempRepo();
    const wt = await openWorktree(repo, 'g-advance');
    const before = head(wt.root);

    writeAt(wt.root, 'src/a.ts', 'export const a = 1;\n');
    const sha = commitRound(wt, 0, 'round zero');

    expect(sha).not.toBeNull();
    const after = head(wt.root);
    expect(after).not.toBe(before);
    expect(after).toBe(sha);
  });

  it('returns null and does not advance HEAD when the round was clean', async () => {
    const repo = makeTempRepo();
    const wt = await openWorktree(repo, 'g-clean');
    const before = head(wt.root);

    const sha = commitRound(wt, 1, 'nothing changed');

    expect(sha).toBeNull();
    expect(head(wt.root)).toBe(before);
  });

  it('writes one commit per round (commits are preserved, not squashed)', async () => {
    const repo = makeTempRepo();
    const wt = await openWorktree(repo, 'g-preserve');
    const startCount = commitCount(wt.root);

    writeAt(wt.root, 'src/a.ts', 'a\n');
    const sha0 = commitRound(wt, 0, 'round zero');
    writeAt(wt.root, 'src/b.ts', 'b\n');
    const sha1 = commitRound(wt, 1, 'round one');
    writeAt(wt.root, 'src/c.ts', 'c\n');
    const sha2 = commitRound(wt, 2, 'round two');

    // Three distinct commits, one per round.
    expect(new Set([sha0, sha1, sha2]).size).toBe(3);
    expect(commitCount(wt.root)).toBe(startCount + 3);

    // Per-round commit messages are on the branch (the honest build trail).
    const log = execFileSync('git', ['-C', wt.root, 'log', '--format=%s'], {
      stdio: 'pipe',
      encoding: 'utf-8',
    });
    expect(log).toContain('feat(round 0): round zero');
    expect(log).toContain('feat(round 1): round one');
    expect(log).toContain('feat(round 2): round two');
  });

  it('collectTree after round commits does not squash them; commits only residual changes', async () => {
    const repo = makeTempRepo();
    const wt = await openWorktree(repo, 'g-collect');
    const store = new InMemoryEventStore();

    writeAt(wt.root, 'src/a.ts', 'a\n');
    commitRound(wt, 0, 'round zero');
    writeAt(wt.root, 'src/b.ts', 'b\n');
    commitRound(wt, 1, 'round one');
    const afterRounds = commitCount(wt.root);

    // No residual changes: collectTree adds NO new commit (nothing to squash, nothing left).
    const { commits } = await collectTree(wt, store);
    expect(commits.length).toBe(0);

    // Branch still carries both per-round commits (they were not squashed away).
    const log = execFileSync('git', ['-C', repo, 'log', '--format=%s', wt.branch], {
      stdio: 'pipe',
      encoding: 'utf-8',
    });
    expect(log).toContain('feat(round 0): round zero');
    expect(log).toContain('feat(round 1): round one');
    expect(afterRounds).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// diffBodiesWithinScope — in-scope bodies since a ref
// ---------------------------------------------------------------------------

describe('diffBodiesWithinScope', () => {
  it('returns the body of an in-scope file changed since the ref', async () => {
    const repo = makeTempRepo();
    const wt = await openWorktree(repo, 'g-diff');

    writeAt(wt.root, 'src/a.ts', 'export const a = 1;\n');
    const sinceRef = commitRound(wt, 0, 'round zero')!;

    // Round 1 changes an in-scope file.
    writeAt(wt.root, 'src/a.ts', 'export const a = 2; // changed\n');
    const bodies = diffBodiesWithinScope(wt.root, ['src/'], sinceRef);

    expect(bodies.map((b) => b.path)).toContain('src/a.ts');
    const a = bodies.find((b) => b.path === 'src/a.ts')!;
    expect(a.body).toContain('changed');
    expect(a.truncated).toBe(false);
  });

  it('includes an in-scope file newly written (untracked) since the ref', async () => {
    const repo = makeTempRepo();
    const wt = await openWorktree(repo, 'g-untracked');

    writeAt(wt.root, 'src/a.ts', 'a\n');
    const sinceRef = commitRound(wt, 0, 'round zero')!;

    writeAt(wt.root, 'src/new.ts', 'export const fresh = true;\n');
    const bodies = diffBodiesWithinScope(wt.root, ['src/'], sinceRef);

    expect(bodies.map((b) => b.path)).toContain('src/new.ts');
    expect(bodies.find((b) => b.path === 'src/new.ts')!.body).toContain('fresh');
  });

  it('excludes out-of-scope changed files', async () => {
    const repo = makeTempRepo();
    const wt = await openWorktree(repo, 'g-outscope');

    writeAt(wt.root, 'src/a.ts', 'a\n');
    const sinceRef = commitRound(wt, 0, 'round zero')!;

    writeAt(wt.root, 'src/a.ts', 'a2\n');
    writeAt(wt.root, 'docs/notes.md', 'out of scope\n');
    const bodies = diffBodiesWithinScope(wt.root, ['src/'], sinceRef);

    const paths = bodies.map((b) => b.path);
    expect(paths).toContain('src/a.ts');
    expect(paths).not.toContain('docs/notes.md');
  });

  it('returns nothing when no in-scope file changed since the ref', async () => {
    const repo = makeTempRepo();
    const wt = await openWorktree(repo, 'g-nochange');

    writeAt(wt.root, 'src/a.ts', 'a\n');
    const sinceRef = commitRound(wt, 0, 'round zero')!;

    const bodies = diffBodiesWithinScope(wt.root, ['src/'], sinceRef);
    expect(bodies).toEqual([]);
  });

  it('truncates an oversized body at the per-file cap', async () => {
    const repo = makeTempRepo();
    const wt = await openWorktree(repo, 'g-trunc');

    writeAt(wt.root, 'src/a.ts', 'a\n');
    const sinceRef = commitRound(wt, 0, 'round zero')!;

    // Write a body larger than the 8_000-char per-file cap.
    writeAt(wt.root, 'src/big.ts', 'x'.repeat(20_000));
    const bodies = diffBodiesWithinScope(wt.root, ['src/'], sinceRef);

    const big = bodies.find((b) => b.path === 'src/big.ts')!;
    expect(big.truncated).toBe(true);
    expect(big.body.length).toBeLessThanOrEqual(8_000);
  });
});
