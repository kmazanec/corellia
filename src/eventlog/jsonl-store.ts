/**
 * File-backed append-only event store. Each event is one JSON line; the append
 * resolves once the line is durably written, so the log reflects the event
 * before the caller proceeds.
 *
 * Reads tolerate a trailing partial line (e.g. from a crash mid-write) by
 * skipping any line that does not parse as valid JSON.
 */

import { mkdir, appendFile, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { EventStore, FactoryEvent } from '../contract/events.js';

export class JsonlEventStore implements EventStore {
  readonly #path: string;

  constructor(filePath: string) {
    this.#path = filePath;
  }

  async append(e: FactoryEvent): Promise<void> {
    await mkdir(dirname(this.#path), { recursive: true });
    await appendFile(this.#path, JSON.stringify(e) + '\n', 'utf8');
  }

  async list(filter?: { goalId?: string; type?: FactoryEvent['type'] }): Promise<FactoryEvent[]> {
    let raw: string;
    try {
      raw = await readFile(this.#path, 'utf8');
    } catch {
      // File does not exist yet (no appends): an empty log.
      return [];
    }

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
