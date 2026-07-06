/**
 * Integration tests for the tree worktree reaper (issue D4).
 *
 * Runs against throwaway tmp git repos (git init + real worktrees). The reaper's
 * contract: prune merged worktrees always; prune clean-but-unmerged only under
 * reapAll; never touch uncommitted salvage; never touch the active worktree.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { InMemoryEventStore } from '../../src/eventlog/memory-store.js';
import { openTreeWorktree } from '../../src/engine/worktree.js';
import { reapTreeWorktrees } from '../../src/engine/worktree-reaper.js';

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

function git(repo: string, ...args: string[]): string {
  return execFileSync('git', ['-C', repo, ...args], { stdio: 'pipe', encoding: 'utf-8' }).trim();
}

/** git worktree list reports realpath-resolved paths; resolve for comparison. */
function resolved(path: string): string {
  return existsSync(path) ? realpathSync(path) : path;
}

function makeTempRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'corellia-reap-'));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  execFileSync('git', ['init'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: dir, stdio: 'pipe' });
  writeFileSync(join(dir, 'README.md'), '# test\n');
  execFileSync('git', ['add', 'README.md'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['commit', '-m', 'init'], { cwd: dir, stdio: 'pipe' });
  return dir;
}

/** Commit a file inside a worktree, advancing its branch. */
function commitInTree(root: string, name: string): void {
  writeFileSync(join(root, name), 'work\n');
  execFileSync('git', ['-C', root, 'add', name], { stdio: 'pipe' });
  execFileSync('git', ['-C', root, 'commit', '-m', `add ${name}`], { stdio: 'pipe' });
}

describe('worktree reaper', () => {
  it('default pass removes a worktree whose branch is merged into HEAD', async () => {
    const repo = makeTempRepo();
    const store = new InMemoryEventStore();
    const wt = await openTreeWorktree(repo, 'merged-goal', store);
    commitInTree(wt.root, 'feature.ts');
    // Merge the tree branch into main so its work is in history.
    git(repo, 'merge', '--no-ff', wt.branch, '-m', 'merge tree');
    const root = resolved(wt.root);

    const outcome = await reapTreeWorktrees(repo, store);

    expect(outcome.reaped).toContain(root);
    expect(existsSync(wt.root)).toBe(false);
    // Branch is gone too.
    expect(git(repo, 'branch', '--list', wt.branch)).toBe('');
  });

  it('default pass KEEPS an unmerged clean worktree (salvage)', async () => {
    const repo = makeTempRepo();
    const store = new InMemoryEventStore();
    const wt = await openTreeWorktree(repo, 'unmerged-goal', store);
    commitInTree(wt.root, 'wip.ts'); // committed but never merged
    const root = resolved(wt.root);

    const outcome = await reapTreeWorktrees(repo, store);

    expect(outcome.reaped).toHaveLength(0);
    expect(outcome.skipped.map((s) => s.path)).toContain(root);
    expect(existsSync(wt.root)).toBe(true);
  });

  it('explicit reapAll removes a clean-but-unmerged worktree', async () => {
    const repo = makeTempRepo();
    const store = new InMemoryEventStore();
    const wt = await openTreeWorktree(repo, 'reapall-goal', store);
    commitInTree(wt.root, 'wip.ts');
    const root = resolved(wt.root);

    const outcome = await reapTreeWorktrees(repo, store, { reapAll: true });

    expect(outcome.reaped).toContain(root);
    expect(existsSync(wt.root)).toBe(false);
  });

  it('never touches a worktree with uncommitted changes even under reapAll', async () => {
    const repo = makeTempRepo();
    const store = new InMemoryEventStore();
    const wt = await openTreeWorktree(repo, 'dirty-goal', store);
    writeFileSync(join(wt.root, 'uncommitted.ts'), 'unsaved\n'); // untracked, not committed
    const root = resolved(wt.root);

    const outcome = await reapTreeWorktrees(repo, store, { reapAll: true });

    expect(outcome.reaped).toHaveLength(0);
    expect(existsSync(wt.root)).toBe(true);
    expect(outcome.skipped.find((s) => s.path === root)?.reason).toMatch(/uncommitted|salvage/i);
  });

  it('never reaps the active worktree even when merged', async () => {
    const repo = makeTempRepo();
    const store = new InMemoryEventStore();
    const wt = await openTreeWorktree(repo, 'active-goal', store);
    commitInTree(wt.root, 'feature.ts');
    git(repo, 'merge', '--no-ff', wt.branch, '-m', 'merge tree');

    const outcome = await reapTreeWorktrees(repo, store, { activePath: wt.root });

    expect(outcome.reaped).toHaveLength(0);
    expect(existsSync(wt.root)).toBe(true);
  });

  it('emits a worktree-reaped event for each removed worktree', async () => {
    const repo = makeTempRepo();
    const store = new InMemoryEventStore();
    const wt = await openTreeWorktree(repo, 'evented-goal', store);
    commitInTree(wt.root, 'feature.ts');
    git(repo, 'merge', '--no-ff', wt.branch, '-m', 'merge tree');
    const root = resolved(wt.root);

    await reapTreeWorktrees(repo, store);

    const reapedEvents = (await store.list({ type: 'worktree-reaped' }));
    expect(reapedEvents).toHaveLength(1);
    expect((reapedEvents[0] as { path: string }).path).toBe(root);
  });

  it('is a no-op on a repo with no tree worktrees', async () => {
    const repo = makeTempRepo();
    const store = new InMemoryEventStore();

    const outcome = await reapTreeWorktrees(repo, store);

    expect(outcome.reaped).toHaveLength(0);
    expect(outcome.skipped).toHaveLength(0);
  });
});
