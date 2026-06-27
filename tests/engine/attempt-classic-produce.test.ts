import { describe, expect, it } from 'vitest';
import { produceClassicArtifact } from '../../src/engine/attempt/classic-produce.js';
import {
  makeGoal,
  MemoryEventStore,
  passVerdict,
  rawBrain,
  ScriptedBrain,
  textArtifact,
} from './stubs.js';

describe('classic produce attempt component', () => {
  it('produces an artifact, appends usage, and debits token budget', async () => {
    const store = new MemoryEventStore();
    const goal = makeGoal({ budget: { attempts: 1, tokens: 10, toolCalls: 1, wallClockMs: 1 } });
    const brain = new ScriptedBrain()
      .queueProduceWithUsage(textArtifact('done'), { promptTokens: 6, completionTokens: 5 });
    let debited = false;

    const result = await produceClassicArtifact({
      goal,
      ctx: { tier: 'low', memories: [] },
      budget: goal.budget,
      brain,
      store,
      now: () => 1,
      debitUsage: () => { debited = true; },
      hasReachedCeiling: () => false,
    });

    expect(result).toEqual({
      kind: 'artifact',
      artifact: textArtifact('done'),
      budget: { ...goal.budget, tokens: -1 },
    });
    expect(debited).toBe(true);
    expect((await store.list()).map((event) => event.type)).toEqual([
      'produced',
      'budget-exhausted',
    ]);
  });

  it('short-circuits on spend ceiling before token accounting', async () => {
    const store = new MemoryEventStore();
    const goal = makeGoal();

    const result = await produceClassicArtifact({
      goal,
      ctx: { tier: 'low', memories: [] },
      budget: goal.budget,
      brain: new ScriptedBrain()
        .queueProduceWithUsage(textArtifact('done'), { promptTokens: 100, completionTokens: 100 }),
      store,
      now: () => 2,
      debitUsage: () => {},
      hasReachedCeiling: () => true,
    });

    expect(result).toEqual({ kind: 'ceiling', budget: goal.budget });
    expect((await store.list()).map((event) => event.type)).toEqual(['produced']);
  });

  it('passes the provided brain context through to produce', async () => {
    const store = new MemoryEventStore();
    const goal = makeGoal();
    let seenTier = '';

    await produceClassicArtifact({
      goal,
      ctx: { tier: 'high', memories: [] },
      budget: goal.budget,
      brain: rawBrain({
        decide: async () => ({ kind: 'satisfy' }),
        produce: async (_goal, ctx) => {
          seenTier = ctx.tier;
          return textArtifact('done');
        },
        judge: async () => passVerdict(),
        repair: async () => textArtifact('unused'),
      }),
      store,
      now: () => 3,
      debitUsage: () => {},
      hasReachedCeiling: () => false,
    });

    expect(seenTier).toBe('high');
  });
});
