/**
 * A JSONL event log as a source, for development against a local run's
 * `out/<repo>/events.jsonl`. `seq` is the 1-based line number. The file is re-read
 * on each call, so a log still being appended to shows up as it grows.
 */

import { readFile } from 'node:fs/promises';

import { parseFactoryEvent } from '../factory.js';
import type { EventSource, StoredEvent } from './event-source.js';

export class JsonlEventSource implements EventSource {
  readonly #path: string;

  constructor(path: string) {
    this.#path = path;
  }

  async after(after: number, limit: number): Promise<StoredEvent[]> {
    let text: string;
    try {
      text = await readFile(this.#path, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
    const lines = text.split('\n');
    const out: StoredEvent[] = [];
    for (let i = after; i < lines.length && out.length < limit; i++) {
      const line = lines[i]!.trim();
      if (line === '') continue;
      let json: unknown;
      try {
        json = JSON.parse(line);
      } catch {
        continue;
      }
      const event = parseFactoryEvent(json);
      if (event) out.push({ seq: i + 1, event });
    }
    return out;
  }

  async close(): Promise<void> {}
}
