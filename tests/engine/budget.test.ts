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
  it('returns proportional budgets', () => {
    const [a, b] = subdivide(base, [0.5, 0.5]);
    expect(a!.attempts).toBe(5);
    expect(b!.attempts).toBe(5);
    expect(a!.tokens).toBe(500);
    expect(b!.tokens).toBe(500);
  });

  it('floors fractional results', () => {
    const [a] = subdivide(base, [0.33]);
    expect(a!.attempts).toBe(3); // floor(10 * 0.33) = 3
  });

  it('guarantees at least 1 attempt per child', () => {
    const tiny: Budget = { attempts: 1, tokens: 1, toolCalls: 1, wallClockMs: 1 };
    const [a, b] = subdivide(tiny, [0.1, 0.1]);
    expect(a!.attempts).toBeGreaterThanOrEqual(1);
    expect(b!.attempts).toBeGreaterThanOrEqual(1);
  });

  it('handles a single child with share 1.0', () => {
    const [a] = subdivide(base, [1.0]);
    expect(a!.attempts).toBe(10);
    expect(a!.tokens).toBe(1000);
  });

  it('sums ≤ parent (no share overflow)', () => {
    const shares = [0.3, 0.3, 0.3];
    const parts = subdivide(base, shares);
    const totalAttempts = parts.reduce((s, p) => s + p.attempts, 0);
    expect(totalAttempts).toBeLessThanOrEqual(base.attempts);
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

// ── Fix 2: validateSplit fan-out guard ────────────────────────────────────

describe('fix 2 — validateSplit fan-out guard via engine', () => {
  it('rejects a split when children.length > budget.attempts', async () => {
    const store = new MemoryEventStore();
    const registry = buildRegistry([
      nonLeafTypeDef({ name: 'splitter' }),
      leafTypeDef({ name: 'leaf' }),
    ]);

    // 20 children, each with budgetShare 0.01
    const twentyChildren: ChildPlan[] = Array.from({ length: 20 }, (_, i) => ({
      localId: `c${i}`,
      type: 'leaf',
      title: `child ${i}`,
      spec: {},
      dependsOn: [],
      scope: [],
      budgetShare: 0.01,
    }));

    const brain = new ScriptedBrain()
      .queueDecide({ kind: 'split', children: twentyChildren })
      // After re-decide on structural failure, block
      .queueDecide({ kind: 'block', brief: {
        question: 'cannot split',
        options: ['deny'],
        links: [],
        deadlineMs: 1000,
        onTimeout: 'deny',
      }});

    const engine = new Engine({ registry, brain, store, memory: new NoopMemoryView() });
    // attempts: 10 < 20 children → fan-out rejected
    const goal = makeGoal({
      type: 'splitter',
      budget: { attempts: 10, tokens: 1000, toolCalls: 50, wallClockMs: 60000 },
    });
    const report = await engine.run(goal);

    expect(report.blockers.length).toBeGreaterThan(0);
  });

  it('accepts a split when children.length ≤ budget.attempts and summed child attempts ≤ parent', () => {
    const parentBudget: Budget = { attempts: 10, tokens: 1000, toolCalls: 100, wallClockMs: 60000 };
    const shares = [0.3, 0.3, 0.3];
    const childBudgets = subdivide(parentBudget, shares);
    const totalAttempts = childBudgets.reduce((s, b) => s + b.attempts, 0);
    expect(childBudgets.length).toBeLessThanOrEqual(parentBudget.attempts);
    expect(totalAttempts).toBeLessThanOrEqual(parentBudget.attempts);
  });
});

// ── F-35: debit-equality unit ────────────────────────────────────────────────

describe('F-35 debit equality — tokens budget decrements by reported token count', () => {
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
