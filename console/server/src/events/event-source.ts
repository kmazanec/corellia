/**
 * Where the control plane reads the event log from.
 *
 * An {@link EventSource} is a cursor over the log in append order. `seq` is the
 * store's own monotonic position (the Postgres `bigserial id`), which doubles as
 * the SSE `Last-Event-ID`, so a reader that reconnects resumes without gaps.
 * The control plane never writes through a source: the log is the factory's
 * record (ADR-003), and everything the console holds is derived from it.
 */

import type { FactoryEvent } from '../factory.js';

export interface StoredEvent {
  seq: number;
  event: FactoryEvent;
}

export interface EventSource {
  /** Up to `limit` events with `seq > after`, in ascending `seq` order. */
  after(after: number, limit: number): Promise<StoredEvent[]>;
  close(): Promise<void>;
}

/** An in-process source, for tests and for feeding a fixed log in development. */
export class MemoryEventSource implements EventSource {
  readonly #events: StoredEvent[] = [];

  constructor(events: readonly FactoryEvent[] = []) {
    for (const e of events) this.push(e);
  }

  push(event: FactoryEvent): StoredEvent {
    const stored = { seq: this.#events.length + 1, event };
    this.#events.push(stored);
    return stored;
  }

  async after(after: number, limit: number): Promise<StoredEvent[]> {
    return this.#events.filter((s) => s.seq > after).slice(0, limit);
  }

  async close(): Promise<void> {}
}
