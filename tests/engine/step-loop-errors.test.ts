import { describe, expect, it } from 'vitest';
import type { StepTranscript } from '../../src/contract/brain.js';
import { MalformedStepError, StepTransportError } from '../../src/contract/brain.js';
import { makeGoal, MemoryEventStore } from './stubs.js';
import { newScratchpad } from '../../src/engine/scratchpad.js';
import { handleStepLoopStepError } from '../../src/engine/step-loop-errors.js';

const budget = { attempts: 1, tokens: 100, toolCalls: 2, wallClockMs: 1_000 };

describe('step-loop step error handling', () => {
  it('recovers once from a malformed step by appending a reprompt', async () => {
    const store = new MemoryEventStore();
    const transcript: StepTranscript = [];

    const result = await handleStepLoopStepError({
      err: new MalformedStepError('bad json'),
      goal: makeGoal(),
      budget,
      remainingToolCalls: 2,
      transcript,
      scratchpad: newScratchpad(),
      store,
      now: () => 1,
      seenCalls: new Set(),
      callKeyByCallId: new Map(),
      malformRecoveryUsed: false,
    });

    expect(result).toEqual({ kind: 'recover', malformRecoveryUsed: true, forceEmitNext: true });
    expect(store.types()).toEqual(['malformation-reprompt']);
    expect(transcript.at(-1)).toMatchObject({
      role: 'context',
      content: expect.stringContaining('emit the final artifact directly'),
    });
  });

  it('evicts context before recovering from a truncated malformed step', async () => {
    const store = new MemoryEventStore();
    const transcript: StepTranscript = [
      { role: 'context', content: 'goal' },
      { role: 'assistant', content: '', toolCalls: [{ id: 'r1', name: 'read_file', args: { path: 'big.ts' } }] },
      { role: 'tool', callId: 'r1', content: 'A'.repeat(2_000) },
    ];

    const result = await handleStepLoopStepError({
      err: new MalformedStepError('truncated', true),
      goal: makeGoal(),
      budget,
      remainingToolCalls: 2,
      transcript,
      scratchpad: newScratchpad(),
      store,
      now: () => 2,
      seenCalls: new Set(['read_file:{"path":"big.ts"}']),
      callKeyByCallId: new Map([['r1', 'read_file:{"path":"big.ts"}']]),
      malformRecoveryUsed: false,
      truncationEvictionCap: 20,
    });

    expect(result.kind).toBe('recover');
    expect(store.types()).toEqual(['malformation-reprompt', 'context-evicted']);
    expect(JSON.stringify(transcript)).toContain('[evicted:');
  });

  it('classifies a repeated malformed step as a malformed failure', async () => {
    const store = new MemoryEventStore();
    const transcript: StepTranscript = [];

    const result = await handleStepLoopStepError({
      err: new MalformedStepError('bad again'),
      goal: makeGoal(),
      budget,
      remainingToolCalls: 1,
      transcript,
      scratchpad: newScratchpad(),
      store,
      now: () => 3,
      seenCalls: new Set(),
      callKeyByCallId: new Map(),
      malformRecoveryUsed: true,
    });

    expect(result.kind).toBe('failed');
    expect(result.kind === 'failed' ? result.result.failKind : undefined).toBe('malformed');
    expect(store.types()).toEqual([]);
  });

  it('classifies transport errors separately from logical failures', async () => {
    const store = new MemoryEventStore();
    const transcript: StepTranscript = [];

    const result = await handleStepLoopStepError({
      err: new StepTransportError('timed out'),
      goal: makeGoal(),
      budget,
      remainingToolCalls: -1,
      transcript,
      scratchpad: newScratchpad(),
      store,
      now: () => 4,
      seenCalls: new Set(),
      callKeyByCallId: new Map(),
      // recovery already burned: the classification is what's under test
      malformRecoveryUsed: true,
    });

    expect(result.kind).toBe('failed');
    expect(result.kind === 'failed' ? result.result : undefined).toMatchObject({
      error: 'timed out',
      failKind: 'transport',
      budget: { toolCalls: -1 },
    });
  });
});

describe('raw timeout classification', () => {
  it('classifies a raw TimeoutError (unwrapped abort) as a transport failure', async () => {
    // Regression (live-tail runs 1/7/9): AbortSignal.timeout aborts escaping
    // paths outside fetchStepResponse arrived as plain TimeoutError and were
    // classified 'failed' — feeding the step-loop:failed isomorphic signature.
    const timeoutErr = new Error('The operation was aborted due to timeout');
    timeoutErr.name = 'TimeoutError';

    const result = await handleStepLoopStepError({
      err: timeoutErr,
      goal: makeGoal(),
      budget,
      remainingToolCalls: 2,
      transcript: [],
      scratchpad: newScratchpad(),
      store: new MemoryEventStore(),
      now: () => 5,
      seenCalls: new Set(),
      callKeyByCallId: new Map(),
      // recovery already burned: the classification is what's under test
      malformRecoveryUsed: true,
    });

    expect(result.kind).toBe('failed');
    expect(result.kind === 'failed' ? result.result.failKind : undefined).toBe('transport');
  });
});

describe('timeout in-loop recovery', () => {
  it('recovers ONCE from a step timeout: evicts context and forces an emit', async () => {
    const store = new MemoryEventStore();
    const transcript: StepTranscript = [{ role: 'context', content: 'sys' }];

    const result = await handleStepLoopStepError({
      err: new StepTransportError('Step request timed out and did not recover after 3 retries'),
      goal: makeGoal(),
      budget,
      remainingToolCalls: 5,
      transcript,
      scratchpad: newScratchpad(),
      store,
      now: () => 6,
      seenCalls: new Set(),
      callKeyByCallId: new Map(),
      malformRecoveryUsed: false,
    });

    expect(result.kind).toBe('recover');
    expect(result.kind === 'recover' ? result.forceEmitNext : false).toBe(true);
    // The recovery is evented and the transcript carries the emit steer.
    expect(await store.list({ type: 'malformation-reprompt' })).toHaveLength(1);
    const last = transcript[transcript.length - 1];
    expect(last?.role).toBe('context');
    expect(last && 'content' in last ? last.content : '').toContain('Emit the final artifact');
  });
});

describe('network-fault classification breadth', () => {
  it("classifies undici's 'terminated' socket error as transport", async () => {
    const result = await handleStepLoopStepError({
      err: new TypeError('terminated'),
      goal: makeGoal(),
      budget,
      remainingToolCalls: 2,
      transcript: [],
      scratchpad: newScratchpad(),
      store: new MemoryEventStore(),
      now: () => 7,
      seenCalls: new Set(),
      callKeyByCallId: new Map(),
      malformRecoveryUsed: true,
    });

    expect(result.kind).toBe('failed');
    expect(result.kind === 'failed' ? result.result.failKind : undefined).toBe('transport');
  });
});
