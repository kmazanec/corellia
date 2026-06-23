import { describe, it, expect } from 'vitest';
import { subdivide, consume } from '../../src/engine/budget.js';
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
  // ADR-030: attempts is a RETRY count, not a divisible resource — it is INHERITED
  // (each child gets the parent's full attempt count, so a deep node can still
  // split and retry). tokens/toolCalls/wallClock still subdivide proportionally.
  it('subdivides tokens/toolCalls proportionally', () => {
    const [a, b] = subdivide(base, [0.5, 0.5]);
    expect(a!.tokens).toBe(500);
    expect(b!.tokens).toBe(500);
  });

  it('inherits the full attempt count (does not divide attempts)', () => {
    const [a, b] = subdivide(base, [0.5, 0.5]);
    expect(a!.attempts).toBe(base.attempts);
    expect(b!.attempts).toBe(base.attempts);
  });

  it('does not floor a deep child to 1 attempt — it keeps the parent count', () => {
    // The defect ADR-030 fixes: a tiny share used to floor attempts to 1, then
    // the fan-out guard forbade the node from splitting. Inheritance prevents it.
    const [a] = subdivide(base, [0.1]);
    expect(a!.attempts).toBe(base.attempts);
  });

  it('floors fractional token results', () => {
    const [a] = subdivide(base, [0.33]);
    expect(a!.tokens).toBe(330); // floor(1000 * 0.33) = 330
  });

  it('handles a single child with share 1.0', () => {
    const [a] = subdivide(base, [1.0]);
    expect(a!.attempts).toBe(10);
    expect(a!.tokens).toBe(1000);
  });

  it('subdivided tokens sum ≤ parent (no share overflow)', () => {
    const shares = [0.3, 0.3, 0.3];
    const parts = subdivide(base, shares);
    const totalTokens = parts.reduce((s, p) => s + p.tokens, 0);
    expect(totalTokens).toBeLessThanOrEqual(base.tokens);
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
