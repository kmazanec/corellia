import { describe, expect, it } from 'vitest';
import type { FactoryEvent } from '../../src/contract/events.js';
import type { Goal, Usage } from '../../src/contract/goal.js';
import type { StepTranscript } from '../../src/contract/brain.js';
import { newScratchpad, addNote } from '../../src/engine/scratchpad.js';
import {
  boundStepLoopTranscript,
  evictTranscriptAfterTruncation,
  syncScratchpadMessage,
} from '../../src/engine/step-loop-transcript.js';

const goal: Goal = {
  id: 'g1',
  type: 'implement',
  parentId: null,
  title: 'Build',
  spec: {},
  intent: 'production',
  scope: ['src/'],
  budget: { attempts: 1, tokens: 100, toolCalls: 3, wallClockMs: 1000 },
  memories: [],
};

class CapturingStore {
  readonly events: FactoryEvent[] = [];
  async append(event: FactoryEvent): Promise<void> {
    this.events.push(event);
  }
  async list(): Promise<FactoryEvent[]> {
    return this.events;
  }
}

describe('step-loop transcript helpers', () => {
  it('keeps one scratchpad context message updated after the harness', () => {
    const transcript: StepTranscript = [{ role: 'context', content: 'harness' }];
    const pad = newScratchpad();
    addNote(pad, 'first');
    syncScratchpadMessage(transcript, pad);
    addNote(pad, 'second');
    syncScratchpadMessage(transcript, pad);

    expect(transcript).toHaveLength(2);
    expect(transcript[1]?.role).toBe('context');
    expect(transcript[1]?.content).toContain('1. first');
    expect(transcript[1]?.content).toContain('2. second');
  });

  it('summarizes an evicted read, debits usage, releases duplicate guard, and emits an event', async () => {
    const transcript: StepTranscript = [
      { role: 'context', content: 'harness' },
      { role: 'tool', callId: 'c1', content: 'x'.repeat(1000) },
    ];
    const store = new CapturingStore();
    const seenCalls = new Set(['guard-key']);
    const callKeyByCallId = new Map([['c1', 'guard-key']]);
    const usages: Usage[] = [];

    await boundStepLoopTranscript({
      goal,
      transcript,
      scratchpad: newScratchpad(),
      store,
      now: () => 123,
      seenCalls,
      callKeyByCallId,
      summarizeRead: async () => ({
        value: 'important gist',
        usage: { promptTokens: 1, completionTokens: 2 },
      }),
      debitUsage: (usage) => usages.push(usage),
      cap: 10,
    });

    expect(transcript[1]?.content).toContain('important gist');
    expect(seenCalls.has('guard-key')).toBe(false);
    expect(usages).toEqual([{ promptTokens: 1, completionTokens: 2 }]);
    expect(store.events[0]).toMatchObject({
      type: 'context-evicted',
      at: 123,
      goalId: 'g1',
    });
    expect(store.events[0]?.type === 'context-evicted' ? store.events[0].detail : '').toContain('summarized');
  });

  it('uses post-truncation wording for truncation eviction', async () => {
    const transcript: StepTranscript = [
      { role: 'context', content: 'harness' },
      { role: 'tool', callId: 'c1', content: 'x'.repeat(1000) },
    ];
    const store = new CapturingStore();

    await evictTranscriptAfterTruncation({
      goal,
      transcript,
      scratchpad: newScratchpad(),
      store,
      now: () => 456,
      seenCalls: new Set(),
      callKeyByCallId: new Map(),
      cap: 10,
    });

    expect(store.events[0]?.type === 'context-evicted' ? store.events[0].detail : '').toContain('post-truncation');
  });
});
