import { describe, expect, it } from 'vitest';
import type { ChildPlan } from '../../src/contract/decision.js';
import type { Report } from '../../src/contract/report.js';
import type { FactoryEvent } from '../../src/contract/events.js';
import {
  buildSplitRoundReport,
  childOutcomes,
  promoteChildReports,
} from '../../src/engine/split-report.js';
import { projectMemory, unionMemoryViews } from '../../src/eventlog/projections.js';
import { MemoryEventStore, makeGoal, textArtifact } from './stubs.js';

const writtenPointer = (events: FactoryEvent[]) =>
  events.flatMap((e) => (e.type === 'memory-written' ? [e.pointer] : []));

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

const child = (localId: string): ChildPlan => ({
  localId,
  type: 'leaf',
  title: localId,
  spec: {},
  dependsOn: [],
  scope: [],
  budgetShare: 0.5,
});

describe('split report promotion', () => {
  it('promotes lessons and reinforces used memories', async () => {
    const store = new MemoryEventStore();
    const promotion = await promoteChildReports({
      childGoals: [makeGoal({ id: 'root/a' }), makeGoal({ id: 'root/b' })],
      childReports: [
        report({ lessons: ['reuse this', 'reuse this'], memoriesUsed: ['m1'], learned: 'learned A' }),
        report({ blockers: ['blocked'], memoriesUsed: ['m2'], learned: 'learned A' }),
      ],
      store,
      now: () => 1,
    });

    expect(promotion).toEqual({ lessons: ['reuse this'], learned: 'learned A' });
    expect(await store.list({ type: 'memory-written' })).toHaveLength(2);
    expect(await store.list({ type: 'memory-reinforced' })).toMatchObject([
      { goalId: 'root/a', memoryId: 'm1', outcome: 'success' },
      { goalId: 'root/b', memoryId: 'm2', outcome: 'failure' },
    ]);
  });

  it('defaults an untagged lesson to the project layer in the per-project store', async () => {
    const store = new MemoryEventStore();
    await promoteChildReports({
      childGoals: [makeGoal({ id: 'root/a', type: 'implement-fn' })],
      childReports: [report({ lessons: ['this repo pins react 18'] })],
      store,
      now: () => 1,
    });

    const [pointer] = writtenPointer(await store.list({ type: 'memory-written' }));
    expect(pointer?.layer).toBe('project');
    expect(pointer?.namespace).toBeUndefined();
    expect(pointer?.content).toBe('this repo pins react 18');
  });

  it('routes a [type]-tagged lesson to the SHARED store, namespaced to the child type', async () => {
    const projectStore = new MemoryEventStore();
    const sharedStore = new MemoryEventStore();

    await promoteChildReports({
      childGoals: [makeGoal({ id: 'root/a', type: 'critique-code' })],
      childReports: [report({ lessons: ['[type] check the exhaustive switch'] })],
      store: projectStore,
      sharedStore,
      now: () => 1,
    });

    // Nothing in the per-project store; the type memory lives in the shared store.
    expect(await projectStore.list({ type: 'memory-written' })).toHaveLength(0);
    const [pointer] = writtenPointer(await sharedStore.list({ type: 'memory-written' }));
    expect(pointer?.layer).toBe('type');
    expect(pointer?.namespace).toBe('critique-code');
    expect(pointer?.content).toBe('check the exhaustive switch'); // tag stripped
  });

  it('routes a [global]-tagged lesson to the shared store with no namespace', async () => {
    const projectStore = new MemoryEventStore();
    const sharedStore = new MemoryEventStore();

    await promoteChildReports({
      childGoals: [makeGoal({ id: 'root/a', type: 'implement-fn' })],
      childReports: [report({ lessons: ['[global] never commit secrets'] })],
      store: projectStore,
      sharedStore,
      now: () => 1,
    });

    expect(await projectStore.list({ type: 'memory-written' })).toHaveLength(0);
    const [pointer] = writtenPointer(await sharedStore.list({ type: 'memory-written' }));
    expect(pointer?.layer).toBe('global');
    expect(pointer?.namespace).toBeUndefined();
  });
});

// ──────────────────────────────────────────────
// Cross-store acceptance (issue acceptance hint, ADR-049): a type lesson
// promoted while working on project A is retrieved and injected for a same-type
// goal working on project B, proven across two distinct stores/logs.
// ──────────────────────────────────────────────

