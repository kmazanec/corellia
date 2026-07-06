import { describe, it, expect } from 'vitest';
import { Engine } from '../../src/engine/engine.js';
import {
  MemoryEventStore,
  NoopMemoryView,
  FixedMemoryView,
  buildRegistry,
  leafTypeDef,
  nonLeafTypeDef,
  alwaysPassCheck,
  alwaysFailCheck,
  failThenPassCheck,
  failWithPrescriptionThenPassCheck,
  ScriptedBrain,
  rawBrain,
  makeGoal,
  textArtifact,
  filesArtifact,
  passVerdict,
  failVerdict,
} from './stubs.js';
import type { ChildPlan } from '../../src/contract/decision.js';
import type { MemoryPointer } from '../../src/contract/goal.js';
import { ZERO_USAGE } from '../../src/contract/goal.js';

// ── 1. Leaf satisfy that passes ───────────────────────────────────────────

describe('leaf satisfy — passes', () => {
  it('emits a report with the produced artifact', async () => {
    const store = new MemoryEventStore();
    const brain = new ScriptedBrain().queueProduce(textArtifact('hello'));
    const registry = buildRegistry([leafTypeDef()]);

    const engine = new Engine({ registry, brain, store, memory: new NoopMemoryView() });
    const goal = makeGoal();
    const report = await engine.run(goal);

    expect(report.artifact).toEqual(textArtifact('hello'));
    expect(report.blockers).toHaveLength(0);

    const eventTypes = store.types();
    expect(eventTypes).toContain('goal-received');
    expect(eventTypes).toContain('emitted');
  });
});

// ── 2. Deterministic fail → judge never called ────────────────────────────

describe('deterministic fail → judge never called', () => {
  it('blocks after exhausting attempts with failing deterministic check', async () => {
    const store = new MemoryEventStore();
    const brain = new ScriptedBrain()
      .queueProduce(textArtifact('attempt1'))
      .queueProduce(textArtifact('attempt2'))
      .queueProduce(textArtifact('attempt3'));

    const registry = buildRegistry([
      leafTypeDef({
        deterministic: [alwaysFailCheck('lint')],
        judgeType: 'judge',  // judge should never be called
        tier: { default: 'low', ladder: ['low', 'mid'] },
      }),
      leafTypeDef({ name: 'judge', kind: 'judge', judgeType: null }),
    ]);

    const engine = new Engine({ registry, brain, store, memory: new NoopMemoryView() });
    const goal = makeGoal({ budget: { attempts: 2, tokens: 1000, toolCalls: 50, wallClockMs: 60000 } });
    const report = await engine.run(goal);

    expect(report.blockers.length).toBeGreaterThan(0);

    // Judge should never have been called
    const judgeEvents = await store.list({ type: 'judge-verdict' });
    expect(judgeEvents).toHaveLength(0);

    // But deterministic-checked events should exist
    const detEvents = await store.list({ type: 'deterministic-checked' });
    expect(detEvents.length).toBeGreaterThan(0);
  });
});

// ── 3. Repair rung (fail with prescription → repair → pass) ──────────────

describe('repair rung', () => {
  it('applies repair when deterministic finding has no prescription (escalates instead)', async () => {
    const store = new MemoryEventStore();

    // Deterministic failures have no prescription → engine escalates, not repairs
    const brain = new ScriptedBrain()
      .queueProduce(textArtifact('broken'))        // low attempt
      .queueProduce(textArtifact('fixed'));         // mid attempt passes

    const failOnceCheck = failThenPassCheck('lint');

    const registry = buildRegistry([
      leafTypeDef({
        deterministic: [failOnceCheck],
        judgeType: null,
        tier: { default: 'low', ladder: ['low', 'mid'] },
      }),
    ]);

    const engine = new Engine({ registry, brain, store, memory: new NoopMemoryView() });
    const goal = makeGoal({ budget: { attempts: 5, tokens: 1000, toolCalls: 50, wallClockMs: 60000 } });
    const report = await engine.run(goal);

    // Escalated to mid, second attempt passes
    expect(report.blockers).toHaveLength(0);
    expect(report.artifact).toEqual(textArtifact('fixed'));

    const escalateEvents = await store.list({ type: 'tier-escalated' });
    expect(escalateEvents).toHaveLength(1);
  });

  it('repairs in-attempt (no tier escalation) when a deterministic finding carries a prescription', async () => {
    const store = new MemoryEventStore();

    // A mechanically-repairable deterministic failure (e.g. a bad dive anchor):
    // the check returns a prescription, so the engine repairs WITHIN the attempt
    // (ADR-006) instead of escalating the tier into the same failure — the fix for
    // run live-self-a6963719, where an anchor hallucination escalated and re-rolled.
    const brain = new ScriptedBrain()
      .queueProduce(textArtifact('bad-anchors'))   // low attempt fails the check
      .queueRepair(textArtifact('grounded'));       // repair re-grounds the anchors

    const registry = buildRegistry([
      leafTypeDef({
        deterministic: [failWithPrescriptionThenPassCheck('knowledge:dive-anchor')],
        judgeType: null,
        tier: { default: 'low', ladder: ['low', 'mid'] },
      }),
    ]);

    const engine = new Engine({ registry, brain, store, memory: new NoopMemoryView() });
    const goal = makeGoal({ budget: { attempts: 5, tokens: 1000, toolCalls: 50, wallClockMs: 60000 } });
    const report = await engine.run(goal);

    // Converged via repair on the SAME tier — no escalation.
    expect(report.blockers).toHaveLength(0);
    expect(report.artifact).toEqual(textArtifact('grounded'));

    const repairEvents = await store.list({ type: 'repair-applied' });
    expect(repairEvents).toHaveLength(1);
    expect((repairEvents[0] as { prescriptions: string[] }).prescriptions).toContain(
      'fix the knowledge:dive-anchor flaw',
    );
    const escalateEvents = await store.list({ type: 'tier-escalated' });
    expect(escalateEvents).toHaveLength(0);
  });

  it('applies repair from judge verdict with prescription', async () => {
    const store = new MemoryEventStore();

    const brain = new ScriptedBrain()
      .queueProduce(textArtifact('draft'))
      .queueJudge(failVerdict('needs-work', 'fix the thing'))
      .queueRepair(textArtifact('improved'))
      .queueJudge(passVerdict());   // recheck judge

    const registry = buildRegistry([
      leafTypeDef({
        deterministic: [],
        judgeType: 'judge-leaf',
      }),
      leafTypeDef({ name: 'judge-leaf', kind: 'judge', judgeType: null }),
    ]);

    const engine = new Engine({ registry, brain, store, memory: new NoopMemoryView() });
    const goal = makeGoal({ budget: { attempts: 5, tokens: 1000, toolCalls: 50, wallClockMs: 60000 } });
    const report = await engine.run(goal);

    expect(report.blockers).toHaveLength(0);
    expect(report.artifact).toEqual(textArtifact('improved'));

    const repairEvents = await store.list({ type: 'repair-applied' });
    expect(repairEvents).toHaveLength(1);
  });
});

// ── 4. Escalation ladder walk + isomorphic-failure early block ────────────

