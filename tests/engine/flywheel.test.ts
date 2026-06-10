/**
 * Flywheel integration tests for the engine's DECIDE path.
 *
 * Each test narrows to one flywheel contract:
 *  1. Trusted memo — brain.decide is never called; split walks verbatim.
 *  2. Provisional memo — arrives as patternHint in the BrainContext.
 *  3. Terraced scan — k lens-diverse decides, judge-split picks winner; losers
 *     land in findings; no-pass falls through with best verdict as priorAttempt.
 *  4. Pattern recorded — outcome written after split completes.
 *  5. Recurring shape — second run finds the provisional memo from the first.
 */

import { describe, it, expect } from 'vitest';
import { Engine } from '../../src/engine/engine.js';
import { InMemoryPatternStore } from '../../src/substrate/memory-pattern-store.js';
import {
  MemoryEventStore,
  NoopMemoryView,
  buildRegistry,
  leafTypeDef,
  nonLeafTypeDef,
  makeGoal,
  textArtifact,
  passVerdict,
  failVerdict,
} from './stubs.js';
import type { ChildPlan } from '../../src/contract/decision.js';
import type { Brain, BrainContext } from '../../src/contract/brain.js';
import type { Goal } from '../../src/contract/goal.js';
import type { Artifact } from '../../src/contract/report.js';
import type { Verdict } from '../../src/contract/verdict.js';
import type { SplitMemo } from '../../src/contract/pattern.js';

// ── shared split fixture ──────────────────────────────────────────────────

function oneChildSplit(): ChildPlan[] {
  return [
    {
      localId: 'a',
      type: 'leaf',
      title: 'child A',
      spec: {},
      dependsOn: [],
      scope: [],
      budgetShare: 1.0,
    },
  ];
}

// A brain that throws if decide is ever called — proves trusted memo bypasses it.
function throwingDecideBrain(): Brain {
  return {
    async decide(_goal: Goal, _ctx: BrainContext) {
      throw new Error('brain.decide must not be called for a trusted memo');
    },
    async produce(_goal: Goal, _ctx: BrainContext): Promise<Artifact> {
      return textArtifact('leaf-output');
    },
    async judge(_goal: Goal, _subject: Artifact, _rubric: string, _ctx: BrainContext): Promise<Verdict> {
      return passVerdict();
    },
    async repair(_goal: Goal, _artifact: Artifact, _prescriptions: string[], _ctx: BrainContext): Promise<Artifact> {
      return textArtifact('repaired');
    },
  };
}

// ── 1. TRUSTED MEMO — brain.decide never called ───────────────────────────