describe('type memory compounds across projects', () => {
  it('a type lesson promoted against store A is retrieved for a same-type goal against store B', async () => {
    // Two DISTINCT per-project stores (project A's log, project B's log) plus ONE
    // shared store that outlives either — exactly the D3 per-project-log topology.
    const projectAStore = new MemoryEventStore();
    const projectBStore = new MemoryEventStore();
    const sharedStore = new MemoryEventStore();

    // Working on project A: a critique-code child promotes a general type lesson.
    await promoteChildReports({
      childGoals: [makeGoal({ id: 'A/critique', type: 'critique-code' })],
      childReports: [report({ lessons: ['[type] prefer table-driven tests'] })],
      store: projectAStore,
      sharedStore,
      now: () => 1,
    });

    // The lesson is NOT in project A's own log — it lives in the shared store.
    expect(await projectAStore.list({ type: 'memory-written' })).toHaveLength(0);

    // Now working on project B: the spawner's unioned view over project B's log +
    // the shared store retrieves the type lesson for a same-type child.
    const memoryForB = unionMemoryViews(
      projectMemory(await projectBStore.list()),
      projectMemory(await sharedStore.list()),
    );

    const forCritique = await memoryForB.query('table-driven', [], { goalType: 'critique-code' });
    expect(forCritique.map((p) => p.content)).toEqual(['prefer table-driven tests']);
    expect(forCritique[0]?.layer).toBe('type');
    expect(forCritique[0]?.provenance).toBe('provisional');

    // A DIFFERENT goal-type in project B does not see another operation's wisdom.
    const forOther = await memoryForB.query('table-driven', [], { goalType: 'implement-fn' });
    expect(forOther).toHaveLength(0);
  });
});

describe('split report assembly', () => {
  it('preserves blocker and finding ordering from integration, comprehend, then children', () => {
    const built = buildSplitRoundReport({
      mergedArtifact: textArtifact('merged'),
      childGoals: [makeGoal({ id: 'root/a', title: 'module A' })],
      childReports: [
        report({ blockers: ['child blocker'], findings: ['child finding'], memoriesUsed: ['m1'] }),
      ],
      promotion: { lessons: ['lesson'], learned: 'learned' },
      extraFindings: ['terraced loser'],
      integrationFindings: ['integration finding'],
      integrationBlockers: ['integration blocker'],
      comprehendFindings: ['comprehend finding'],
      comprehendBlockers: ['comprehend blocker'],
    });

    expect(built).toMatchObject({
      artifact: textArtifact('merged'),
      lessons: ['lesson'],
      memoriesUsed: ['m1'],
      blockers: ['integration blocker', 'comprehend blocker', 'child blocker'],
      findings: ['terraced loser', 'integration finding', 'comprehend finding', 'child finding'],
      learned: 'learned',
    });
  });

  it('enumerates blocked child modules in partialDelivery, keyed to their goals', () => {
    const built = buildSplitRoundReport({
      mergedArtifact: textArtifact('merged'),
      childGoals: [
        makeGoal({ id: 'root/green', title: 'green module' }),
        makeGoal({ id: 'root/blocked', title: 'blocked module' }),
      ],
      childReports: [
        report({ blockers: [] }),
        report({ blockers: ['step-loop:failed'], artifact: null }),
      ],
      promotion: { lessons: [], learned: '' },
      extraFindings: [],
      integrationFindings: [],
      integrationBlockers: [],
      comprehendFindings: [],
      comprehendBlockers: [],
    });

    expect(built.partialDelivery).toEqual({
      blockedModules: [
        { goalId: 'root/blocked', title: 'blocked module', blocker: 'step-loop:failed' },
      ],
      childBlockers: ['step-loop:failed'],
    });
  });

  it('omits partialDelivery when no child blocked', () => {
    const built = buildSplitRoundReport({
      mergedArtifact: textArtifact('merged'),
      childGoals: [makeGoal({ id: 'root/green', title: 'green module' })],
      childReports: [report({ blockers: [] })],
      promotion: { lessons: [], learned: '' },
      extraFindings: [],
      integrationFindings: [],
      integrationBlockers: [],
      comprehendFindings: [],
      comprehendBlockers: [],
    });

    expect(built.partialDelivery).toBeUndefined();
  });

  it('pairs child plans with their reports', () => {
    const reports = [report({ learned: 'a' }), report({ learned: 'b' })];

    expect(childOutcomes([child('a'), child('b')], reports)).toEqual([
      { plan: child('a'), report: reports[0] },
      { plan: child('b'), report: reports[1] },
    ]);
  });
});
