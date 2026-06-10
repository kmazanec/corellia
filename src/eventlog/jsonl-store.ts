/**
 * File-backed append-only event store. Each event is one JSON line; writes are
 * synchronous so the log is durable before the caller sees control again.
 *
 * Reads tolerate a trailing partial line (e.g. from a crash mid-write) by
 * skipping any line that does not parse as valid JSON.
 */

import { mkdirSync, appendFileSync, readFileSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import type { EventStore, FactoryEvent } from '../contract/events.js';

export class JsonlEventStore implements EventStore {
  readonly #path: string;

  constructor(filePath: string) {
    this.#path = filePath;
    mkdirSync(dirname(filePath), { recursive: true });
  }

  append(e: FactoryEvent): void {
    appendFileSync(this.#path, JSON.stringify(e) + '\n', 'utf8');
  }

  list(filter?: { goalId?: string; type?: FactoryEvent['type'] }): FactoryEvent[] {
    if (!existsSync(this.#path)) return [];

    const raw = readFileSync(this.#path, 'utf8');
    const events: FactoryEvent[] = [];

    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        events.push(JSON.parse(trimmed) as FactoryEvent);
      } catch {
        // Skip unparseable lines (e.g. partial writes at crash boundary).
      }
    }

    let result = events;

    if (filter?.goalId !== undefined) {
      const { goalId } = filter;
      result = result.filter((e) => e.goalId === goalId);
    }

    if (filter?.type !== undefined) {
      const { type } = filter;
      result = result.filter((e) => e.type === type);
    }

    return result;
  }
}
