/**
 * The live read-model: an {@link EventSource} folded into a {@link JobIndex},
 * kept current by pulling new events past a cursor, with subscribers told about
 * every event as it is indexed.
 *
 * Pulling by cursor works against any source. When workers emit
 * `NOTIFY corellia_events` (ADR-051 Phase 2), a notification simply triggers
 * {@link ReadModel.sync} early; the cursor stays the single source of progress.
 */

import type { EventSource, StoredEvent } from '../events/event-source.js';
import { JobIndex } from './job-index.js';

export interface IndexedEvent extends StoredEvent {
  jobId: string;
}

export type Subscriber = (e: IndexedEvent) => void;

const PAGE = 1000;

export class ReadModel {
  readonly index = new JobIndex();
  readonly #source: EventSource;
  readonly #subscribers = new Set<Subscriber>();
  #cursor = 0;
  #syncing: Promise<number> | null = null;
  #timer: NodeJS.Timeout | null = null;

  constructor(source: EventSource) {
    this.#source = source;
  }

  /** The highest `seq` indexed so far. */
  get cursor(): number {
    return this.#cursor;
  }

  /** Pull everything new from the source. Concurrent calls share one pull. */
  sync(): Promise<number> {
    this.#syncing ??= this.#pull().finally(() => {
      this.#syncing = null;
    });
    return this.#syncing;
  }

  subscribe(fn: Subscriber): () => void {
    this.#subscribers.add(fn);
    return () => this.#subscribers.delete(fn);
  }

  /** Sync now, then every `intervalMs` until {@link stop}. */
  async start(intervalMs: number): Promise<void> {
    await this.sync();
    this.#timer = setInterval(() => {
      this.sync().catch((err: unknown) => {
        console.error('[console] read-model sync failed:', err);
      });
    }, intervalMs);
    this.#timer.unref();
  }

  async stop(): Promise<void> {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
    await this.#syncing;
    await this.#source.close();
  }

  async #pull(): Promise<number> {
    let added = 0;
    for (;;) {
      const page = await this.#source.after(this.#cursor, PAGE);
      for (const stored of page) {
        this.#cursor = stored.seq;
        const jobId = this.index.ingest(stored);
        added++;
        if (jobId !== null) this.#publish({ ...stored, jobId });
      }
      if (page.length < PAGE) return added;
    }
  }

  #publish(e: IndexedEvent): void {
    for (const fn of this.#subscribers) {
      try {
        fn(e);
      } catch (err) {
        console.error('[console] subscriber failed:', err);
      }
    }
  }
}
