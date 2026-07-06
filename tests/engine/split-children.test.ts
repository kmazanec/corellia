import { describe, expect, it } from 'vitest';
import type { ChildPlan } from '../../src/contract/decision.js';
import type { Goal } from '../../src/contract/goal.js';
import type { MemoryView } from '../../src/contract/memory.js';
import type { Report } from '../../src/contract/report.js';
import type { Kind } from '../../src/contract/goal.js';
import {
  appendChildSpawnedEvents,
  buildSplitChildGoals,
  runSplitChildren,
} from '../../src/engine/split-children.js';
import type { RegionFileEntry, RegionScanner } from '../../src/engine/structural-floor.js';
import { MemoryEventStore, makeGoal, textArtifact } from './stubs.js';

/** A scanner that returns one fixed file per region asked for. */
const fixedScanner = (files: Record<string, RegionFileEntry[]>): RegionScanner => ({
  scanRegion: (_repoRoot, region) => files[region] ?? [],
});

/** kindOf that treats a `dive` type as a comprehension leaf and everything else as make. */
const kindByType = (typeName: string): Kind | undefined => (typeName === 'dive' ? 'learn' : 'make');

const child = (overrides: Partial<ChildPlan> & Pick<ChildPlan, 'localId'>): ChildPlan => ({
  localId: overrides.localId,
  type: overrides.type ?? 'leaf',
  title: overrides.title ?? overrides.localId,
  spec: overrides.spec ?? {},
  dependsOn: overrides.dependsOn ?? [],
  scope: overrides.scope ?? [],
  budgetShare: overrides.budgetShare ?? 0.5,
  ...(overrides.intent !== undefined ? { intent: overrides.intent } : {}),
});

const report = (overrides: Partial<Report> = {}): Report => ({
  artifact: textArtifact('ok'),
  proof: [],
  lessons: [],
  memoriesUsed: [],
  blockers: [],
  findings: [],
  learned: '',
  ...overrides,
});

describe('split child goals', () => {
  it('builds child goals with inherited intent, queried memories, and child ids', async () => {
    const memory: MemoryView = {
      async query(topic, scope) {
        return [{ id: `${topic}:${scope.join(',')}`, layer: 'project', content: 'memory', provenance: 'trusted' }];
      },
    };
    const parent = makeGoal({
      id: 'root',
      intent: 'prototype',
      spendCeilingUsd: 3,
      budget: { attempts: 5, tokens: 100, toolCalls: 20, wallClockMs: 60_000 },
    });

    const [goal] = await buildSplitChildGoals({
      parent,
      children: [child({ localId: 'a', title: 'A', scope: ['src'] })],
      memory,
    });

    expect(goal).toMatchObject({
      id: 'root/a',
      parentId: 'root',
      title: 'A',
      intent: 'prototype',
      spendCeilingUsd: 3,
      memories: [{ id: 'A:src' }],
    });
  });

  it('inherits the full parent wall-clock for every child, regardless of share or type', async () => {
    // ADR-046: no per-child wall-clock slice and no comprehension carve-out — a
    // child inherits the parent's full wall-clock allowance even at a tiny share.
    // Wall-clock is enforced once against the tree deadline, so a wide fan-out can
    // never starve a leaf. A map-repo dive at share 0.01 keeps the full 600_000.
    const parent = makeGoal({
      budget: { attempts: 5, tokens: 100, toolCalls: 20, wallClockMs: 600_000 },
    });

    const [dive, buildLeaf] = await buildSplitChildGoals({
      parent,
      children: [
        child({ localId: 'map', type: 'map-repo', budgetShare: 0.01 }),
        child({ localId: 'build', budgetShare: 0.01 }),
      ],
      memory: { async query() { return []; } },
    });

    expect(dive?.budget.wallClockMs).toBe(600_000);
    expect(buildLeaf?.budget.wallClockMs).toBe(600_000);
  });

  it('appends child-spawned events with global dependency ids', async () => {
    const store = new MemoryEventStore();
    const parent = makeGoal({ id: 'root' });
    const children = [
      child({ localId: 'a' }),
      child({ localId: 'b', dependsOn: ['a'] }),
    ];
    const childGoals = children.map((plan) => makeGoal({ id: `root/${plan.localId}`, type: plan.type }));

    await appendChildSpawnedEvents({ parent, children, childGoals, store, now: () => 1 });

    expect(await store.list({ type: 'child-spawned' })).toMatchObject([
      { childId: 'root/a', dependsOn: [] },
      { childId: 'root/b', dependsOn: ['root/a'] },
    ]);
  });
});

