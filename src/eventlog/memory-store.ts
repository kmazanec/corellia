/**
 * In-memory append-only event store. The canonical reference implementation of
 * EventStore: no I/O, no side effects, safe for tests and single-process runs.
 */

import type { EventStore, FactoryEvent } from '../contract/events.js';

export class InMemoryEventStore implements EventStore {
  readonly #log: FactoryEvent[] = [];

  async append(e: FactoryEvent): Promise<void> {
    this.#log.push(e);
  }

  async list(filter?: { goalId?: string; type?: FactoryEvent['type'] }): Promise<FactoryEvent[]> {
    let result: FactoryEvent[] = this.#log;

    if (filter?.goalId !== undefined) {
      const { goalId } = filter;
      result = result.filter((e) => e.goalId === goalId);
    }

    if (filter?.type !== undefined) {
      const { type } = filter;
      result = result.filter((e) => e.type === type);
    }

    // Return shallow copies so callers cannot mutate the log's entries.
    return result.map((e) => ({ ...e }));
  }
}
