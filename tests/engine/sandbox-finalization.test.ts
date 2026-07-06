import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Report } from '../../src/contract/report.js';
import { finalizeSandboxedRun } from '../../src/engine/sandbox-finalization.js';
import { openTreeWorktree, type TreeWorktree } from '../../src/engine/worktree.js';
import { makeGoal, MemoryEventStore, textArtifact } from './stubs.js';

const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()!();
});

function makeTempRepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'corellia-finalize-'));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  execFileSync('git', ['init'], { cwd: root, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: root, stdio: 'pipe' });
  writeFileSync(join(root, 'README.md'), '# test\n');
  execFileSync('git', ['add', 'README.md'], { cwd: root, stdio: 'pipe' });
  execFileSync('git', ['commit', '-m', 'init'], { cwd: root, stdio: 'pipe' });
  return root;
}

async function openWorktree(goalId = 'root'): Promise<{
  repo: string;
  worktree: TreeWorktree;
  store: MemoryEventStore;
}> {
  const repo = makeTempRepo();
  const store = new MemoryEventStore();
  const opened = await openTreeWorktree(repo, goalId, store);
  const worktree: TreeWorktree = {
    ...opened,
    repoRoot: repo,
    goalId,
  };
  return { repo, worktree, store };
}

function report(overrides: Partial<Report> = {}): Report {
  return {
    artifact: textArtifact('done'),
    proof: [],
    lessons: [],
    memoriesUsed: [],
    blockers: [],
    findings: [],
    learned: '',
    ...overrides,
  };
}

describe('sandbox finalization', () => {
  it('preserves the worktree when the run throws before producing a report', async () => {
    const { worktree, store } = await openWorktree('thrown');

    await finalizeSandboxedRun({
      goal: makeGoal({ id: 'thrown' }),
      report: undefined,
      worktree,
      store,
      now: () => 1,
    });

    expect(await store.list({ type: 'worktree-preserved' })).toMatchObject([
      { goalId: 'thrown', reason: 'tree threw before producing a report' },
    ]);
    expect(existsSync(worktree.root)).toBe(true);
  });

  it('preserves the worktree when the report blocks', async () => {
    const { worktree, store } = await openWorktree('blocked');

    await finalizeSandboxedRun({
      goal: makeGoal({ id: 'blocked' }),
      report: report({ blockers: ['scope escaped'] }),
      worktree,
      store,
      now: () => 1,
    });

    expect(await store.list({ type: 'worktree-preserved' })).toMatchObject([
      { goalId: 'blocked', reason: 'tree blocked: scope escaped' },
    ]);
  });

  it('collects a successful worktree', async () => {
    const { worktree, store } = await openWorktree('success');
    writeFileSync(join(worktree.root, 'feature.txt'), 'delivered\n');

    await finalizeSandboxedRun({
      goal: makeGoal({ id: 'success' }),
      report: report(),
      worktree,
      store,
      now: () => 1,
    });

    expect(await store.list({ type: 'worktree-collected' })).toMatchObject([
      { goalId: 'success', commits: [expect.any(String)] },
    ]);
    expect(existsSync(worktree.root)).toBe(false);
  });

  it('records a files-touched event marking each file in/out of declared scope (C1)', async () => {
    const { worktree, store } = await openWorktree('scoped');
    // In scope: public/. Out of scope: src/tax/engine.ts (the tiutni failure shape).
    writeFileSync(join(worktree.root, 'public-page.txt'), 'ui\n');
    const srcTax = join(worktree.root, 'src', 'tax');
    execFileSync('mkdir', ['-p', srcTax], { stdio: 'pipe' });
    writeFileSync(join(srcTax, 'engine.ts'), 'export const rate = 1;\n');

    await finalizeSandboxedRun({
      goal: makeGoal({ id: 'scoped', scope: ['public-page.txt'] }),
      report: report(),
      worktree,
      store,
      now: () => 1,
    });

    const touched = await store.list({ type: 'files-touched' });
    expect(touched).toHaveLength(1);
    const files = (touched[0] as { files: { path: string; inScope: boolean }[] }).files;
    const byPath = new Map(files.map((f) => [f.path, f.inScope]));
    expect(byPath.get('public-page.txt')).toBe(true);
    expect(byPath.get('src/tax/engine.ts')).toBe(false);
  });

  it('writes deliver-intent lifecycle files before collecting', async () => {
    const { repo, worktree, store } = await openWorktree('deliver');
    const now = () => new Date(2026, 5, 27, 12, 0, 0).getTime();

    await finalizeSandboxedRun({
      goal: makeGoal({
        id: 'deliver',
        type: 'deliver-intent',
        title: 'Ship Split Round',
      }),
      report: report(),
      worktree,
      store,
      now,
    });

    const iterFile = execFileSync(
      'git',
      [
        '-C',
        repo,
        'show',
        `${worktree.branch}:docs/iterations/2026-06-27-12-ship-split-round/index.md`,
      ],
      { stdio: 'pipe', encoding: 'utf-8' },
    );
    expect(iterFile).toContain('type: iteration');
    expect(await store.list({ type: 'worktree-collected' })).toHaveLength(1);
  });
});