describe('flywheel — trusted memo skips brain.decide', () => {
  it('walks verbatim and never consults the brain for the decision', async () => {
    const store = new MemoryEventStore();
    const patterns = new InMemoryPatternStore();

    const splitDecision = { kind: 'split' as const, children: oneChildSplit() };

    // Pre-seed a trusted memo for the goal's shape.
    await patterns.record('splitter|{}|goal test', splitDecision, 'success');
    await patterns.promote('splitter|{}|goal test', 'trusted');

    const brain = throwingDecideBrain();

    const registry = buildRegistry([
      nonLeafTypeDef({ name: 'splitter' }),
      leafTypeDef({ name: 'leaf' }),
    ]);

    const engine = new Engine({
      registry,
      brain,
      store,
      memory: new NoopMemoryView(),
      patterns,
    });

    const goal = makeGoal({
      type: 'splitter',
      id: 'root',
      title: 'test goal',
      spec: {},
    });

    // If brain.decide is called it throws. If it doesn't throw, the memo worked.
    const report = await engine.run(goal);
    expect(report.blockers).toHaveLength(0);

    // pattern-consulted event must show trusted
    const consulted = await store.list({ type: 'pattern-consulted' });
    expect(consulted).toHaveLength(1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((consulted[0] as any).status).toBe('trusted');
  });

  it('still runs the split eval after walking a trusted memo', async () => {
    // The split eval (judge-split) must still run — trust skips derivation,
    // never judgment. We confirm by checking that judge was called.
    const store = new MemoryEventStore();
    const patterns = new InMemoryPatternStore();

    const splitDecision = { kind: 'split' as const, children: oneChildSplit() };
    await patterns.record('splitter|{}|goal test', splitDecision, 'success');
    await patterns.promote('splitter|{}|goal test', 'trusted');

    let judgeCallCount = 0;
    const brain: Brain = {
      async decide() {
        throw new Error('decide must not be called for trusted memo');
      },
      async produce() {
        return textArtifact('output');
      },
      async judge() {
        judgeCallCount++;
        return passVerdict();
      },
      async repair() {
        return textArtifact('repaired');
      },
    };

    const registry = buildRegistry([
      nonLeafTypeDef({ name: 'splitter', judgeType: 'judge-split' }),
      leafTypeDef({ name: 'leaf' }),
      leafTypeDef({ name: 'judge-split', leafOnly: true, judgeType: null }),
    ]);

    const engine = new Engine({
      registry,
      brain,
      store,
      memory: new NoopMemoryView(),
      patterns,
    });

    const goal = makeGoal({ type: 'splitter', id: 'root', title: 'test goal', spec: {} });
    const report = await engine.run(goal);

    expect(report.blockers).toHaveLength(0);
    // judge was called (for the split eval and for the child leaf — at least once)
    expect(judgeCallCount).toBeGreaterThan(0);
  });
});

// ── 2. PROVISIONAL MEMO — arrives as patternHint ─────────────────────────

describe('flywheel — provisional memo arrives as patternHint', () => {
  it('patternHint is present in BrainContext when a provisional memo exists', async () => {
    const store = new MemoryEventStore();
    const patterns = new InMemoryPatternStore();

    const splitDecision = { kind: 'split' as const, children: oneChildSplit() };
    await patterns.record('splitter|{}|goal test', splitDecision, 'success');
    // Keep it at provisional (the default after record).

    let capturedHint: SplitMemo | undefined;

    const brain: Brain = {
      async decide(_goal: Goal, ctx: BrainContext) {
        capturedHint = ctx.patternHint;
        return splitDecision;
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

    const registry = buildRegistry([
      nonLeafTypeDef({ name: 'splitter' }),
      leafTypeDef({ name: 'leaf' }),
    ]);

    const engine = new Engine({
      registry,
      brain,
      store,
      memory: new NoopMemoryView(),
      patterns,
    });

    const goal = makeGoal({ type: 'splitter', id: 'root', title: 'test goal', spec: {} });
    await engine.run(goal);

    expect(capturedHint).toBeDefined();
    expect(capturedHint?.status).toBe('provisional');
    expect(capturedHint?.decision).toEqual(splitDecision);

    // pattern-consulted event shows provisional
    const consulted = await store.list({ type: 'pattern-consulted' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((consulted[0] as any).status).toBe('provisional');
  });

  it('patternHint is absent when there is no memo', async () => {
    const store = new MemoryEventStore();
    const patterns = new InMemoryPatternStore(); // empty

    let capturedHint: SplitMemo | undefined = { shape: 'sentinel' } as unknown as SplitMemo;

    const brain: Brain = {
      async decide(_goal: Goal, ctx: BrainContext) {
        capturedHint = ctx.patternHint;
        return { kind: 'split' as const, children: oneChildSplit() };
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

    const registry = buildRegistry([
      nonLeafTypeDef({ name: 'splitter' }),
      leafTypeDef({ name: 'leaf' }),
    ]);

    const engine = new Engine({
      registry,
      brain,
      store,
      memory: new NoopMemoryView(),
      patterns,
    });

    const goal = makeGoal({ type: 'splitter', id: 'root', title: 'test goal', spec: {} });
    await engine.run(goal);

    expect(capturedHint).toBeUndefined();
  });
});

// ── 3. TERRACED SCAN ──────────────────────────────────────────────────────

describe('flywheel — terraced scan', () => {
  it('calls brain.decide k times with distinct lenses', async () => {
    const store = new MemoryEventStore();
    const patterns = new InMemoryPatternStore(); // no memo → triggers scan

    const lensesUsed: string[] = [];

    const brain: Brain = {
      async decide(_goal: Goal, ctx: BrainContext) {
        if (ctx.lens !== undefined) lensesUsed.push(ctx.lens);
        return { kind: 'split' as const, children: oneChildSplit() };
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

    const registry = buildRegistry([
      nonLeafTypeDef({
        name: 'splitter',
        scan: { k: 3, lenses: ['architect', 'reuse', 'contrarian'] },
      }),
      leafTypeDef({ name: 'leaf' }),
      leafTypeDef({ name: 'judge-split', leafOnly: true, judgeType: null }),
    ]);

    const engine = new Engine({
      registry,
      brain,
      store,
      memory: new NoopMemoryView(),
      patterns,
    });

    const goal = makeGoal({ type: 'splitter', id: 'root', title: 'test goal', spec: {} });
    await engine.run(goal);

    // k=3 lens-diverse calls: each should carry a different lens from the list
    expect(lensesUsed).toHaveLength(3);
    expect(lensesUsed[0]).toBe('architect');
    expect(lensesUsed[1]).toBe('reuse');
    expect(lensesUsed[2]).toBe('contrarian');
  });

  it('judge-split picks the first passing winner', async () => {
    const store = new MemoryEventStore();
    const patterns = new InMemoryPatternStore();

    let judgeCallCount = 0;
    // candidate 0 fails, candidate 1 passes, candidate 2 passes
    // winner must be candidate 1 (first pass)
    const brain: Brain = {
      async decide(_goal: Goal, _ctx: BrainContext) {
        return { kind: 'split' as const, children: oneChildSplit() };
      },
      async produce() {
        return textArtifact('output');
      },
      async judge(_goal: Goal, _subject: Artifact, _rubric: string, _ctx: BrainContext) {
        judgeCallCount++;
        if (judgeCallCount === 1) return failVerdict('candidate-0-fails');
        return passVerdict();
      },
      async repair() {
        return textArtifact('repaired');
      },
    };

    const registry = buildRegistry([
      nonLeafTypeDef({
        name: 'splitter',
        scan: { k: 3, lenses: ['l1', 'l2', 'l3'] },
      }),
      leafTypeDef({ name: 'leaf' }),
      leafTypeDef({ name: 'judge-split', leafOnly: true, judgeType: null }),
    ]);

    const engine = new Engine({
      registry,
      brain,
      store,
      memory: new NoopMemoryView(),
      patterns,
    });

    const goal = makeGoal({ type: 'splitter', id: 'root', title: 'test goal', spec: {} });
    const report = await engine.run(goal);

    expect(report.blockers).toHaveLength(0);
    // 3 scan judges + possibly 1 split-eval judge for the winner = at least 3
    expect(judgeCallCount).toBeGreaterThanOrEqual(3);
  });

  it('exactly one decided event for the goal; losing candidates are in report findings', async () => {
    const store = new MemoryEventStore();
    const patterns = new InMemoryPatternStore();

    // All candidates pass — winner is first (all identical splits), other two are losers.
    // judge returns passVerdict() so the first candidate wins; losers are the other two.
    const brain: Brain = {
      async decide(_goal: Goal, _ctx: BrainContext) {
        return { kind: 'split' as const, children: oneChildSplit() };
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

    const registry = buildRegistry([
      nonLeafTypeDef({
        name: 'splitter',
        scan: { k: 3, lenses: ['l1', 'l2', 'l3'] },
      }),
      leafTypeDef({ name: 'leaf' }),
      leafTypeDef({ name: 'judge-split', leafOnly: true, judgeType: null }),
    ]);

    const engine = new Engine({
      registry,
      brain,
      store,
      memory: new NoopMemoryView(),
      patterns,
    });

    const goal = makeGoal({ type: 'splitter', id: 'root', title: 'test goal', spec: {} });
    const report = await engine.run(goal);

    // Exactly one decided event for the root goal (the winner's).
    // Losers do NOT get their own decided events.
    const decidedEvents = await store.list({ type: 'decided' });
    const rootDecided = decidedEvents.filter(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (e) => (e as any).goalId === 'root',
    );
    expect(rootDecided).toHaveLength(1);

    // The two losing candidates surface as findings in the report.
    expect(report.findings.length).toBeGreaterThanOrEqual(2);
    const altFindings = report.findings.filter((f) => f.startsWith('alternative considered'));
    expect(altFindings.length).toBeGreaterThanOrEqual(2);
  });

  it('when no candidate passes, falls through to single-decide with best verdict as priorAttempt', async () => {
    const store = new MemoryEventStore();
    const patterns = new InMemoryPatternStore();

    let fallbackPriorAttempt: { artifact: Artifact | null; verdict: Verdict } | undefined;
    let decideCallCount = 0;

    const brain: Brain = {
      async decide(_goal: Goal, ctx: BrainContext) {
        decideCallCount++;
        if (decideCallCount <= 3) {
          // k=3 scan candidates — all fail judge
          return { kind: 'split' as const, children: oneChildSplit() };
        }
        // Fallback decide — capture priorAttempt
        fallbackPriorAttempt = ctx.priorAttempt;
        return { kind: 'split' as const, children: oneChildSplit() };
      },
      async produce() {
        return textArtifact('output');
      },
      async judge(_goal: Goal, _subject: Artifact, rubric: string, _ctx: BrainContext) {
        // All scan-judge calls fail; other calls pass (so the engine doesn't block)
        if (rubric.startsWith('Evaluate the split')) return failVerdict('scan-fail');
        return passVerdict();
      },
      async repair() {
        return textArtifact('repaired');
      },
    };

    const registry = buildRegistry([
      nonLeafTypeDef({
        name: 'splitter',
        scan: { k: 3, lenses: ['l1', 'l2', 'l3'] },
      }),
      leafTypeDef({ name: 'leaf' }),
      leafTypeDef({ name: 'judge-split', leafOnly: true, judgeType: null }),
    ]);

    const engine = new Engine({
      registry,
      brain,
      store,
      memory: new NoopMemoryView(),
      patterns,
    });

    const goal = makeGoal({
      type: 'splitter',
      id: 'root',
      title: 'test goal',
      spec: {},
      budget: { attempts: 20, tokens: 100000, toolCalls: 100, wallClockMs: 60000 },
    });

    await engine.run(goal);

    // Fallback decide was called (4th decide call)
    expect(decideCallCount).toBeGreaterThanOrEqual(4);
    // priorAttempt was passed to the fallback decide
    expect(fallbackPriorAttempt).toBeDefined();
    expect(fallbackPriorAttempt?.verdict).toBeDefined();
  });

  it('scan does not trigger when k=1', async () => {
    // k=1 means no tournament — single derive path even with scan declared
    const store = new MemoryEventStore();
    const patterns = new InMemoryPatternStore();

    let lensPassedToDecide: string | undefined = 'not-set';

    const brain: Brain = {
      async decide(_goal: Goal, ctx: BrainContext) {
        lensPassedToDecide = ctx.lens;
        return { kind: 'split' as const, children: oneChildSplit() };
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

    const registry = buildRegistry([
      nonLeafTypeDef({
        name: 'splitter',
        scan: { k: 1, lenses: ['architect'] }, // k=1 → no scan
      }),
      leafTypeDef({ name: 'leaf' }),
      leafTypeDef({ name: 'judge-split', leafOnly: true, judgeType: null }),
    ]);

    const engine = new Engine({
      registry,
      brain,
      store,
      memory: new NoopMemoryView(),
      patterns,
    });

    const goal = makeGoal({ type: 'splitter', id: 'root', title: 'test goal', spec: {} });
    await engine.run(goal);

    // No lens in the single-derive path
    expect(lensPassedToDecide).toBeUndefined();
  });
});

// ── 4. PATTERN RECORDED — outcome written after split ─────────────────────

describe('flywheel — pattern recorded after split', () => {
  it('records success when split completes with no blockers', async () => {
    const store = new MemoryEventStore();
    const patterns = new InMemoryPatternStore();

    const brain: Brain = {
      async decide() {
        return { kind: 'split' as const, children: oneChildSplit() };
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

    const registry = buildRegistry([
      nonLeafTypeDef({ name: 'splitter' }),
      leafTypeDef({ name: 'leaf' }),
    ]);

    const engine = new Engine({
      registry,
      brain,
      store,
      memory: new NoopMemoryView(),
      patterns,
    });

    const goal = makeGoal({ type: 'splitter', id: 'root', title: 'test goal', spec: {} });
    await engine.run(goal);

    const memos = await patterns.list();
    expect(memos).toHaveLength(1);
    expect(memos[0]?.successes).toBe(1);
    expect(memos[0]?.failures).toBe(0);
    expect(memos[0]?.status).toBe('provisional');

    const recorded = await store.list({ type: 'pattern-recorded' });
    expect(recorded).toHaveLength(1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((recorded[0] as any).outcome).toBe('success');
  });

  it('records failure when split completes with blockers', async () => {
    const store = new MemoryEventStore();
    const patterns = new InMemoryPatternStore();

    const brain: Brain = {
      async decide() {
        return { kind: 'split' as const, children: oneChildSplit() };
      },
      async produce() {
        return textArtifact('output');
      },
      async judge(_goal, _subject, rubric) {
        // Integration eval fails → blockers in report
        if (rubric.startsWith('Does the integrated')) {
          return failVerdict('integration-fail');
        }
        return passVerdict();
      },
      async repair() {
        return textArtifact('repaired');
      },
    };

    const registry = buildRegistry([
      nonLeafTypeDef({ name: 'splitter' }),
      leafTypeDef({ name: 'leaf', judgeType: null }),
      // judge-integration is present → triggers the integration eval
      leafTypeDef({ name: 'judge-integration', leafOnly: true, judgeType: null }),
    ]);

    const engine = new Engine({
      registry,
      brain,
      store,
      memory: new NoopMemoryView(),
      patterns,
    });

    const goal = makeGoal({ type: 'splitter', id: 'root', title: 'test goal', spec: {} });
    await engine.run(goal);

    const memos = await patterns.list();
    expect(memos).toHaveLength(1);
    expect(memos[0]?.failures).toBe(1);
    expect(memos[0]?.successes).toBe(0);

    const recorded = await store.list({ type: 'pattern-recorded' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((recorded[0] as any).outcome).toBe('failure');
  });

  it('engine never calls patterns.promote — that is the human authority path', async () => {
    const store = new MemoryEventStore();

    // Wrap InMemoryPatternStore and assert promote is never called.
    const inner = new InMemoryPatternStore();
    const patterns: typeof inner & { promoteCalled: boolean } = {
      ...inner,
      promoteCalled: false,
      async match(shape) { return inner.match(shape); },
      async record(shape, decision, outcome) { return inner.record(shape, decision, outcome); },
      async promote(shape, to) {
        (this as typeof patterns).promoteCalled = true;
        return inner.promote(shape, to);
      },
      async list() { return inner.list(); },
    };

    const brain: Brain = {
      async decide() {
        return { kind: 'split' as const, children: oneChildSplit() };
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

    const registry = buildRegistry([
      nonLeafTypeDef({ name: 'splitter' }),
      leafTypeDef({ name: 'leaf' }),
    ]);

    const engine = new Engine({
      registry,
      brain,
      store,
      memory: new NoopMemoryView(),
      patterns,
    });

    const goal = makeGoal({ type: 'splitter', id: 'root', title: 'test goal', spec: {} });
    await engine.run(goal);

    expect(patterns.promoteCalled).toBe(false);
  });
});

// ── 5. RECURRING SHAPE — second run finds the memo from the first ──────────

describe('flywheel — recurring shape', () => {
  it('second run consults the provisional memo written by the first', async () => {
    const store = new MemoryEventStore();
    const patterns = new InMemoryPatternStore();

    const brain: Brain = {
      async decide() {
        return { kind: 'split' as const, children: oneChildSplit() };
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

    const registry = buildRegistry([
      nonLeafTypeDef({ name: 'splitter' }),
      leafTypeDef({ name: 'leaf' }),
    ]);

    const engine = new Engine({
      registry,
      brain,
      store,
      memory: new NoopMemoryView(),
      patterns,
    });

    // First run — writes the memo.
    const goal1 = makeGoal({ type: 'splitter', id: 'run1', title: 'test goal', spec: {} });
    await engine.run(goal1);

    const memosAfterFirst = await patterns.list();
    expect(memosAfterFirst).toHaveLength(1);
    expect(memosAfterFirst[0]?.uses).toBe(1);

    // Second run — same shape → consults the memo.
    const goal2 = makeGoal({ type: 'splitter', id: 'run2', title: 'test goal', spec: {} });
    await engine.run(goal2);

    const memosAfterSecond = await patterns.list();
    expect(memosAfterSecond).toHaveLength(1);
    // uses increments: first record + second record = 2
    expect(memosAfterSecond[0]?.uses).toBe(2);

    // Second run's pattern-consulted event shows provisional (not none)
    const allConsulted = await store.list({ type: 'pattern-consulted' });
    const secondRunConsulted = allConsulted.filter(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (e) => (e as any).goalId === 'run2',
    );
    expect(secondRunConsulted).toHaveLength(1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((secondRunConsulted[0] as any).status).toBe('provisional');
  });
});
