import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Report } from '../../src/contract/report.js';
import { applyRootEmissionGate } from '../../src/engine/root-emission-gate.js';
import {
  buildRegistry,
  leafTypeDef,
  makeGoal,
  MemoryEventStore,
  textArtifact,
} from './stubs.js';

const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()!();
});

function makeTempRepo(): { root: string; baseSha: string } {
  const root = mkdtempSync(join(tmpdir(), 'corellia-root-gate-'));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  execFileSync('git', ['init'], { cwd: root, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: root, stdio: 'pipe' });
  writeFileSync(join(root, 'README.md'), '# test\n');
  execFileSync('git', ['add', 'README.md'], { cwd: root, stdio: 'pipe' });
  execFileSync('git', ['commit', '-m', 'init'], { cwd: root, stdio: 'pipe' });
  const baseSha = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: root,
    stdio: 'pipe',
    encoding: 'utf-8',
  }).trim();
  return { root, baseSha };
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

describe('root emission gate', () => {
  it('blocks hollow make-root success when no worktree change or files artifact exists', async () => {
    const worktree = makeTempRepo();
    const store = new MemoryEventStore();
    const registry = buildRegistry([leafTypeDef({ name: 'implement', kind: 'make' })]);
    const goal = makeGoal({ id: 'g-root', type: 'implement', scope: ['src/'] });

    const gated = await applyRootEmissionGate({
      goal,
      report: report(),
      worktree,
      registry,
      store,
      now: () => 123,
    });

    expect(gated.blockers[0]).toContain('Hollow emit');
    expect(await store.list({ type: 'blocked' })).toHaveLength(1);
  });

  it('allows a files artifact even when the worktree has not changed yet', async () => {
    const worktree = makeTempRepo();
    const store = new MemoryEventStore();
    const registry = buildRegistry([leafTypeDef({ name: 'implement', kind: 'make' })]);
    const goal = makeGoal({ id: 'g-root', type: 'implement', scope: ['src/'] });
    const emitted = report({
      artifact: { kind: 'files', files: [{ path: 'src/index.ts', content: 'export {};\n' }] },
    });

    await expect(
      applyRootEmissionGate({
        goal,
        report: emitted,
        worktree,
        registry,
        store,
        now: () => 123,
      }),
    ).resolves.toBe(emitted);
    expect(await store.list({ type: 'blocked' })).toEqual([]);
  });

  it('blocks root emission when the worktree diff exceeds declared scope', async () => {
    const worktree = makeTempRepo();
    mkdirSync(join(worktree.root, 'docs'), { recursive: true });
    writeFileSync(join(worktree.root, 'docs', 'note.md'), 'out of scope\n');
    const store = new MemoryEventStore();
    const registry = buildRegistry([leafTypeDef({ name: 'implement', kind: 'make' })]);
    const goal = makeGoal({ id: 'g-root', type: 'implement', scope: ['src/'] });

    const gated = await applyRootEmissionGate({
      goal,
      report: report(),
      worktree,
      registry,
      store,
      now: () => 123,
    });

    expect(gated.blockers[0]).toContain('Scope insufficiency at tree emission');
    expect(await store.list({ type: 'blocked' })).toHaveLength(1);
  });
});
