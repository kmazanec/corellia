import { describe, expect, it } from 'vitest';
import type { Brain } from '../../src/contract/brain.js';
import type { ChildPlan } from '../../src/contract/decision.js';
import type { Goal } from '../../src/contract/goal.js';
import { ZERO_USAGE } from '../../src/contract/goal.js';
import type { Report } from '../../src/contract/report.js';
import { runSplitRound } from '../../src/engine/split-round.js';
import {
  buildRegistry,
  makeGoal,
  MemoryEventStore,
  NoopMemoryView,
  nonLeafTypeDef,
  textArtifact,
} from './stubs.js';

const child = (overrides: Partial<ChildPlan> & Pick<ChildPlan, 'localId'>): ChildPlan => ({
  localId: overrides.localId,
  type: overrides.type ?? 'leaf',
  title: overrides.title ?? overrides.localId,
  spec: overrides.spec ?? {},
  dependsOn: overrides.dependsOn ?? [],
  scope: overrides.scope ?? [],
  budgetShare: overrides.budgetShare ?? 0.5,
});

const report = (overrides: Partial<Report> = {}): Report => ({
  artifact: textArtifact('child'),
  proof: [],
  lessons: [],
  memoriesUsed: [],
  blockers: [],
  findings: [],
  learned: '',
  ...overrides,
});

const unusedBrain: Brain = {
  async decide() {
    throw new Error('not expected');
  },
  async produce() {
    throw new Error('not expected');
  },
  async judge() {
    throw new Error('not expected');
  },
  async repair() {
    throw new Error('not expected');
  },
  async step() {
    throw new Error('not expected');
  },
};

describe('split round runner', () => {
  it('spawns children, runs dependencies, merges, promotes, and returns child outcomes', async () => {
    const store = new MemoryEventStore();
    const registry = buildRegistry([nonLeafTypeDef({ name: 'splitter' })]);
    const goal = makeGoal({ id: 'root', type: 'splitter' });
    const children = [
      child({ localId: 'b', dependsOn: ['a'] }),
      child({ localId: 'a' }),
    ];
    const runOrder: string[] = [];

    const round = await runSplitRound({
      goal,
      children,
      extraFindings: ['loser finding'],
      memory: new NoopMemoryView(),
      registry,
      brain: unusedBrain,
      goldenCapture: false,
      store,
      now: () => 42,
      activeRepoRoot: undefined,
      worktree: undefined,
      factsForRegions: undefined,
      headSha: undefined,
      regionScanner: undefined,
      checkContext: undefined,
      persist: async () => {},
      async runChild(childGoal: Goal) {
        runOrder.push(childGoal.id);
        return childGoal.id.endsWith('/a')
          ? report({ lessons: ['learned lesson'], memoriesUsed: ['m1'], learned: 'child learned' })
          : report({ artifact: textArtifact('b artifact'), findings: ['b finding'] });
      },
    });

    expect(runOrder).toEqual(['root/a', 'root/b']);
    expect(round).toMatchObject({
      mergedArtifact: textArtifact(['b artifact', 'child'].join('\n')),
      report: {
        artifact: textArtifact(['b artifact', 'child'].join('\n')),
        lessons: ['learned lesson'],
        memoriesUsed: ['m1'],
        findings: ['loser finding', 'b finding'],
        learned: 'child learned',
      },
      passingCount: 0,
      childOutcomes: [
        { plan: children[0], report: { artifact: textArtifact('b artifact') } },
        { plan: children[1], report: { artifact: textArtifact('child') } },
      ],
    });
    expect(await store.list({ type: 'child-spawned' })).toMatchObject([
      { goalId: 'root', childId: 'root/b', dependsOn: ['root/a'] },
      { goalId: 'root', childId: 'root/a', dependsOn: [] },
    ]);
    expect(await store.list({ type: 'memory-written' })).toMatchObject([
      { goalId: 'root/a' },
    ]);
    expect(await store.list({ type: 'memory-reinforced' })).toMatchObject([
      { goalId: 'root/a', memoryId: 'm1', outcome: 'success' },
    ]);
  });

  it('runs integration judgment when the registry exposes judge-integration', async () => {
    const store = new MemoryEventStore();
    const registry = buildRegistry([
      nonLeafTypeDef({ name: 'splitter' }),
      nonLeafTypeDef({ name: 'judge-integration' }),
    ]);
    const brain: Brain = {
      ...unusedBrain,
      async judge() {
        return {
          value: {
            pass: false,
            findings: [{ title: 'missing integration', dimension: 'spec', severity: 'high', gating: true }],
          },
          usage: ZERO_USAGE,
        };
      },
    };

    const round = await runSplitRound({
      goal: makeGoal({ id: 'root', type: 'splitter' }),
      children: [child({ localId: 'a' })],
      memory: new NoopMemoryView(),
      registry,
      brain,
      goldenCapture: false,
      store,
      now: () => 42,
      activeRepoRoot: undefined,
      worktree: undefined,
      factsForRegions: undefined,
      headSha: undefined,
      regionScanner: undefined,
      checkContext: undefined,
      persist: async () => {},
      runChild: async () => report(),
    });

    expect(round.report.blockers).toEqual(['Integration eval failed: missing integration']);
    expect(round.report.findings).toEqual(['Integration eval failed: missing integration']);
  });
});