describe('split child runner', () => {
  it('runs children after dependencies even when the dependency is listed later', async () => {
    const store = new MemoryEventStore();
    const parent = makeGoal({ id: 'root' });
    const children = [
      child({ localId: 'b', dependsOn: ['a'] }),
      child({ localId: 'a' }),
    ];
    const childGoals = children.map((plan) => makeGoal({ id: `root/${plan.localId}`, title: plan.title }));
    const order: string[] = [];

    await runSplitChildren({
      parent,
      children,
      childGoals,
      store,
      now: () => 1,
      repoRoot: '',
      factsForRegions: undefined,
      headSha: undefined,
      regionScanner: undefined,
      kindOf: () => 'make',
      async runChild(goal: Goal) {
        order.push(goal.id);
        return report();
      },
    });

    expect(order).toEqual(['root/a', 'root/b']);
  });

  it('blocks a child when a dependency failed without a usable artifact', async () => {
    const store = new MemoryEventStore();
    const parent = makeGoal({ id: 'root' });
    const children = [
      child({ localId: 'a' }),
      child({ localId: 'b', dependsOn: ['a'] }),
    ];
    const childGoals = children.map((plan) => makeGoal({ id: `root/${plan.localId}` }));

    const reports = await runSplitChildren({
      parent,
      children,
      childGoals,
      store,
      now: () => 2,
      repoRoot: '',
      factsForRegions: undefined,
      headSha: undefined,
      regionScanner: undefined,
      kindOf: () => 'make',
      async runChild(goal: Goal) {
        return goal.id.endsWith('/a')
          ? report({ artifact: null, blockers: ['missing dependency output'] })
          : report();
      },
    });

    expect(reports[1]?.blockers[0]).toContain('dependency failed without producing');
    expect(await store.list({ type: 'emitted' })).toMatchObject([
      { goalId: 'root/b' },
    ]);
  });

  it('threads degraded dependency blockers into the dependent child findings', async () => {
    const store = new MemoryEventStore();
    const parent = makeGoal({ id: 'root' });
    const children = [
      child({ localId: 'a' }),
      child({ localId: 'b', dependsOn: ['a'] }),
    ];
    const childGoals = children.map((plan) => makeGoal({ id: `root/${plan.localId}` }));

    const reports = await runSplitChildren({
      parent,
      children,
      childGoals,
      store,
      now: () => 3,
      repoRoot: '',
      factsForRegions: undefined,
      headSha: undefined,
      regionScanner: undefined,
      kindOf: () => 'make',
      async runChild(goal: Goal) {
        return goal.id.endsWith('/a')
          ? report({ artifact: textArtifact('partial'), blockers: ['partial only'] })
          : report({ findings: ['own finding'] });
      },
    });

    expect(reports[1]?.findings).toEqual([
      'own finding',
      'Proceeded on a degraded dependency (a) that blocked but produced a usable partial: partial only',
    ]);
    expect(await store.list({ type: 'dependency-degraded' })).toMatchObject([
      { goalId: 'root/b', dependency: 'root/a', blocker: 'partial only' },
    ]);
  });

  it('injects late dive memories into children before running them', async () => {
    const store = new MemoryEventStore();
    const parent = makeGoal({ id: 'root' });
    const children = [child({ localId: 'build', scope: ['src/engine'] })];
    const childGoals = [makeGoal({ id: 'root/build', scope: ['src/engine'] })];
    let receivedMemories = 0;

    await runSplitChildren({
      parent,
      children,
      childGoals,
      store,
      now: () => 4,
      repoRoot: '/repo',
      regionScanner: undefined,
      kindOf: () => 'make',
      async headSha() {
        return 'head';
      },
      async factsForRegions() {
        return [{
          repoRoot: '/repo',
          region: 'src/engine',
          generatedAtSha: 'head',
          facts: [{
            claim: 'Use split runner',
            anchors: [{ path: 'src/engine/split-children.ts', line: 1 }],
            sha: 'head',
            confidence: 'high',
          }],
        }];
      },
      async runChild(goal: Goal) {
        receivedMemories = goal.memories.length;
        return report();
      },
    });

    expect(receivedMemories).toBe(1);
  });

  it('gives a build leaf a structural floor when its dive dependency produced nothing, instead of hard-blocking', async () => {
    const store = new MemoryEventStore();
    const parent = makeGoal({ id: 'root' });
    const children = [
      child({ localId: 'dive', type: 'dive', scope: ['src/engine'] }),
      child({ localId: 'build', dependsOn: ['dive'], scope: ['src/engine'] }),
    ];
    const childGoals = children.map((plan) =>
      makeGoal({ id: `root/${plan.localId}`, type: plan.type, scope: plan.scope }),
    );
    let builderMemories: { id: string; provenance: string }[] = [];

    const reports = await runSplitChildren({
      parent,
      children,
      childGoals,
      store,
      now: () => 5,
      repoRoot: '/repo',
      factsForRegions: undefined,
      headSha: undefined,
      regionScanner: fixedScanner({
        'src/engine': [{ path: 'src/engine/engine.ts', lines: 4686, bytes: 90000, symbols: ['runGoal'] }],
      }),
      kindOf: kindByType,
      async runChild(goal) {
        if (goal.id.endsWith('/dive')) {
          return report({ artifact: null, blockers: ['Deep-dive region src/engine failed at the highest tier'] });
        }
        builderMemories = goal.memories.map((m) => ({ id: m.id, provenance: m.provenance }));
        return report();
      },
    });

    // The build leaf ran (not hard-blocked) and its report is the runChild report, not a block.
    expect(reports[1]?.blockers).toEqual([]);
    // It received the provisional structural floor for src/engine.
    expect(builderMemories).toEqual(
      expect.arrayContaining([
        { id: 'structural-floor:orientation', provenance: 'provisional' },
        { id: 'structural-floor:src/engine', provenance: 'provisional' },
      ]),
    );
    // The null dive is surfaced as a finding, not silently swallowed.
    expect(reports[1]?.findings.some((f) => f.includes('structural floor'))).toBe(true);
    // And a degraded event records the floor decision.
    expect(await store.list({ type: 'dependency-degraded' })).toMatchObject([
      { goalId: 'root/build', blocker: expect.stringContaining('structural floor') },
    ]);
  });

  it('still hard-blocks when a NON-dive (make) dependency produced nothing', async () => {
    const store = new MemoryEventStore();
    const parent = makeGoal({ id: 'root' });
    const children = [
      child({ localId: 'contract', type: 'leaf', scope: ['src/contract'] }),
      child({ localId: 'build', dependsOn: ['contract'], scope: ['src/engine'] }),
    ];
    const childGoals = children.map((plan) =>
      makeGoal({ id: `root/${plan.localId}`, type: plan.type, scope: plan.scope }),
    );

    const reports = await runSplitChildren({
      parent,
      children,
      childGoals,
      store,
      now: () => 6,
      repoRoot: '/repo',
      factsForRegions: undefined,
      headSha: undefined,
      regionScanner: fixedScanner({ 'src/contract': [{ path: 'src/contract/x.ts', lines: 1, bytes: 1, symbols: [] }] }),
      kindOf: kindByType,
      async runChild(goal) {
        return goal.id.endsWith('/contract')
          ? report({ artifact: null, blockers: ['contract never landed'] })
          : report();
      },
    });

    // A make dependency's missing behavior is not floorable — the dependent hard-blocks.
    expect(reports[1]?.blockers[0]).toContain('dependency failed without producing');
  });

  it('does not floor when the dive produced usable facts (unchanged behavior)', async () => {
    const store = new MemoryEventStore();
    const parent = makeGoal({ id: 'root' });
    const children = [
      child({ localId: 'dive', type: 'dive', scope: ['src/engine'] }),
      child({ localId: 'build', dependsOn: ['dive'], scope: ['src/engine'] }),
    ];
    const childGoals = children.map((plan) =>
      makeGoal({ id: `root/${plan.localId}`, type: plan.type, scope: plan.scope }),
    );
    let builderMemoryIds: string[] = [];

    await runSplitChildren({
      parent,
      children,
      childGoals,
      store,
      now: () => 7,
      repoRoot: '/repo',
      factsForRegions: undefined,
      headSha: undefined,
      regionScanner: fixedScanner({
        'src/engine': [{ path: 'src/engine/engine.ts', lines: 10, bytes: 100, symbols: [] }],
      }),
      kindOf: kindByType,
      async runChild(goal) {
        if (goal.id.endsWith('/dive')) return report({ artifact: textArtifact('facts') });
        builderMemoryIds = goal.memories.map((m) => m.id);
        return report();
      },
    });

    // A dive that produced an artifact is not a null dive — no floor is synthesized.
    expect(builderMemoryIds.some((id) => id.startsWith('structural-floor:'))).toBe(false);
    expect(await store.list({ type: 'dependency-degraded' })).toEqual([]);
  });
});
