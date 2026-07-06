/**
 * The sink fan-out decorator: appends reach the inner store, then each sink's
 * emit fires — and a throwing sink never breaks the append. The whole point of
 * the seam is that observability cannot compromise durability (ADR-003).
 */

import { describe, it, expect, vi } from 'vitest';
import { SinkFanoutStore } from '../../src/eventlog/sink-fanout-store.js';
import type { EventSink, EventStore, FactoryEvent } from '../../src/contract/events.js';

const sample: FactoryEvent = {
  type: 'goal-received',
  at: 1,
  goalId: 'g1',
  goal: {
    id: 'g1',
    type: 'write-code',
    parentId: null,
    title: 'x',
    spec: 's',
    intent: 'production',
    scope: [],
    budget: { attempts: 1, tokens: 1, toolCalls: 1, wallClockMs: 1 },
    memories: [],
  },
};

class RecordingStore implements EventStore {
  readonly appended: FactoryEvent[] = [];
  async append(e: FactoryEvent): Promise<void> {
    this.appended.push(e);
  }
  async list(): Promise<FactoryEvent[]> {
    return this.appended;
  }
}

describe('SinkFanoutStore', () => {
  it('appends to the inner store, then emits to every sink', async () => {
    const inner = new RecordingStore();
    const a = { emit: vi.fn() };
    const b = { emit: vi.fn() };
    const store = new SinkFanoutStore(inner, [a, b]);

    await store.append(sample);

    expect(inner.appended).toEqual([sample]);
    expect(a.emit).toHaveBeenCalledWith(sample);
    expect(b.emit).toHaveBeenCalledWith(sample);
  });

  it('a throwing sink does not break the append or the other sinks', async () => {
    const inner = new RecordingStore();
    const thrower: EventSink = {
      emit: () => {
        throw new Error('sink down');
      },
    };
    const healthy = { emit: vi.fn() };
    const errors: unknown[] = [];
    const store = new SinkFanoutStore(inner, [thrower, healthy], (_s, e) => errors.push(e));

    await expect(store.append(sample)).resolves.toBeUndefined();

    expect(inner.appended).toEqual([sample]); // Durability held.
    expect(healthy.emit).toHaveBeenCalledWith(sample); // Later sinks still fire.
    expect(errors).toHaveLength(1);
  });

  it('list delegates to the inner store unchanged', async () => {
    const inner = new RecordingStore();
    await inner.append(sample);
    const store = new SinkFanoutStore(inner, []);
    expect(await store.list()).toEqual([sample]);
  });

  it('flush drains flushable sinks and swallows their failures', async () => {
    const inner = new RecordingStore();
    const flushed = vi.fn().mockResolvedValue(undefined);
    const good: EventSink = { emit: vi.fn(), flush: flushed };
    const bad: EventSink = { emit: vi.fn(), flush: () => Promise.reject(new Error('flush fail')) };
    const errors: unknown[] = [];
    const store = new SinkFanoutStore(inner, [good, bad], (_s, e) => errors.push(e));

    await expect(store.flush()).resolves.toBeUndefined();
    expect(flushed).toHaveBeenCalled();
    expect(errors).toHaveLength(1);
  });
});