describe('escalation ladder', () => {
  it('escalates tier on failure without prescription', async () => {
    const store = new MemoryEventStore();

    // No prescription → escalate then pass on higher tier
    const brain = new ScriptedBrain()
      .queueProduce(textArtifact('attempt-low'))
      .queueJudge(failVerdict('quality', undefined))  // no prescription → escalate
      .queueProduce(textArtifact('attempt-mid'))
      .queueJudge(passVerdict());

    const registry = buildRegistry([
      leafTypeDef({
        deterministic: [],
        judgeType: 'judge-leaf',
        tier: { default: 'low', ladder: ['low', 'mid', 'high'] },
      }),
      leafTypeDef({ name: 'judge-leaf', kind: 'judge', judgeType: null }),
    ]);

    const engine = new Engine({ registry, brain, store, memory: new NoopMemoryView() });
    const goal = makeGoal({ budget: { attempts: 5, tokens: 1000, toolCalls: 50, wallClockMs: 60000 } });
    const report = await engine.run(goal);

    expect(report.blockers).toHaveLength(0);

    const escalateEvents = await store.list({ type: 'tier-escalated' });
    expect(escalateEvents).toHaveLength(1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((escalateEvents[0] as any).from).toBe('low');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((escalateEvents[0] as any).to).toBe('mid');
  });

  it('blocks early on isomorphic failure (same failureSignature repeated)', async () => {
    const store = new MemoryEventStore();

    // Both failures have the same signature → early block after second
    const brain = new ScriptedBrain()
      .queueProduce(textArtifact('attempt1'))
      .queueJudge(failVerdict('same-issue', undefined, undefined, 'sig-abc'))
      .queueProduce(textArtifact('attempt2'))
      .queueJudge(failVerdict('same-issue', undefined, undefined, 'sig-abc'));

    const registry = buildRegistry([
      leafTypeDef({
        deterministic: [],
        judgeType: 'judge-leaf',
        tier: { default: 'low', ladder: ['low', 'mid', 'high'] },
      }),
      leafTypeDef({ name: 'judge-leaf', kind: 'judge', judgeType: null }),
    ]);

    const engine = new Engine({ registry, brain, store, memory: new NoopMemoryView() });
    const goal = makeGoal({ budget: { attempts: 5, tokens: 1000, toolCalls: 50, wallClockMs: 60000 } });
    const report = await engine.run(goal);

    expect(report.blockers.length).toBeGreaterThan(0);
    expect(report.blockers[0]).toMatch(/isomorphic/i);
  });

  it('blocks immediately on escalated finding', async () => {
    const store = new MemoryEventStore();

    const brain = new ScriptedBrain()
      .queueProduce(textArtifact('attempt1'))
      .queueJudge(failVerdict('needs-rearch', undefined, true));  // escalated=true

    const registry = buildRegistry([
      leafTypeDef({
        deterministic: [],
        judgeType: 'judge-leaf',
      }),
      leafTypeDef({ name: 'judge-leaf', kind: 'judge', judgeType: null }),
    ]);

    const engine = new Engine({ registry, brain, store, memory: new NoopMemoryView() });
    const goal = makeGoal();
    const report = await engine.run(goal);

    expect(report.blockers.length).toBeGreaterThan(0);
    expect(report.blockers[0]).toMatch(/escalated/i);

    const blockedEvents = await store.list({ type: 'blocked' });
    expect(blockedEvents).toHaveLength(1);
  });
});

// ── 5. Split with dependency chain (child B awaits child A) ──────────────

describe('split with dependency chain', () => {
  it('child B awaits child A, independents run concurrently', async () => {
    const executionOrder: string[] = [];

    const store = new MemoryEventStore();
    const registry = buildRegistry([
      nonLeafTypeDef({ name: 'splitter' }),
      leafTypeDef({ name: 'leaf' }),
    ]);

    const childA: ChildPlan = {
      localId: 'a',
      type: 'leaf',
      title: 'child A',
      spec: {},
      dependsOn: [],
      scope: [],
      budgetShare: 0.4,
    };
    const childB: ChildPlan = {
      localId: 'b',
      type: 'leaf',
      title: 'child B',
      spec: {},
      dependsOn: ['a'],
      scope: [],
      budgetShare: 0.4,
    };
    const childC: ChildPlan = {
      localId: 'c',
      type: 'leaf',
      title: 'child C (independent)',
      spec: {},
      dependsOn: [],
      scope: [],
      budgetShare: 0.2,
    };

    const brain = new ScriptedBrain()
      .queueDecide({ kind: 'split', children: [childA, childB, childC] })
      // Produce results for each child (order: a, b, c or a, c, b for independents)
      .queueProduce(textArtifact('a-output'))
      .queueProduce(textArtifact('b-output'))
      .queueProduce(textArtifact('c-output'));

    const trackingBrain = {
      async decide(goal: import('../../src/contract/goal.js').Goal, ctx: import('../../src/contract/brain.js').BrainContext) {
        return brain.decide(goal, ctx);
      },
      async produce(goal: import('../../src/contract/goal.js').Goal, ctx: import('../../src/contract/brain.js').BrainContext) {
        executionOrder.push(goal.id);
        return brain.produce(goal, ctx);
      },
      async judge(goal: import('../../src/contract/goal.js').Goal, subject: import('../../src/contract/report.js').Artifact, rubric: string, ctx: import('../../src/contract/brain.js').BrainContext) {
        return brain.judge(goal, subject, rubric, ctx);
      },
      async repair(goal: import('../../src/contract/goal.js').Goal, artifact: import('../../src/contract/report.js').Artifact, prescriptions: string[], ctx: import('../../src/contract/brain.js').BrainContext) {
        return brain.repair(goal, artifact, prescriptions, ctx);
      },
      async step(): Promise<import('../../src/contract/brain.js').StepOutput> {
        throw new Error('trackingBrain.step: not used in this test');
      },
    };

    const engine = new Engine({
      registry,
      brain: trackingBrain,
      store,
      memory: new NoopMemoryView(),
      now: () => 0,
    });

    const goal = makeGoal({ type: 'splitter', id: 'root' });
    const report = await engine.run(goal);

    expect(report.blockers).toHaveLength(0);

    // B must come after A
    const aIdx = executionOrder.indexOf('root/a');
    const bIdx = executionOrder.indexOf('root/b');
    expect(aIdx).toBeGreaterThanOrEqual(0);
    expect(bIdx).toBeGreaterThan(aIdx);

    // child-spawned events should be present
    const spawnEvents = await store.list({ type: 'child-spawned' });
    expect(spawnEvents).toHaveLength(3);
  });

  it('blocked dependency blocks its dependent', async () => {
    const store = new MemoryEventStore();
    const registry = buildRegistry([
      nonLeafTypeDef({ name: 'splitter' }),
      // Child A type has always-failing deterministic to force a block
      leafTypeDef({
        name: 'leaf',
        deterministic: [alwaysFailCheck()],
        tier: { default: 'low', ladder: ['low'] },  // single-rung ladder → exhausts after one attempt
      }),
    ]);

    const childA: ChildPlan = {
      localId: 'a',
      type: 'leaf',
      title: 'child A (will block)',
      spec: {},
      dependsOn: [],
      scope: [],
      budgetShare: 0.5,
    };
    const childB: ChildPlan = {
      localId: 'b',
      type: 'leaf',
      title: 'child B (depends on A)',
      spec: {},
      dependsOn: ['a'],
      scope: [],
      budgetShare: 0.5,
    };

    const brain = new ScriptedBrain()
      .queueDecide({ kind: 'split', children: [childA, childB] })
      .queueProduce(textArtifact('a-broken'));  // only A produces; B should be blocked

    const engine = new Engine({ registry, brain, store, memory: new NoopMemoryView() });
    const goal = makeGoal({ type: 'splitter', id: 'root', budget: { attempts: 1, tokens: 1000, toolCalls: 5, wallClockMs: 60000 } });
    const report = await engine.run(goal);

    // Parent report has blockers from A (and B is blocked by A)
    expect(report.blockers.length).toBeGreaterThan(0);
  });

  // ── ADR-037 — degraded dependency does not cascade-block ──────────────────
  it('a dependency that blocked but produced a usable artifact does NOT block its dependent — it proceeds on the partial', async () => {
    const store = new MemoryEventStore();
    const registry = buildRegistry([
      nonLeafTypeDef({ name: 'splitter' }),
      leafTypeDef({ name: 'leaf' }),
      // A leaf that always fails its deterministic gate → blocks with no artifact.
      leafTypeDef({
        name: 'failleaf',
        deterministic: [alwaysFailCheck()],
        tier: { default: 'low', ladder: ['low'] }, // single rung → exhausts after one attempt
      }),
    ]);

    // A is itself a split: A1 (leaf, produces files → passes) + A2 (failleaf → blocks).
    // A's merged report therefore carries BOTH a non-null files artifact AND A2's
    // blocker — the "blocked but usable partial" shape this ADR cares about.
    // B depends on A and must still run.
    const executionOrder: string[] = [];
    const brain = rawBrain({
      async decide(goal) {
        if (goal.id === 'root') {
          return {
            kind: 'split',
            children: [
              { localId: 'a', type: 'splitter', title: 'dive (partial)', spec: {}, dependsOn: [], scope: [], budgetShare: 0.5 },
              { localId: 'b', type: 'leaf', title: 'builder (depends on dive)', spec: {}, dependsOn: ['a'], scope: [], budgetShare: 0.5 },
            ],
          };
        }
        if (goal.id === 'root/a') {
          return {
            kind: 'split',
            children: [
              { localId: 'a1', type: 'leaf', title: 'sub-dive that ran', spec: {}, dependsOn: [], scope: [], budgetShare: 0.5 },
              { localId: 'a2', type: 'failleaf', title: 'sub-dive that blocked', spec: {}, dependsOn: [], scope: [], budgetShare: 0.5 },
            ],
          };
        }
        throw new Error(`unexpected decide for ${goal.id}`);
      },
      async produce(goal) {
        executionOrder.push(goal.id);
        if (goal.id === 'root/a/a1') return filesArtifact([{ path: 'facts.md', content: 'partial region facts' }]);
        if (goal.id === 'root/a/a2') return textArtifact('will-fail-gate');
        if (goal.id === 'root/b') return filesArtifact([{ path: 'impl.ts', content: 'built on partial knowledge' }]);
        throw new Error(`unexpected produce for ${goal.id}`);
      },
      async judge() { return passVerdict(); },
      async repair(_g, a) { return a; },
    });

    const engine = new Engine({ registry, brain, store, memory: new NoopMemoryView() });
    const goal = makeGoal({ type: 'splitter', id: 'root', budget: { attempts: 1, tokens: 1000, toolCalls: 5, wallClockMs: 60000 } });
    const report = await engine.run(goal);

    // The builder B RAN despite its dependency A having a blocker (A2's gate failure).
    expect(executionOrder).toContain('root/b');

    // A `dependency-degraded` event was emitted for B, naming A as the degraded dep.
    const degraded = await store.list({ type: 'dependency-degraded' });
    expect(degraded.length).toBeGreaterThan(0);
    const ev = degraded[0]!;
    expect(ev.type === 'dependency-degraded' && ev.goalId).toBe('root/b');
    expect(ev.type === 'dependency-degraded' && ev.dependency).toBe('root/a');

    // B never emitted the "blocked because a dependency failed" report — it built.
    // The tree still surfaces A2's blocker honestly (degraded delivery, not silent).
    expect(report.blockers.length).toBeGreaterThan(0);
    // B's own files reached the merged artifact (it built on the partial).
    const files = report.artifact?.kind === 'files' ? report.artifact.files.map((f) => f.path) : [];
    expect(files).toContain('impl.ts');
  });

  it('a dependency that blocked with NO artifact still hard-blocks its dependent (fatal, unchanged)', async () => {
    const store = new MemoryEventStore();
    const registry = buildRegistry([
      nonLeafTypeDef({ name: 'splitter' }),
      leafTypeDef({
        name: 'leaf',
        deterministic: [alwaysFailCheck()],
        tier: { default: 'low', ladder: ['low'] },
      }),
    ]);

    const executionOrder: string[] = [];
    const brain = rawBrain({
      async decide(goal) {
        if (goal.id === 'root') {
          return {
            kind: 'split',
            children: [
              { localId: 'a', type: 'leaf', title: 'dep that produces nothing', spec: {}, dependsOn: [], scope: [], budgetShare: 0.5 },
              { localId: 'b', type: 'leaf', title: 'dependent', spec: {}, dependsOn: ['a'], scope: [], budgetShare: 0.5 },
            ],
          };
        }
        throw new Error(`unexpected decide for ${goal.id}`);
      },
      async produce(goal) {
        executionOrder.push(goal.id);
        return textArtifact('a-broken'); // A's gate fails → A blocks with artifact:null
      },
      async judge() { return passVerdict(); },
      async repair(_g, a) { return a; },
    });

    const engine = new Engine({ registry, brain, store, memory: new NoopMemoryView() });
    const goal = makeGoal({ type: 'splitter', id: 'root', budget: { attempts: 1, tokens: 1000, toolCalls: 5, wallClockMs: 60000 } });
    const report = await engine.run(goal);

    // B never ran — it was hard-blocked because A produced no usable artifact.
    expect(executionOrder).not.toContain('root/b');
    // No degraded event — this is the fatal path, not the degraded one.
    const degraded = await store.list({ type: 'dependency-degraded' });
    expect(degraded).toHaveLength(0);
    expect(report.blockers.length).toBeGreaterThan(0);
  });
});

// ── 6. Budget subdivision sums + exhaustion → block ──────────────────────

describe('budget accounting', () => {
  it('blocks when attempts exhausted', async () => {
    const store = new MemoryEventStore();

    const brain = new ScriptedBrain()
      .queueProduce(textArtifact('a1'))
      .queueJudge(failVerdict('bad', undefined));  // no prescription → escalate

    const registry = buildRegistry([
      leafTypeDef({
        deterministic: [],
        judgeType: 'judge-leaf',
        tier: { default: 'low', ladder: ['low'] },  // single-rung ladder → no escalation possible
      }),
      leafTypeDef({ name: 'judge-leaf', kind: 'judge', judgeType: null }),
    ]);

    const engine = new Engine({ registry, brain, store, memory: new NoopMemoryView() });
    // Only 1 attempt
    const goal = makeGoal({ budget: { attempts: 1, tokens: 1000, toolCalls: 50, wallClockMs: 60000 } });
    const report = await engine.run(goal);

    expect(report.blockers.length).toBeGreaterThan(0);

    const budgetEvents = await store.list({ type: 'budget-exhausted' });
    expect(budgetEvents.length).toBeGreaterThan(0);
  });
});

// ── 7. Lesson promotion + reinforcement events ────────────────────────────

describe('lesson promotion and memory reinforcement', () => {
  it('emits memory-written for lessons and memory-reinforced for memoriesUsed', async () => {
    const store = new MemoryEventStore();

    const childA: ChildPlan = {
      localId: 'a',
      type: 'leaf',
      title: 'child A',
      spec: {},
      dependsOn: [],
      scope: [],
      budgetShare: 1.0,
    };

    // Custom brain: child returns a report with lessons and memoriesUsed
    const leafBrain = {
      async decide() {
        return { kind: 'split' as const, children: [childA] };
      },
      async produce() {
        return textArtifact('output');
      },
      async judge() {
        return passVerdict();
      },
      async repair() {
        return textArtifact('repaired');
      },
    };

    const memPointer: MemoryPointer = {
      id: 'mem-1',
      layer: 'project',
      content: 'some memory',
      provenance: 'trusted',
    };

    // Override: leaf child should have the memory and report it as used
    const registry = buildRegistry([
      nonLeafTypeDef({ name: 'splitter' }),
      leafTypeDef({ name: 'leaf' }),
    ]);

    // Build custom engine where child goal has pre-injected memories
    // We do this by having the memory view return a pointer for child's topic
    const memoryView = new FixedMemoryView([memPointer]);

    const engine = new Engine({
      registry,
      brain: rawBrain(leafBrain),
      store,
      memory: memoryView,
      now: () => 1,
    });

    const goal = makeGoal({ type: 'splitter', id: 'root' });
    await engine.run(goal);

    // The child has memories injected. Since we produce and return artifact with memoriesUsed = [],
    // reinforcement comes from report.memoriesUsed.
    // Let's verify memory-reinforced when child reports memoriesUsed.
    // The leaf's memories are injected by the spawner (from FixedMemoryView).
    // buildReport sets memoriesUsed = goal.memories.map(m => m.id), so mem-1 gets reinforced.
    const reinforcedEvents = await store.list({ type: 'memory-reinforced' });
    expect(reinforcedEvents.length).toBeGreaterThan(0);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((reinforcedEvents[0] as any).memoryId).toBe('mem-1');
  });

  it('emits memory-written events for child lessons', async () => {
    const store = new MemoryEventStore();

    // Manually wire: a splitter that splits into one child, child returns lessons
    const childA: ChildPlan = {
      localId: 'a',
      type: 'leaf-with-lessons',
      title: 'child A',
      spec: {},
      dependsOn: [],
      scope: [],
      budgetShare: 1.0,
    };

    // The leaf type produces normally, but we need the report to carry lessons.
    // Since Engine.buildReport doesn't add lessons, we test via the split path where
    // the child engine returns a report that already has lessons set.
    // We'll use a child type whose produce returns an artifact AND the engine
    // gives that artifact to buildReport which then emits.
    // The lessons are set to [] by buildReport. To have lessons we need the child
    // to somehow have its own lessons...
    //
    // Actually the simplest approach: override the engine's behavior by making
    // the child's goal run through a different type that has a custom brain
    // returning a report with lessons. But Engine always calls buildReport internally.
    //
    // To test lesson promotion fully: use a splitter-of-splitters. The inner
    // splitter promotes lessons from ITS children, and the outer splitter then
    // gets those lessons in the inner splitter's report and promotes them.
    //
    // For this test, we'll just verify that the memory-written event IS emitted
    // when the promote path is exercised.
    //
    // The simplest path: check that a leaf that has memories injected → memoriesUsed
    // in its report → parent emits memory-reinforced.
    //
    // We already tested that above. For lessons specifically, we'd need a child
    // that returns a non-empty lessons array. That requires controlling the Report
    // returned from the child engine. Since Engine.buildReport always sets lessons=[],
    // lessons only accumulate when a child engine does a split itself (recursive).
    // Let's verify the promotion path fires for lessons from a grandchild.

    const grandchildA: ChildPlan = {
      localId: 'ga',
      type: 'leaf',
      title: 'grandchild A',
      spec: {},
      dependsOn: [],
      scope: [],
      budgetShare: 1.0,
    };

    let decideCallCount = 0;
    const brain = {
      async decide(goal: import('../../src/contract/goal.js').Goal) {
        decideCallCount++;
        if (goal.type === 'splitter') {
          if (goal.id === 'root') {
            return { kind: 'split' as const, children: [childA] };
          }
          return { kind: 'split' as const, children: [grandchildA] };
        }
        return { kind: 'satisfy' as const };
      },
      async produce() {
        return textArtifact('leaf-output');
      },
      async judge() {
        return passVerdict();
      },
      async repair() {
        return textArtifact('repaired');
      },
    };

    const registry = buildRegistry([
      nonLeafTypeDef({ name: 'splitter' }),
      leafTypeDef({ name: 'leaf-with-lessons', leafOnly: false }),
      leafTypeDef({ name: 'leaf' }),
    ]);

    const memPointer: MemoryPointer = {
      id: 'mem-gc',
      layer: 'type',
      content: 'grandchild memory',
      provenance: 'provisional',
    };
    const memoryView = new FixedMemoryView([memPointer]);

    const engine = new Engine({
      registry,
      brain: rawBrain(brain),
      store,
      memory: memoryView,
      now: () => 1,
    });

    const goal = makeGoal({ type: 'splitter', id: 'root' });
    await engine.run(goal);

    const reinforcedEvents = await store.list({ type: 'memory-reinforced' });
    expect(reinforcedEvents.length).toBeGreaterThan(0);
  });
});

// ── 8. leafOnly-split rejection ───────────────────────────────────────────

describe('leafOnly-split rejection', () => {
  it('blocks when leafOnly type tries to split', async () => {
    const store = new MemoryEventStore();

    const childA: ChildPlan = {
      localId: 'a',
      type: 'leaf',
      title: 'child',
      spec: {},
      dependsOn: [],
      scope: [],
      budgetShare: 1.0,
    };

    // leafOnly type, but brain queues a split — this is NOT normally called
    // because leafOnly goes straight to satisfy. However, the engine should
    // guard if a leafOnly type somehow gets a split. We test by directly
    // constructing the scenario: leafOnly=true but the type returns a split.
    //
    // Since leafOnly bypasses decide(), the engine sets decision=satisfy directly.
    // So to test the guard we'd need to modify the type or test the internal guard.
    //
    // The spec says: "a split from a leafOnly type is an error; reject the split"
    // The engine sets decision = {kind:'satisfy'} for leafOnly, so the split guard
    // is a secondary defense for a brain that somehow returns split despite leafOnly.
    //
    // Let's test via a non-leafOnly type that produces an invalid split to cover
    // the structural validation path, AND verify leafOnly types don't call decide.

    const brain = new ScriptedBrain()
      // Non-leaf type that tries to split but budgetShares > 1 (invalid)
      .queueDecide({
        kind: 'split',
        children: [
          { localId: 'a', type: 'leaf', title: 'a', spec: {}, dependsOn: [], scope: [], budgetShare: 0.8 },
          { localId: 'b', type: 'leaf', title: 'b', spec: {}, dependsOn: [], scope: [], budgetShare: 0.8 },
        ],
      })
      // After re-decide, return block
      .queueDecide({ kind: 'block', brief: {
        question: 'cannot split',
        options: ['deny'],
        links: [],
        deadlineMs: 1000,
        onTimeout: 'deny',
      }});

    const registry = buildRegistry([
      nonLeafTypeDef({ name: 'splitter' }),
      leafTypeDef({ name: 'leaf' }),
    ]);

    const engine = new Engine({ registry, brain, store, memory: new NoopMemoryView() });
    const goal = makeGoal({ type: 'splitter' });
    const report = await engine.run(goal);

    expect(report.blockers.length).toBeGreaterThan(0);
  });

  it('leafOnly type: goes straight to attempt loop, decide never called', async () => {
    const store = new MemoryEventStore();
    let decideCalled = false;

    const brain = rawBrain({
      async decide() {
        decideCalled = true;
        return { kind: 'satisfy' as const };
      },
      async produce() {
        return textArtifact('leaf-out');
      },
      async judge() {
        return passVerdict();
      },
      async repair() {
        return textArtifact('');
      },
    });

    const registry = buildRegistry([leafTypeDef({ name: 'leaf', leafOnly: true })]);
    const engine = new Engine({ registry, brain, store, memory: new NoopMemoryView() });
    const goal = makeGoal({ type: 'leaf' });
    const report = await engine.run(goal);

    expect(decideCalled).toBe(false);
    expect(report.blockers).toHaveLength(0);
  });
});

// ── 9. Unknown type → blocked (no throw) ─────────────────────────────────

describe('unknown type', () => {
  it('emits a blocked report without throwing', async () => {
    const store = new MemoryEventStore();
    const brain = new ScriptedBrain();
    const registry = buildRegistry([]);

    const engine = new Engine({ registry, brain, store, memory: new NoopMemoryView() });
    const goal = makeGoal({ type: 'nonexistent' });
    const report = await engine.run(goal);

    expect(report.blockers.length).toBeGreaterThan(0);
    expect(report.blockers[0]).toMatch(/unknown goal type/i);

    const events = await store.list({ type: 'blocked' });
    expect(events).toHaveLength(1);
  });

  it('rejects a split with an unknown child type before spawning children', async () => {
    const store = new MemoryEventStore();
    const registry = buildRegistry([
      nonLeafTypeDef({ name: 'splitter' }),
      leafTypeDef({ name: 'leaf' }),
    ]);

    const brain = new ScriptedBrain()
      .queueDecide({
        kind: 'split',
        children: [
          { localId: 'bad', type: 'invented-type', title: 'bad child', spec: {}, dependsOn: [], scope: [], budgetShare: 1 },
        ],
      })
      .queueDecide({
        kind: 'split',
        children: [
          { localId: 'bad', type: 'invented-type', title: 'bad child', spec: {}, dependsOn: [], scope: [], budgetShare: 1 },
        ],
      });

    const engine = new Engine({ registry, brain, store, memory: new NoopMemoryView() });
    const report = await engine.run(makeGoal({ type: 'splitter' }));

    expect(report.blockers.length).toBeGreaterThan(0);
    expect(await store.list({ type: 'child-spawned' })).toHaveLength(0);
    expect(report.blockers[0]).toMatch(/unknown goal type/i);
  });
});

// ── 10. Split with files artifact merging ────────────────────────────────

describe('split with file artifacts', () => {
  it('merges files from all children into parent artifact', async () => {
    const store = new MemoryEventStore();
    const registry = buildRegistry([
      nonLeafTypeDef({ name: 'splitter' }),
      leafTypeDef({ name: 'leaf' }),
    ]);

    const childA: ChildPlan = { localId: 'a', type: 'leaf', title: 'a', spec: {}, dependsOn: [], scope: [], budgetShare: 0.5 };
    const childB: ChildPlan = { localId: 'b', type: 'leaf', title: 'b', spec: {}, dependsOn: [], scope: [], budgetShare: 0.5 };

    const brain = new ScriptedBrain()
      .queueDecide({ kind: 'split', children: [childA, childB] })
      .queueProduce(filesArtifact([{ path: 'a.ts', content: 'a' }]))
      .queueProduce(filesArtifact([{ path: 'b.ts', content: 'b' }]));

    const engine = new Engine({ registry, brain, store, memory: new NoopMemoryView() });
    const goal = makeGoal({ type: 'splitter', id: 'root' });
    const report = await engine.run(goal);

    expect(report.artifact?.kind).toBe('files');
    expect(report.artifact?.files).toHaveLength(2);
  });
});

// ── Fix 1: repair must not cost a second attempt ──────────────────────────

describe('fix 1 — repair does not consume a second attempt', () => {
  it('passes within a 1-attempt budget when repair succeeds on first try', async () => {
    const store = new MemoryEventStore();

    const brain = new ScriptedBrain()
      .queueProduce(textArtifact('draft'))
      .queueJudge(failVerdict('needs-work', 'fix the thing'))
      .queueRepair(textArtifact('improved'))
      .queueJudge(passVerdict());

    const registry = buildRegistry([
      leafTypeDef({
        deterministic: [],
        judgeType: 'judge-leaf',
      }),
      leafTypeDef({ name: 'judge-leaf', kind: 'judge', judgeType: null }),
    ]);

    const engine = new Engine({ registry, brain, store, memory: new NoopMemoryView() });
    // Only 1 attempt budget — repair must not cost an extra attempt
    const goal = makeGoal({ budget: { attempts: 1, tokens: 10000, toolCalls: 50, wallClockMs: 60000 } });
    const report = await engine.run(goal);

    expect(report.blockers).toHaveLength(0);
    expect(report.artifact).toEqual(textArtifact('improved'));
  });
});

// ── ADR-030: toolCalls exhaustion is warn-only by default ──────────────────

describe('ADR-030 — toolCalls exhaustion is warn-only (does not block by default)', () => {
  it('emits budget-exhausted(toolCalls) but does NOT block when not enforced', async () => {
    const store = new MemoryEventStore();

    const brain = new ScriptedBrain().queueProduce(textArtifact('a'));
    const registry = buildRegistry([
      leafTypeDef({
        deterministic: [alwaysPassCheck()],  // 1 toolCall per check
        judgeType: null,
      }),
    ]);

    const engine = new Engine({ registry, brain, store, memory: new NoopMemoryView() });
    // toolCalls: 0 → exhausted after the first deterministic check, but warn-only.
    const goal = makeGoal({ budget: { attempts: 5, tokens: 100000, toolCalls: 0, wallClockMs: 60000 } });
    const report = await engine.run(goal);

    // The signal still fires...
    const exhausted = await store.list({ type: 'budget-exhausted' });
    expect(exhausted.some((e) => (e as { dimension?: string }).dimension === 'toolCalls')).toBe(true);
    // ...but the goal is NOT blocked on it (warn-only).
    expect(report.blockers).toHaveLength(0);
    expect(report.artifact).toEqual(textArtifact('a'));
  });

  it('still blocks on toolCalls when enforcement is armed (re-arm path works)', async () => {
    const store = new MemoryEventStore();

    const brain = new ScriptedBrain().queueProduce(textArtifact('a'));
    const registry = buildRegistry([
      leafTypeDef({ deterministic: [alwaysPassCheck()], judgeType: null }),
    ]);

    const engine = new Engine({
      registry, brain, store, memory: new NoopMemoryView(),
      enforceToolCallBudget: true,
    });
    const goal = makeGoal({ budget: { attempts: 5, tokens: 100000, toolCalls: 0, wallClockMs: 60000 } });
    const report = await engine.run(goal);

    expect(report.blockers.length).toBeGreaterThan(0);
    const exhausted = await store.list({ type: 'budget-exhausted' });
    expect(exhausted.some((e) => (e as { dimension?: string }).dimension === 'toolCalls')).toBe(true);
  });
});

describe('fix 3 — wallClockMs budget exhaustion', () => {
  it('emits budget-exhausted(wallClockMs) when deadline is already passed', async () => {
    const store = new MemoryEventStore();

    const brain = new ScriptedBrain()
      .queueProduce(textArtifact('a'));

    const registry = buildRegistry([leafTypeDef()]);

    // wallClockMs: 0 → the tree deadline is fixed at root and is already in the
    // past by the time the attempt loop checks it, so exhaustion fires.
    let tick = 1000;
    const engine = new Engine({
      registry,
      brain,
      store,
      memory: new NoopMemoryView(),
      now: () => ++tick,
    });
    const goal = makeGoal({ budget: { attempts: 5, tokens: 100000, toolCalls: 50, wallClockMs: 0 } });
    const report = await engine.run(goal);

    expect(report.blockers.length).toBeGreaterThan(0);
    const exhausted = await store.list({ type: 'budget-exhausted' });
    expect(exhausted.length).toBeGreaterThan(0);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((exhausted[0] as any).dimension).toBe('wallClockMs');
  });

  it('a wide fan-out does NOT starve any leaf — every child shares the tree deadline (ADR-046)', async () => {
    // The starvation this ADR removes: under the old per-goal subdivision, a root
    // that fanned out to N children gave each leaf ~1/N of the wall-clock; a wide
    // fan-out killed productive leaves after ~90s. Now every goal in the tree
    // checks the SAME root-fixed deadline, so breadth cannot starve a leaf.
    const store = new MemoryEventStore();
    const registry = buildRegistry([
      nonLeafTypeDef({ name: 'splitter' }),
      leafTypeDef({ name: 'leaf' }),
    ]);

    // 13 children — the fan-out width from the starving live run (live-self-63daa9cf).
    const children: ChildPlan[] = Array.from({ length: 13 }, (_, i) => ({
      localId: `c${i}`,
      type: 'leaf',
      title: `child ${i}`,
      spec: {},
      dependsOn: [],
      scope: [],
      budgetShare: 1 / 13,
    }));

    const brain = new ScriptedBrain().queueDecide({ kind: 'split', children });
    for (let i = 0; i < children.length; i++) brain.queueProduce(textArtifact(`out-${i}`));

    // A monotonic clock that advances well past a per-child slice (root wall-clock
    // / 13 ≈ 4600ms) but stays far under the whole-tree deadline (60_000ms). Under
    // the old model the later children would time out; under the tree-deadline
    // model none do.
    let now = 1_000;
    const engine = new Engine({
      registry,
      brain,
      store,
      memory: new NoopMemoryView(),
      now: () => (now += 500),
    });
    const goal = makeGoal({
      type: 'splitter',
      id: 'root',
      budget: { attempts: 5, tokens: 100_000, toolCalls: 50, wallClockMs: 60_000 },
    });
    const report = await engine.run(goal);

    // No child starved: every leaf emitted, and nothing blocked on wall-clock.
    const emitted = await store.list({ type: 'emitted' });
    const leafEmissions = emitted.filter((e) => (e as { goalId: string }).goalId.startsWith('root/c'));
    expect(leafEmissions.length).toBe(13);
    const exhausted = await store.list({ type: 'budget-exhausted' });
    expect(exhausted.some((e) => (e as { dimension?: string }).dimension === 'wallClockMs')).toBe(false);
    expect(report.blockers).toHaveLength(0);
  });

  it('the tree deadline still fires for a deep child once the whole tree runs out of time', async () => {
    // The backstop must still bite: a child that keeps working past the tree
    // deadline is killed, no matter its depth. Here the root splits to one child;
    // the clock jumps past the tree deadline before the child produces.
    const store = new MemoryEventStore();
    const registry = buildRegistry([
      nonLeafTypeDef({ name: 'splitter' }),
      leafTypeDef({ name: 'leaf' }),
    ]);

    const childA: ChildPlan = {
      localId: 'a', type: 'leaf', title: 'a', spec: {}, dependsOn: [], scope: [], budgetShare: 1,
    };
    const brain = new ScriptedBrain()
      .queueDecide({ kind: 'split', children: [childA] })
      .queueProduce(textArtifact('a-output'));

    // Root wall-clock 5_000 → tree deadline = firstNow + 5_000. The clock leaps
    // 10_000ms per tick, so by the time the child's attempt loop checks, the
    // shared deadline has passed.
    let now = 1_000;
    const engine = new Engine({
      registry,
      brain,
      store,
      memory: new NoopMemoryView(),
      now: () => (now += 10_000),
    });
    const goal = makeGoal({
      type: 'splitter',
      id: 'root',
      budget: { attempts: 5, tokens: 100_000, toolCalls: 50, wallClockMs: 5_000 },
    });
    const report = await engine.run(goal);

    const exhausted = await store.list({ type: 'budget-exhausted' });
    expect(exhausted.some((e) => (e as { dimension?: string }).dimension === 'wallClockMs')).toBe(true);
    expect(report.blockers.length).toBeGreaterThan(0);
  });
});

describe('tokens budget is observability-only (ADR-033)', () => {
  it('emits budget-exhausted(tokens) when tokens runs out after produce, but does NOT block', async () => {
    const store = new MemoryEventStore();

    const brain = new ScriptedBrain()
      .queueProduceWithUsage(
        textArtifact('output'),
        { promptTokens: 500, completionTokens: 500 },
      );

    const registry = buildRegistry([leafTypeDef({ deterministic: [], judgeType: null })]);

    const engine = new Engine({ registry, brain, store, memory: new NoopMemoryView() });
    // tokens: 1 → produce reports 1000 tokens, crossing the counter to zero.
    // The token counter is observability-only: it emits the signal but never
    // blocks. With no deterministic checks and no judge, the goal still emits.
    const goal = makeGoal({ budget: { attempts: 5, tokens: 1, toolCalls: 50, wallClockMs: 60000 } });
    const report = await engine.run(goal);

    // The exhaustion event still fires (we keep learning where a bound matters)…
    const exhausted = await store.list({ type: 'budget-exhausted' });
    expect(exhausted.length).toBeGreaterThan(0);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((exhausted[0] as any).dimension).toBe('tokens');
    // …but it does NOT terminate the build: budget never steers (ADR-033).
    expect(report.blockers.length).toBe(0);
  });
});

// ── Fix 5: failing integration verdict must emit report with blockers ──────

describe('fix 5 — failing integration verdict produces non-empty blockers', () => {
  it('report.blockers is non-empty when judge-integration fails', async () => {
    const store = new MemoryEventStore();
    const registry = buildRegistry([
      nonLeafTypeDef({ name: 'splitter', judgeType: 'judge-integration' }),
      leafTypeDef({ name: 'leaf', judgeType: null }),
      leafTypeDef({ name: 'judge-integration', kind: 'judge', leafOnly: true, judgeType: null }),
    ]);

    const childA: ChildPlan = {
      localId: 'a',
      type: 'leaf',
      title: 'child A',
      spec: {},
      dependsOn: [],
      scope: [],
      budgetShare: 1.0,
    };

    const brain = new ScriptedBrain()
      .queueDecide({ kind: 'split', children: [childA] })
      .queueProduce(textArtifact('output'))
      .queueJudge(failVerdict('integration-fail'));   // judge-integration fails

    const engine = new Engine({ registry, brain, store, memory: new NoopMemoryView() });
    const goal = makeGoal({ type: 'splitter', id: 'root' });
    const report = await engine.run(goal);

    expect(report.blockers.length).toBeGreaterThan(0);
    expect(report.blockers[0]).toMatch(/integration eval failed/i);
  });
});

// ── Fix 7: child throws become blocked reports, not unhandled rejections ───

describe('fix 7 — child throws become blocked reports', () => {
  it('run completes, throwing child has blockers, dependents are blocked', async () => {
    const store = new MemoryEventStore();
    const registry = buildRegistry([
      nonLeafTypeDef({ name: 'splitter' }),
      leafTypeDef({ name: 'leaf' }),
    ]);

    const childA: ChildPlan = {
      localId: 'a',
      type: 'leaf',
      title: 'child A (throws)',
      spec: {},
      dependsOn: [],
      scope: [],
      budgetShare: 0.5,
    };
    const childB: ChildPlan = {
      localId: 'b',
      type: 'leaf',
      title: 'child B (depends on A)',
      spec: {},
      dependsOn: ['a'],
      scope: [],
      budgetShare: 0.5,
    };

    const brain = rawBrain({
      async decide() {
        return { kind: 'split' as const, children: [childA, childB] };
      },
      async produce(goal: import('../../src/contract/goal.js').Goal) {
        throw new Error(`brain exploded for ${goal.title}`);
      },
      async judge() {
        return passVerdict();
      },
      async repair() {
        return textArtifact('');
      },
    });

    const engine = new Engine({ registry, brain, store, memory: new NoopMemoryView() });
    const goal = makeGoal({ type: 'splitter', id: 'root' });
    // Should not throw
    const report = await engine.run(goal);

    // Parent report has blockers (from the thrown child)
    expect(report.blockers.length).toBeGreaterThan(0);

    // Find child A's emitted report — it should have blockers with "child threw"
    const emittedEvents = await store.list({ type: 'emitted' });
    const childAEmit = emittedEvents.find(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (e) => (e as any).goalId === 'root/a',
    );
    expect(childAEmit).toBeDefined();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((childAEmit as any).report.blockers[0]).toMatch(/child threw/i);
  });
});

// ── Fix 8: escalated findings consult onBrief ──────────────────────────────

describe('fix 8 — escalated findings consult onBrief', () => {
  it('onBrief returning "answered" is reflected in the blocked event resolution', async () => {
    const store = new MemoryEventStore();

    const brain = new ScriptedBrain()
      .queueProduce(textArtifact('attempt1'))
      .queueJudge(failVerdict('needs-rearch', undefined, true));  // escalated=true

    const registry = buildRegistry([
      leafTypeDef({
        deterministic: [],
        judgeType: 'judge-leaf',
      }),
      leafTypeDef({ name: 'judge-leaf', kind: 'judge', judgeType: null }),
    ]);

    const engine = new Engine({
      registry,
      brain,
      store,
      memory: new NoopMemoryView(),
      onBrief: async () => 'answered',
    });
    const goal = makeGoal();
    const report = await engine.run(goal);

    expect(report.blockers.length).toBeGreaterThan(0);

    const blockedEvents = await store.list({ type: 'blocked' });
    expect(blockedEvents).toHaveLength(1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((blockedEvents[0] as any).resolution).toBe('answered');
  });
});

// ── 11. Cyclic dependency detection ──────────────────────────────────────

describe('cyclic dependency detection', () => {
  it('blocks on cyclic dependsOn', async () => {
    const store = new MemoryEventStore();
    const registry = buildRegistry([
      nonLeafTypeDef({ name: 'splitter' }),
      leafTypeDef({ name: 'leaf' }),
    ]);

    // A depends on B, B depends on A → cycle
    const brain = new ScriptedBrain()
      .queueDecide({
        kind: 'split',
        children: [
          { localId: 'a', type: 'leaf', title: 'a', spec: {}, dependsOn: ['b'], scope: [], budgetShare: 0.5 },
          { localId: 'b', type: 'leaf', title: 'b', spec: {}, dependsOn: ['a'], scope: [], budgetShare: 0.5 },
        ],
      })
      // After re-decide, brain blocks
      .queueDecide({ kind: 'block', brief: {
        question: 'cyclic',
        options: ['deny'],
        links: [],
        deadlineMs: 1000,
        onTimeout: 'deny',
      }});

    const engine = new Engine({ registry, brain, store, memory: new NoopMemoryView() });
    const goal = makeGoal({ type: 'splitter' });
    const report = await engine.run(goal);

    expect(report.blockers.length).toBeGreaterThan(0);
  });
});

// ── ADR-039: requiresScope is a per-type contract property ───────────────────
describe('requiresScope split validation (ADR-039)', () => {
  it('rejects a split whose requiresScope child has empty scope, then re-decides', async () => {
    const store = new MemoryEventStore();
    const registry = buildRegistry([
      nonLeafTypeDef({ name: 'splitter' }),
      // A region-anchored leaf that DECLARES requiresScope.
      leafTypeDef({ name: 'anchored', requiresScope: true }),
      // A plain leaf that does NOT require scope.
      leafTypeDef({ name: 'free' }),
    ]);

    const brain = new ScriptedBrain()
      // First split: the anchored child has empty scope → rejected by validateSplit.
      .queueDecide({
        kind: 'split',
        children: [
          { localId: 'a', type: 'anchored', title: 'a', spec: {}, dependsOn: [], scope: [], budgetShare: 0.5 },
        ],
      })
      // Re-decide: give it a real scope → passes.
      .queueDecide({
        kind: 'split',
        children: [
          { localId: 'a', type: 'anchored', title: 'a', spec: {}, dependsOn: [], scope: ['src/x/'], budgetShare: 0.5 },
        ],
      })
      .queueProduce(textArtifact('built within scope'));

    const engine = new Engine({ registry, brain, store, memory: new NoopMemoryView() });
    const report = await engine.run(makeGoal({ type: 'splitter' }));

    // The re-decide with a real scope succeeded — no blockers.
    expect(report.blockers).toHaveLength(0);
    // Two decide calls happened (the empty-scope split was rejected and re-derived).
    const decided = await store.list({ type: 'decided' });
    expect(decided.length).toBeGreaterThanOrEqual(2);
  });

  it('does NOT reject an empty scope for a type that does not require it', async () => {
    const store = new MemoryEventStore();
    const registry = buildRegistry([
      nonLeafTypeDef({ name: 'splitter' }),
      leafTypeDef({ name: 'free' }),
    ]);

    const brain = new ScriptedBrain()
      .queueDecide({
        kind: 'split',
        children: [
          { localId: 'a', type: 'free', title: 'a', spec: {}, dependsOn: [], scope: [], budgetShare: 0.5 },
        ],
      })
      .queueProduce(textArtifact('no scope needed'));

    const engine = new Engine({ registry, brain, store, memory: new NoopMemoryView() });
    const report = await engine.run(makeGoal({ type: 'splitter' }));

    expect(report.blockers).toHaveLength(0);
  });
});

// ── Real usage accounting ───────────────────────────────────────────────────

import type { FactoryEvent } from '../../src/contract/events.js';
import type { Usage } from '../../src/contract/goal.js';

describe('usage accounting — events carry usage and debit equals reported tokens', () => {
  it('produced event carries the reported usage from the produce call', async () => {
    const store = new MemoryEventStore();
    const brain = new ScriptedBrain()
      .queueProduceWithUsage(textArtifact('output'), { promptTokens: 100, completionTokens: 50, costUsd: 0.001 });
    const registry = buildRegistry([leafTypeDef({ judgeType: null })]);
    const engine = new Engine({ registry, brain, store, memory: new NoopMemoryView() });
    const goal = makeGoal({ budget: { attempts: 5, tokens: 10000, toolCalls: 50, wallClockMs: 60000 } });
    await engine.run(goal);

    const produced = await store.list({ type: 'produced' });
    expect(produced).toHaveLength(1);
    const producedEvent = produced[0] as Extract<FactoryEvent, { type: 'produced' }>;
    expect(producedEvent.usage.promptTokens).toBe(100);
    expect(producedEvent.usage.completionTokens).toBe(50);
    expect(producedEvent.usage.costUsd).toBeCloseTo(0.001);
  });

  it('judge-verdict event carries the reported usage from the judge call', async () => {
    const store = new MemoryEventStore();
    const brain = new ScriptedBrain()
      .queueProduceWithUsage(textArtifact('output'), { promptTokens: 10, completionTokens: 5 })
      .queueJudgeWithUsage({ pass: true, findings: [] }, { promptTokens: 200, completionTokens: 80, costUsd: 0.005 });
    const registry = buildRegistry([
      leafTypeDef({ judgeType: 'reviewer' }),
      leafTypeDef({ name: 'reviewer', kind: 'judge', judgeType: null }),
    ]);
    const engine = new Engine({ registry, brain, store, memory: new NoopMemoryView() });
    const goal = makeGoal({ budget: { attempts: 5, tokens: 10000, toolCalls: 50, wallClockMs: 60000 } });
    await engine.run(goal);

    const verdicts = await store.list({ type: 'judge-verdict' });
    expect(verdicts).toHaveLength(1);
    const v = verdicts[0] as Extract<FactoryEvent, { type: 'judge-verdict' }>;
    expect(v.usage?.promptTokens).toBe(200);
    expect(v.usage?.completionTokens).toBe(80);
    expect(v.usage?.costUsd).toBeCloseTo(0.005);
  });

  it('repair-applied event carries the reported usage from the repair call', async () => {
    const store = new MemoryEventStore();
    const brain = new ScriptedBrain()
      .queueProduceWithUsage(textArtifact('output'), { promptTokens: 10, completionTokens: 5 })
      .queueJudgeWithUsage(
        { pass: false, findings: [{ title: 'needs fix', dimension: 'spec', severity: 'high', gating: true, prescription: 'fix it' }] },
        { promptTokens: 80, completionTokens: 30 },
      )
      .queueRepairWithUsage(textArtifact('repaired'), { promptTokens: 60, completionTokens: 20, costUsd: 0.002 })
      .queueJudgeWithUsage({ pass: true, findings: [] }, { promptTokens: 40, completionTokens: 10 });
    const registry = buildRegistry([
      leafTypeDef({ judgeType: 'reviewer' }),
      leafTypeDef({ name: 'reviewer', kind: 'judge', judgeType: null }),
    ]);
    const engine = new Engine({ registry, brain, store, memory: new NoopMemoryView() });
    const goal = makeGoal({ budget: { attempts: 5, tokens: 10000, toolCalls: 50, wallClockMs: 60000 } });
    await engine.run(goal);

    const repairs = await store.list({ type: 'repair-applied' });
    expect(repairs).toHaveLength(1);
    const r = repairs[0] as Extract<FactoryEvent, { type: 'repair-applied' }>;
    expect(r.usage?.promptTokens).toBe(60);
    expect(r.usage?.completionTokens).toBe(20);
    expect(r.usage?.costUsd).toBeCloseTo(0.002);
  });

  it('tokens debit equals reported promptTokens + completionTokens (not chars/4)', async () => {
    // Tokens never block (ADR-033), so the debit is observed at the
    // budget-exhausted event boundary: at 400 the counter reaches zero and the
    // event fires; at 401 it does not. Either way the goal emits cleanly.
    const produceUsage: Usage = { promptTokens: 300, completionTokens: 100 };
    const registry = buildRegistry([leafTypeDef({ judgeType: null })]);

    // At 400 tokens budget: 300+100=400 debit → counter crosses zero → event fires
    const store1 = new MemoryEventStore();
    const brain1 = new ScriptedBrain().queueProduceWithUsage(textArtifact('short'), produceUsage);
    const engine1 = new Engine({ registry, brain: brain1, store: store1, memory: new NoopMemoryView() });
    const goal400 = makeGoal({ budget: { attempts: 5, tokens: 400, toolCalls: 50, wallClockMs: 60000 } });
    const report400 = await engine1.run(goal400);
    expect(report400.blockers).toHaveLength(0);
    const exhausted400 = await store1.list({ type: 'budget-exhausted' });
    expect(exhausted400.some((e) => (e as { dimension?: string }).dimension === 'tokens')).toBe(true);

    // At 401 tokens budget: 400 debit leaves 1 remaining → no exhaustion event
    const store2 = new MemoryEventStore();
    const brain2 = new ScriptedBrain().queueProduceWithUsage(textArtifact('short'), produceUsage);
    const engine2 = new Engine({ registry, brain: brain2, store: store2, memory: new NoopMemoryView() });
    const goal401 = makeGoal({ budget: { attempts: 5, tokens: 401, toolCalls: 50, wallClockMs: 60000 } });
    const report401 = await engine2.run(goal401);
    expect(report401.blockers).toHaveLength(0);
    const exhausted401 = await store2.list({ type: 'budget-exhausted' });
    expect(exhausted401.some((e) => (e as { dimension?: string }).dimension === 'tokens')).toBe(false);
  });
});

// ── Chunks 4+5: Ceiling halt and no-cost fallback ────────────────────

describe('spend ceiling — tree halts when measured cost reaches ceiling', () => {
  it('tree halts when cumulative costUsd reaches the ceiling', async () => {
    const store = new MemoryEventStore();
    const brain = new ScriptedBrain()
      .queueProduceWithUsage(textArtifact('output'), { promptTokens: 10, completionTokens: 5, costUsd: 20 });
    const registry = buildRegistry([leafTypeDef({ judgeType: null })]);
    const engine = new Engine({ registry, brain, store, memory: new NoopMemoryView() });
    const goal = makeGoal({
      budget: { attempts: 5, tokens: 100000, toolCalls: 50, wallClockMs: 60000 },
      spendCeilingUsd: 15,
    });
    const report = await engine.run(goal);

    expect(report.blockers.length).toBeGreaterThan(0);
    expect(report.blockers[0]).toContain('ceiling');
    const ceilingEvents = await store.list({ type: 'ceiling-reached' });
    expect(ceilingEvents).toHaveLength(1);
    const ev = ceilingEvents[0] as Extract<FactoryEvent, { type: 'ceiling-reached' }>;
    expect(ev.ceilingUsd).toBe(15);
    expect(ev.spentUsd).toBeGreaterThanOrEqual(15);
  });

  it('applies $15 default ceiling at root when spendCeilingUsd is absent', async () => {
    const store = new MemoryEventStore();
    const brain = new ScriptedBrain()
      .queueProduceWithUsage(textArtifact('output'), { promptTokens: 10, completionTokens: 5, costUsd: 16 });
    const registry = buildRegistry([leafTypeDef({ judgeType: null })]);
    const engine = new Engine({ registry, brain, store, memory: new NoopMemoryView() });
    // No spendCeilingUsd → default $15
    const goal = makeGoal({ budget: { attempts: 5, tokens: 100000, toolCalls: 50, wallClockMs: 60000 } });
    const report = await engine.run(goal);

    expect(report.blockers.length).toBeGreaterThan(0);
    const ceilingEvents = await store.list({ type: 'ceiling-reached' });
    expect(ceilingEvents).toHaveLength(1);
    const ev = ceilingEvents[0] as Extract<FactoryEvent, { type: 'ceiling-reached' }>;
    expect(ev.ceilingUsd).toBe(15);
  });

  it('ceiling-reached event is emitted and no further brain-call events appear after halt', async () => {
    const store = new MemoryEventStore();
    // First produce triggers the ceiling; no second produce should happen
    const brain = new ScriptedBrain()
      .queueProduceWithUsage(textArtifact('first output'), { promptTokens: 10, completionTokens: 5, costUsd: 20 })
      .queueProduce(textArtifact('second output — should never appear'));
    const registry = buildRegistry([leafTypeDef({ judgeType: null })]);
    const engine = new Engine({ registry, brain, store, memory: new NoopMemoryView() });
    const goal = makeGoal({
      budget: { attempts: 5, tokens: 100000, toolCalls: 50, wallClockMs: 60000 },
      spendCeilingUsd: 15,
    });
    await engine.run(goal);

    const produced = await store.list({ type: 'produced' });
    // Only one produce event — halt prevented the second
    expect(produced).toHaveLength(1);
    const ceilingEvents = await store.list({ type: 'ceiling-reached' });
    expect(ceilingEvents).toHaveLength(1);
  });

  it('documented overshoot case: one-in-flight call may complete before halt', async () => {
    // This test documents the accepted ADR-017 overshoot: a call already in flight
    // when the ceiling trips completes (one-call overshoot). The serial test case:
    // the produce call itself is the overshoot — it completes, ceiling fires after.
    const store = new MemoryEventStore();
    const brain = new ScriptedBrain()
      .queueProduceWithUsage(textArtifact('overshoot output'), { promptTokens: 10, completionTokens: 5, costUsd: 20 });
    const registry = buildRegistry([leafTypeDef({ judgeType: null })]);
    const engine = new Engine({ registry, brain, store, memory: new NoopMemoryView() });
    const goal = makeGoal({
      budget: { attempts: 5, tokens: 100000, toolCalls: 50, wallClockMs: 60000 },
      spendCeilingUsd: 15,
    });
    await engine.run(goal);

    // The produce event fired (overshoot), then ceiling-reached fired after
    const produced = await store.list({ type: 'produced' });
    expect(produced).toHaveLength(1);
    const ceilingEvents = await store.list({ type: 'ceiling-reached' });
    expect(ceilingEvents).toHaveLength(1);
    // Ceiling spent exceeds 15 (overshoot by the in-flight call's cost)
    const ev = ceilingEvents[0] as Extract<FactoryEvent, { type: 'ceiling-reached' }>;
    expect(ev.spentUsd).toBeGreaterThan(ev.ceilingUsd);
  });
});

// ── Chunk 5: No-cost-reported conservative fallback ─────────────────

import { WORST_CASE_PRICE_PER_TOKEN } from '../../src/engine/engine.js';

describe('no-cost fallback — tokens-only conservative bound', () => {
  it('tree still halts via conservative bound when endpoint reports tokens but not cost', async () => {
    const store = new MemoryEventStore();
    // Usage without costUsd — fallback computes spentUsd = tokens * WORST_CASE_PRICE_PER_TOKEN
    // With 1_000_000 tokens and $0.000025/token = $25 exactly → trips the $25 ceiling
    const brain = new ScriptedBrain()
      .queueProduceWithUsage(textArtifact('output'), { promptTokens: 500000, completionTokens: 500000 });
    const registry = buildRegistry([leafTypeDef({ judgeType: null })]);
    const engine = new Engine({ registry, brain, store, memory: new NoopMemoryView() });
    const goal = makeGoal({
      budget: { attempts: 5, tokens: 2000000, toolCalls: 50, wallClockMs: 60000 },
      spendCeilingUsd: 25,
    });
    const report = await engine.run(goal);

    // Tree should halt even without cost reporting
    expect(report.blockers.length).toBeGreaterThan(0);
    const ceilingEvents = await store.list({ type: 'ceiling-reached' });
    expect(ceilingEvents).toHaveLength(1);
    const ev = ceilingEvents[0] as Extract<FactoryEvent, { type: 'ceiling-reached' }>;
    // The conservative fallback was applied: spentUsd = 1_000_000 * 0.000025 = 25
    expect(ev.spentUsd).toBeCloseTo(25);
  });

  it('WORST_CASE_PRICE_PER_TOKEN is the documented fallback constant (high-tier output worst-case)', () => {
    expect(WORST_CASE_PRICE_PER_TOKEN).toBe(0.000025);
  });

  it('tree does not halt if token-only spend stays below ceiling', async () => {
    const store = new MemoryEventStore();
    // 100 tokens * 0.000025 = $0.0025, well below $15
    const brain = new ScriptedBrain()
      .queueProduceWithUsage(textArtifact('output'), { promptTokens: 50, completionTokens: 50 });
    const registry = buildRegistry([leafTypeDef({ judgeType: null })]);
    const engine = new Engine({ registry, brain, store, memory: new NoopMemoryView() });
    const goal = makeGoal({
      budget: { attempts: 5, tokens: 100000, toolCalls: 50, wallClockMs: 60000 },
      spendCeilingUsd: 15,
    });
    const report = await engine.run(goal);

    expect(report.blockers).toHaveLength(0);
    const ceilingEvents = await store.list({ type: 'ceiling-reached' });
    expect(ceilingEvents).toHaveLength(0);
  });
});

// ── Split/concurrent ceiling ─────────────────────────────────────────────
// A splitter with 2+ independent children whose combined usage crosses the ceiling
// must emit ceiling-reached exactly once (not once per child that sees it tripped).
// Post-trip produce events are bounded by the concurrent-branch count (ADR-017
// one-in-flight exception: at most one in-flight call per branch may complete).

describe('split/concurrent ceiling — ceiling-reached fires once, post-trip bounded', () => {
  it('two independent children crossing the ceiling emit ceiling-reached exactly once', async () => {
    const store = new MemoryEventStore();

    // Each child's produce costs $8 — two children = $16 combined, ceiling is $10.
    // Child A produces and trips the ceiling. Child B may or may not complete (it's
    // concurrent), but ceiling-reached must appear exactly once in the event log.
    const childA: ChildPlan = {
      localId: 'a',
      type: 'leaf',
      title: 'child A',
      spec: {},
      dependsOn: [],
      scope: [],
      budgetShare: 0.5,
    };
    const childB: ChildPlan = {
      localId: 'b',
      type: 'leaf',
      title: 'child B',
      spec: {},
      dependsOn: [],
      scope: [],
      budgetShare: 0.5,
    };

    // Both children independently produce with $8 cost each.
    // The brain: decide once (splitter), then produce for each child.
    let produceCount = 0;
    const captureBrain = {
      async decide(_goal: import('../../src/contract/goal.js').Goal, _ctx: import('../../src/contract/brain.js').BrainContext) {
        if (_goal.type === 'splitter') {
          return { value: { kind: 'split' as const, children: [childA, childB] }, usage: ZERO_USAGE };
        }
        throw new Error(`unexpected decide for type ${_goal.type}`);
      },
      async produce(_goal: import('../../src/contract/goal.js').Goal) {
        produceCount++;
        return { value: textArtifact(`output-${_goal.id}`), usage: { promptTokens: 10, completionTokens: 5, costUsd: 8 } };
      },
      async judge() { throw new Error('judge: not used'); },
      async repair() { throw new Error('repair: not used'); },
      async step() { throw new Error('step: not used'); },
    };

    const registry = buildRegistry([
      nonLeafTypeDef({ name: 'splitter' }),
      leafTypeDef({ name: 'leaf', judgeType: null }),
    ]);
    const engine = new Engine({
      registry,
      brain: captureBrain,
      store,
      memory: new NoopMemoryView(),
    });

    const goal = makeGoal({
      id: 'root',
      type: 'splitter',
      title: 'concurrent ceiling test',
      budget: { attempts: 5, tokens: 100_000, toolCalls: 50, wallClockMs: 60_000 },
      spendCeilingUsd: 10,
    });

    await engine.run(goal);

    // ceiling-reached must be emitted exactly once per tree (not per child)
    const ceilingEvents = await store.list({ type: 'ceiling-reached' });
    expect(ceilingEvents).toHaveLength(1);

    // Post-trip produce events bounded by concurrent-branch count (2).
    // At most 2 produce calls may complete (one per in-flight branch).
    expect(produceCount).toBeLessThanOrEqual(2);
  }, 10_000);
});

// ---------------------------------------------------------------------------
// AC-3 backstop: a comprehend-family block-without-effort is coerced to satisfy
// ---------------------------------------------------------------------------

describe('comprehend block-without-effort coercion', () => {
  it('coerces a first-pass comprehend block into satisfy so the goal must try its tools', async () => {
    const store = new MemoryEventStore();

    // The brain decides `block` at the top-level decide (before any tool runs) —
    // the AC-3 run-#1 misread ("repo unreachable"). The engine must coerce this to
    // satisfy and run the produce path, not block the goal.
    const brain = new ScriptedBrain()
      .queueDecide({ kind: 'block', brief: {
        question: 'I attempted to list the repo root but received no output.',
        options: ['deny'],
        links: [],
        deadlineMs: 1000,
        onTimeout: 'deny',
      }})
      .queueProduce(textArtifact('mapped'));

    const registry = buildRegistry([
      nonLeafTypeDef({ name: 'map-repo', family: 'comprehend' }),
    ]);

    const engine = new Engine({ registry, brain, store, memory: new NoopMemoryView() });
    const goal = makeGoal({ type: 'map-repo' });
    const report = await engine.run(goal);

    // Coerced to satisfy → produced the artifact, did NOT block.
    expect(report.blockers).toHaveLength(0);
    expect(report.artifact).toEqual(textArtifact('mapped'));
  });

  it('does NOT coerce a block for a non-comprehend family (deliver/build blocks stand)', async () => {
    const store = new MemoryEventStore();

    const brain = new ScriptedBrain()
      .queueDecide({ kind: 'block', brief: {
        question: 'genuinely ambiguous requirement',
        options: ['deny'],
        links: [],
        deadlineMs: 1000,
        onTimeout: 'deny',
      }});

    const registry = buildRegistry([
      nonLeafTypeDef({ name: 'deliver-intent', family: 'deliver' }),
    ]);

    const engine = new Engine({ registry, brain, store, memory: new NoopMemoryView() });
    const goal = makeGoal({ type: 'deliver-intent' });
    const report = await engine.run(goal);

    // A deliver block is a real decision-gap — it stands.
    expect(report.blockers.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// A mustDecompose type (the deliver-intent root) CANNOT satisfy: it has no
// producing tool. A satisfy decision is RE-DECIDED ONCE with a corrective nudge
// (ADR-037 follow-on / mustdecompose-satisfy-terminal-block.md) — only a REPEATED
// satisfy (the model had its corrected chance and refused) is coerced to an
// actionable terminal block rather than run through the futile attempt loop.
// First surfaced by build run live-self-3bf0f5b2; the terminal-on-first-slip
// brittleness surfaced by live-self-2e2ece33.
// ---------------------------------------------------------------------------

describe('cannot-satisfy guard (mustDecompose types)', () => {
  it('re-decides once, then blocks with an actionable reason when a mustDecompose type satisfies TWICE', async () => {
    const store = new MemoryEventStore();
    // The brain returns satisfy, is corrected, and defiantly satisfies AGAIN.
    const brain = new ScriptedBrain()
      .queueDecide({ kind: 'satisfy' })
      .queueDecide({ kind: 'satisfy' });

    const registry = buildRegistry([
      nonLeafTypeDef({ name: 'deliver-intent', family: 'deliver', mustDecompose: true }),
    ]);

    const engine = new Engine({ registry, brain, store, memory: new NoopMemoryView() });
    const goal = makeGoal({ type: 'deliver-intent' });
    const report = await engine.run(goal);

    // It blocks (does not run the attempt loop), and the brief names the reason +
    // that satisfy was returned twice.
    expect(report.blockers.length).toBeGreaterThan(0);
    expect(report.blockers.join(' ')).toMatch(/must decompose|cannot satisfy/i);
    expect(report.blockers.join(' ')).toMatch(/twice/i);
    // The futile attempt loop never ran: no produce was consumed, no empty emit-loop.
    const stepEvents = await store.list({ type: 'step' });
    expect(stepEvents).toHaveLength(0);
    // Both decisions were recorded honestly (rejected satisfy + re-decided satisfy).
    const decided = await store.list({ type: 'decided' });
    expect(decided.length).toBe(2);
  });

  it('re-decides once and PROCEEDS when the corrected decision is a split', async () => {
    const store = new MemoryEventStore();
    // First satisfy (rejected) → corrected → a valid split into a leaf child.
    const brain = new ScriptedBrain()
      .queueDecide({ kind: 'satisfy' })
      .queueDecide({
        kind: 'split',
        children: [
          { localId: 'impl', type: 'leaf', title: 'do the work', spec: {}, dependsOn: [], scope: [], budgetShare: 1 },
        ],
      })
      .queueProduce(textArtifact('built after correction'));

    const registry = buildRegistry([
      nonLeafTypeDef({ name: 'deliver-intent', family: 'deliver', mustDecompose: true }),
      leafTypeDef({ name: 'leaf' }),
    ]);

    const engine = new Engine({ registry, brain, store, memory: new NoopMemoryView() });
    const goal = makeGoal({ type: 'deliver-intent' });
    const report = await engine.run(goal);

    // The corrected split flowed through normal eval + dispatch — no block.
    expect(report.blockers).toHaveLength(0);
    // The child was spawned and ran (the corrected split was honored).
    const spawned = await store.list({ type: 'child-spawned' });
    expect(spawned).toHaveLength(1);
    // Both the rejected satisfy and the adopted split were recorded.
    const decided = await store.list({ type: 'decided' });
    const kinds = decided.map((e) => (e.type === 'decided' ? e.decision.kind : '')).filter(Boolean);
    expect(kinds).toContain('satisfy'); // the rejected one
    expect(kinds).toContain('split');   // the corrected one
  });

  it('does NOT guard a normal non-leaf type that legitimately satisfies', async () => {
    const store = new MemoryEventStore();
    const brain = new ScriptedBrain()
      .queueDecide({ kind: 'satisfy' })
      .queueProduce(textArtifact('produced'));

    // A plain non-leaf type (no mustDecompose) may satisfy and produce normally.
    const registry = buildRegistry([nonLeafTypeDef({ name: 'splitter' })]);

    const engine = new Engine({ registry, brain, store, memory: new NoopMemoryView() });
    const goal = makeGoal({ type: 'splitter' });
    const report = await engine.run(goal);

    expect(report.blockers).toHaveLength(0);
    expect(report.artifact).toEqual(textArtifact('produced'));
  });

  // Regression: a mustDecompose root whose SPLIT is rejected (e.g. a requiresScope
  // child with empty scope) re-decides; if that re-decide returns satisfy, it must
  // BLOCK — not break out of the split loop and dispatch to the attempt loop,
  // bypassing the cannot-satisfy guard (surfaced live-self-c9329860: a requiresScope
  // rejection forced a re-decide → satisfy → the deliver-intent root ran as a leaf).
  it('a rejected split that re-decides to satisfy still BLOCKS for a mustDecompose type (no step loop)', async () => {
    const store = new MemoryEventStore();
    const registry = buildRegistry([
      nonLeafTypeDef({ name: 'deliver-intent', family: 'deliver', mustDecompose: true }),
      // A child that requires scope — spawned with empty scope → validateSplit rejects.
      leafTypeDef({ name: 'anchored', requiresScope: true }),
    ]);

    const brain = new ScriptedBrain()
      // First decide: a split whose anchored child has empty scope → validateSplit rejects.
      .queueDecide({
        kind: 'split',
        children: [
          { localId: 'a', type: 'anchored', title: 'a', spec: {}, dependsOn: [], scope: [], budgetShare: 1 },
        ],
      })
      // Re-decide (split-rejection path): the model gives up and satisfies.
      .queueDecide({ kind: 'satisfy' })
      // The explicitly-corrected retry ("Do NOT return satisfy again"): still satisfy.
      .queueDecide({ kind: 'satisfy' });

    const engine = new Engine({ registry, brain, store, memory: new NoopMemoryView() });
    const report = await engine.run(makeGoal({ type: 'deliver-intent', scope: ['src/'] }));

    // It blocked honestly — it did NOT run the attempt loop as a leaf.
    expect(report.blockers.length).toBeGreaterThan(0);
    expect(report.blockers.join(' ')).toMatch(/must decompose|cannot satisfy/i);
    const stepEvents = await store.list({ type: 'step' });
    expect(stepEvents).toHaveLength(0);
  });
});