describe('worktree-derived merged artifact', () => {
  it('derives the merged files artifact from the worktree state, not child emissions', async () => {
    const { mkdtempSync, writeFileSync, mkdirSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { execFileSync } = await import('node:child_process');

    const repo = mkdtempSync(join(tmpdir(), 'corellia-round-wt-'));
    try {
      execFileSync('git', ['init'], { cwd: repo, stdio: 'pipe' });
      execFileSync('git', ['config', 'user.email', 't@t'], { cwd: repo, stdio: 'pipe' });
      execFileSync('git', ['config', 'user.name', 't'], { cwd: repo, stdio: 'pipe' });
      writeFileSync(join(repo, 'README.md'), '# base\n');
      execFileSync('git', ['add', '--all'], { cwd: repo, stdio: 'pipe' });
      execFileSync('git', ['commit', '-m', 'init'], { cwd: repo, stdio: 'pipe' });
      const baseSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, stdio: 'pipe', encoding: 'utf-8' }).trim();

      // The tree's ACTUAL state: one authoritative version of the file.
      mkdirSync(join(repo, 'src'), { recursive: true });
      writeFileSync(join(repo, 'src', 'tool.ts'), 'export const CURRENT = true;\n');

      const store = new MemoryEventStore();
      const registry = buildRegistry([nonLeafTypeDef({ name: 'splitter' })]);

      const round = await runSplitRound({
        goal: makeGoal({ id: 'root', type: 'splitter' }),
        children: [child({ localId: 'a' })],
        memory: new NoopMemoryView(),
        registry,
        brain: unusedBrain,
        goldenCapture: false,
        store,
        now: () => 42,
        activeRepoRoot: repo,
        worktree: { treeId: 't1', branch: 'tree/t1', root: repo, repoRoot: repo, goalId: 'root', baseSha },
        factsForRegions: undefined,
        headSha: undefined,
        regionScanner: undefined,
        checkContext: undefined,
        persist: async () => {},
        // The child emitted a STALE version of the same file — the worktree wins.
        runChild: async () => report({
          artifact: { kind: 'files', files: [{ path: 'src/tool.ts', content: 'export const STALE = true;\n' }] },
        }),
      });

      expect(round.mergedArtifact?.kind).toBe('files');
      const byPath = new Map((round.mergedArtifact?.files ?? []).map((f) => [f.path, f.content]));
      expect(byPath.get('src/tool.ts')).toBe('export const CURRENT = true;\n');
      // Exactly one version per path — no conflicting duplicates.
      expect((round.mergedArtifact?.files ?? []).filter((f) => f.path === 'src/tool.ts')).toHaveLength(1);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});
