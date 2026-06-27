import { describe, expect, it } from 'vitest';
import { ZERO_USAGE } from '../../src/contract/goal.js';
import { debitAttempt, debitTokenCount, debitTokenUsage } from '../../src/engine/budget-events.js';
import { MemoryEventStore, makeGoal } from './stubs.js';

describe('budget events', () => {
  it('debits attempts and emits exhaustion when attempts cross zero', async () => {
    const store = new MemoryEventStore();
    const goal = makeGoal({ budget: { attempts: 1, tokens: 10, toolCalls: 1, wallClockMs: 1 } });

    const budget = await debitAttempt({
      budget: goal.budget,
      goal,
      store,
      now: () => 0,
    });

    expect(budget.attempts).toBe(0);
    expect((await store.list()).map((event) => event.type)).toEqual(['budget-exhausted']);
  });

  it('debits token usage and emits exhaustion when the counter crosses zero', async () => {
    const store = new MemoryEventStore();
    const goal = makeGoal({ budget: { attempts: 1, tokens: 10, toolCalls: 1, wallClockMs: 1 } });

    const budget = await debitTokenUsage({
      budget: goal.budget,
      usage: { ...ZERO_USAGE, promptTokens: 8, completionTokens: 3 },
      goal,
      store,
      now: () => 1,
    });

    expect(budget.tokens).toBe(-1);
    expect((await store.list()).map((event) => event.type)).toEqual(['budget-exhausted']);
  });

  it('does not emit for zero-token debits', async () => {
    const store = new MemoryEventStore();
    const goal = makeGoal();

    const budget = await debitTokenCount({
      budget: goal.budget,
      tokens: 0,
      goal,
      store,
      now: () => 2,
    });

    expect(budget).toEqual(goal.budget);
    expect(await store.list()).toEqual([]);
  });

  it('can emit only on the first crossing when a caller owns that policy', async () => {
    const store = new MemoryEventStore();
    const goal = makeGoal({ budget: { attempts: 1, tokens: 1, toolCalls: 1, wallClockMs: 1 } });

    const exhausted = await debitTokenCount({
      budget: goal.budget,
      tokens: 2,
      goal,
      store,
      now: () => 3,
      emitOnlyOnCrossing: true,
    });
    await debitTokenCount({
      budget: exhausted,
      tokens: 2,
      goal,
      store,
      now: () => 4,
      emitOnlyOnCrossing: true,
    });

    expect((await store.list()).map((event) => event.type)).toEqual(['budget-exhausted']);
  });
});
