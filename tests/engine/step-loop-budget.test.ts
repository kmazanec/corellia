import { describe, expect, it } from 'vitest';
import type { StepTranscript } from '../../src/contract/brain.js';
import { checkStepLoopToolBudget, remainingToolCallMessage, stepLoopHardToolCallCap, updateRemainingToolCallContext } from '../../src/engine/step-loop-budget.js';
import { makeGoal, MemoryEventStore } from './stubs.js';

const budget = { attempts: 1, tokens: 100, toolCalls: 2, wallClockMs: 1_000 };

describe('step-loop tool budget policy', () => {
  it('continues while tool calls remain', async () => {
    const store = new MemoryEventStore();
    const transcript: StepTranscript = [];

    const result = await checkStepLoopToolBudget({
      goal: makeGoal(),
      budget,
      transcript,
      store,
      now: () => 1,
      enforceToolCallBudget: false,
      state: { remainingToolCalls: 1, toolCallsMade: 3, warned: false, hardToolCallCap: 100 },
    });

    expect(result.kind).toBe('continue');
    expect(store.types()).toEqual([]);
  });

  it('exhausts immediately when enforcement is enabled', async () => {
    const store = new MemoryEventStore();
    const transcript: StepTranscript = [];

    const result = await checkStepLoopToolBudget({
      goal: makeGoal(),
      budget,
      transcript,
      store,
      now: () => 2,
      enforceToolCallBudget: true,
      state: { remainingToolCalls: 0, toolCallsMade: 2, warned: false, hardToolCallCap: 100 },
    });

    expect(result).toMatchObject({ kind: 'exhausted', budget: { toolCalls: 0 } });
    expect(store.types()).toEqual([]);
  });

  it('warns once in warn-only mode and continues before the hard cap', async () => {
    const store = new MemoryEventStore();
    const transcript: StepTranscript = [];

    const first = await checkStepLoopToolBudget({
      goal: makeGoal(),
      budget,
      transcript,
      store,
      now: () => 3,
      enforceToolCallBudget: false,
      state: { remainingToolCalls: 0, toolCallsMade: 2, warned: false, hardToolCallCap: 100 },
    });
    const second = await checkStepLoopToolBudget({
      goal: makeGoal(),
      budget,
      transcript,
      store,
      now: () => 4,
      enforceToolCallBudget: false,
      state: first.kind === 'continue'
        ? first.state
        : { remainingToolCalls: 0, toolCallsMade: 2, warned: true, hardToolCallCap: 100 },
    });

    expect(first.kind).toBe('continue');
    expect(second.kind).toBe('continue');
    expect(store.types()).toEqual(['budget-exhausted']);
  });

  it('exhausts in warn-only mode at the hard cap', async () => {
    const store = new MemoryEventStore();
    const transcript: StepTranscript = [];

    const result = await checkStepLoopToolBudget({
      goal: makeGoal(),
      budget,
      transcript,
      store,
      now: () => 5,
      enforceToolCallBudget: false,
      state: { remainingToolCalls: -1, toolCallsMade: 100, warned: true, hardToolCallCap: 100 },
    });

    expect(result).toMatchObject({ kind: 'exhausted', budget: { toolCalls: -1 } });
    expect(store.types()).toEqual([]);
  });

  it('computes a generous hard cap even for zero or negative soft budgets', () => {
    expect(stepLoopHardToolCallCap(2)).toBe(100);
    expect(stepLoopHardToolCallCap(0)).toBe(50);
    expect(stepLoopHardToolCallCap(-1)).toBe(50);
  });

  it('renders and updates the remaining-call context message', () => {
    expect(remainingToolCallMessage(3)).toBe('3 tool calls remaining');
    expect(remainingToolCallMessage(-2)).toContain('over by 2');

    const transcript: StepTranscript = [{ role: 'assistant', content: 'working' }];
    updateRemainingToolCallContext(transcript, 1);
    expect(transcript.at(-1)).toEqual({ role: 'context', content: '1 tool calls remaining' });

    updateRemainingToolCallContext(transcript, 0);
    expect(transcript).toHaveLength(2);
    expect(transcript.at(-1)?.content).toContain('budget exceeded');
  });
});
