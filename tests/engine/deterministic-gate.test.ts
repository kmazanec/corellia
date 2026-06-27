import { describe, expect, it } from 'vitest';
import { runDeterministicGate } from '../../src/engine/deterministic-gate.js';
import {
  alwaysPassCheck,
  MemoryEventStore,
  makeGoal,
  textArtifact,
} from './stubs.js';

describe('deterministic gate', () => {
  it('returns null without emitting when there are no checks', async () => {
    const store = new MemoryEventStore();
    const goal = makeGoal();

    const result = await runDeterministicGate({
      goal,
      artifact: textArtifact('ok'),
      checks: [],
      budget: goal.budget,
      checkContext: undefined,
      store,
      now: () => 1,
    });

    expect(result).toEqual({
      verdict: null,
      budget: goal.budget,
      toolCallsExhausted: false,
      toolCallsUsed: 0,
    });
    expect(await store.list()).toEqual([]);
  });

  it('emits a passing verdict and debits one tool call per check', async () => {
    const store = new MemoryEventStore();
    const goal = makeGoal({ budget: { attempts: 1, tokens: 1, toolCalls: 3, wallClockMs: 1 } });

    const result = await runDeterministicGate({
      goal,
      artifact: textArtifact('ok'),
      checks: [alwaysPassCheck('lint'), alwaysPassCheck('types')],
      budget: goal.budget,
      checkContext: undefined,
      store,
      now: () => 2,
    });

    expect(result.budget.toolCalls).toBe(1);
    expect(result.toolCallsExhausted).toBe(false);
    expect(result.toolCallsUsed).toBe(2);
    expect(result.verdict).toMatchObject({ pass: true, findings: [] });
    expect((await store.list({ type: 'deterministic-checked' }))).toHaveLength(1);
  });

  it('preserves deterministic prescriptions on failing findings', async () => {
    const store = new MemoryEventStore();
    const goal = makeGoal();

    const result = await runDeterministicGate({
      goal,
      artifact: textArtifact('bad'),
      checks: [{
        name: 'anchor',
        run: async () => ({ ok: false, detail: 'bad line', prescription: 'move anchor' }),
      }],
      budget: goal.budget,
      checkContext: undefined,
      store,
      now: () => 3,
    });

    expect(result.verdict).toMatchObject({
      pass: false,
      failureSignature: 'deterministic:anchor: bad line',
      findings: [{
        title: 'anchor: bad line',
        prescription: 'move anchor',
        gating: true,
      }],
    });
  });

  it('reports tool-call exhaustion without appending a budget event itself', async () => {
    const store = new MemoryEventStore();
    const goal = makeGoal({ budget: { attempts: 1, tokens: 1, toolCalls: 1, wallClockMs: 1 } });

    const result = await runDeterministicGate({
      goal,
      artifact: textArtifact('ok'),
      checks: [alwaysPassCheck('lint'), alwaysPassCheck('types')],
      budget: goal.budget,
      checkContext: undefined,
      store,
      now: () => 4,
    });

    expect(result.budget.toolCalls).toBe(-1);
    expect(result.toolCallsExhausted).toBe(true);
    expect((await store.list()).map((event) => event.type)).toEqual(['deterministic-checked']);
  });
});
