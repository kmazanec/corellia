import { describe, it, expect } from 'vitest';
import { subdivide, consume, consumeN } from '../../src/engine/budget.js';
import type { Budget } from '../../src/contract/goal.js';
import { Engine } from '../../src/engine/engine.js';
import {
  MemoryEventStore,
  NoopMemoryView,
  buildRegistry,
  nonLeafTypeDef,
  leafTypeDef,
  ScriptedBrain,
  textArtifact,
  makeGoal,
} from '../engine/stubs.js';
import type { ChildPlan } from '../../src/contract/decision.js';

const base: Budget = {
  attempts: 10,
  tokens: 1000,
  toolCalls: 100,
  wallClockMs: 60_000,
};

describe('subdivide', () => {
  // ADR-033/ADR-046: budget never steers what or how a goal builds. EVERY
  // dimension is INHERITED, not divided. attempts/tokens/toolCalls inherit per
  // ADR-030 (dividing floored a node toward nothing at depth). wallClockMs
  // inherits per ADR-046 — dividing it rationed a wide fan-out's children down to
  // ~90s and killed productive leaves. Wall-clock is enforced once, tree-wide,
  // against the root deadline (see tree-spend), never as a per-child slice.
  it('inherits wallClockMs (does not divide it) — no per-child rationing', () => {
    const [a, b] = subdivide(base, [0.5, 0.5]);
    expect(a!.wallClockMs).toBe(base.wallClockMs);
    expect(b!.wallClockMs).toBe(base.wallClockMs);
  });

  it('inherits attempts, tokens, and toolCalls (does not divide them)', () => {
    const [a, b] = subdivide(base, [0.5, 0.5]);
    for (const child of [a!, b!]) {
      expect(child.attempts).toBe(base.attempts);
      expect(child.tokens).toBe(base.tokens);
      expect(child.toolCalls).toBe(base.toolCalls);
    }
  });

  it('does not floor a deep child at a tiny share — keeps every dimension', () => {
    // The defect ADR-030/ADR-046 fix: a tiny share floored attempts to 1
    // (forbidding split), tokens + toolCalls toward nothing (starving deep
    // comprehension), and wallClockMs to a sliver (killing a productive leaf in a
    // wide fan-out). Inheritance prevents all four.
    const [a] = subdivide(base, [0.1]);
    expect(a!.attempts).toBe(base.attempts);
    expect(a!.tokens).toBe(base.tokens);
    expect(a!.toolCalls).toBe(base.toolCalls);
    expect(a!.wallClockMs).toBe(base.wallClockMs);
  });

  it('does not starve any child no matter how wide the fan-out', () => {
    // The starvation the tree-deadline model removes by construction: 13 siblings
    // used to ration wall-clock to ~1/13 each. Now every child inherits the full
    // allowance; the tree deadline is the only wall-clock bound.
    const shares = Array.from({ length: 13 }, () => 1 / 13);
    for (const child of subdivide(base, shares)) {
      expect(child.wallClockMs).toBe(base.wallClockMs);
    }
  });

  it('handles a single child with share 1.0', () => {
    const [a] = subdivide(base, [1.0]);
    expect(a!.attempts).toBe(10);
    expect(a!.tokens).toBe(1000);
    expect(a!.wallClockMs).toBe(base.wallClockMs);
  });
});

describe('consume', () => {
  it('decrements the specified dimension', () => {
    const { budget } = consume(base, 'attempts');
    expect(budget.attempts).toBe(9);
    expect(budget.tokens).toBe(1000); // untouched
  });

  it('reports exhausted when dimension hits 0', () => {
    const b: Budget = { ...base, attempts: 1 };
    const { exhausted } = consume(b, 'attempts');
    expect(exhausted).toBe(true);
  });

  it('reports not exhausted when dimension > 0 after decrement', () => {
    const { exhausted } = consume(base, 'attempts');
    expect(exhausted).toBe(false);
  });

  it('can consume tokens, toolCalls, and wallClockMs', () => {
    const { budget: b1 } = consume(base, 'tokens');
    expect(b1.tokens).toBe(999);

    const { budget: b2 } = consume(base, 'toolCalls');
    expect(b2.toolCalls).toBe(99);

    const { budget: b3 } = consume(base, 'wallClockMs');
    expect(b3.wallClockMs).toBe(59_999);
  });

  it('can consume multiple units at once', () => {
    const { budget, exhausted } = consumeN(base, 'tokens', 40);

    expect(budget.tokens).toBe(960);
    expect(exhausted).toBe(false);
  });

  it('reports exhausted when a multi-unit consume reaches zero', () => {
    const { budget, exhausted } = consumeN({ ...base, toolCalls: 5 }, 'toolCalls', 5);

    expect(budget.toolCalls).toBe(0);
    expect(exhausted).toBe(true);
  });
});

// ── ADR-030: no fan-out cap — width is not bounded by attempts ──────────────

describe('ADR-030 — wide splits are accepted (no fan-out-vs-attempts cap)', () => {
  it('accepts a split with far more children than the attempt budget', async () => {
    const store = new MemoryEventStore();
    const registry = buildRegistry([
      nonLeafTypeDef({ name: 'splitter' }),
      leafTypeDef({ name: 'leaf' }),
    ]);

    // 20 children under attempts: 5 — the old guard rejected this; ADR-030 allows
    // it. Each child satisfies immediately (leaf). The split must proceed and the
    // goal must NOT block on a fan-out-structural error.
    const twentyChildren: ChildPlan[] = Array.from({ length: 20 }, (_, i) => ({
      localId: `c${i}`,
      type: 'leaf',
      title: `child ${i}`,
      spec: {},
      dependsOn: [],
      scope: [],
      budgetShare: 0.01,
    }));

    const brain = new ScriptedBrain().queueDecide({ kind: 'split', children: twentyChildren });

    const engine = new Engine({ registry, brain, store, memory: new NoopMemoryView() });
    const goal = makeGoal({
      type: 'splitter',
      budget: { attempts: 5, tokens: 1000, toolCalls: 50, wallClockMs: 60000 },
    });
    const report = await engine.run(goal);

    // No fan-out-structural blocker.
    expect(report.blockers.join(' ')).not.toMatch(/fan-out/i);
    // The split actually fanned out to all 20 children.
    const spawned = await store.list({ type: 'child-spawned' });
    expect(spawned.length).toBe(20);
  });
});

// ── debit-equality unit ──────────────────────────────────────────────────────

describe('debit equality — tokens budget decrements by reported token count', () => {
  it('consuming reported tokens matches consumeN(budget, tokens, promptTokens+completionTokens)', async () => {
    const store = new MemoryEventStore();
    const registry = buildRegistry([leafTypeDef({ judgeType: null })]);
    const brain = new ScriptedBrain()
      .queueProduceWithUsage(textArtifact('hello'), { promptTokens: 30, completionTokens: 10 });
    const engine = new Engine({ registry, brain, store, memory: new NoopMemoryView() });

    const initialTokens = 200;
    const goal = makeGoal({ budget: { attempts: 5, tokens: initialTokens, toolCalls: 50, wallClockMs: 60000 } });
    const report = await engine.run(goal);

    expect(report.blockers).toHaveLength(0);

    const produced = await store.list({ type: 'produced' });
    const usage = (produced[0] as { usage: { promptTokens: number; completionTokens: number } }).usage;
    const expectedDebit = usage.promptTokens + usage.completionTokens;
    expect(expectedDebit).toBe(40);
  });
});
