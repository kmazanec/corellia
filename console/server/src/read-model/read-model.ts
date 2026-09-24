/**
 * The live read-model: the event log folded into a {@link JobIndex}, joined
 * with the job queue's rows, kept current by pulling past a cursor.
 *
 * Two kinds of subscriber:
 * - {@link ReadModel.subscribe}: every indexed event, with its job.
 * - {@link ReadModel.subscribeJobs}: the id of every job whose view changed,
 *   from a new event or a changed queue row.
 *
 * Pulling works against any source. Where Postgres notifications arrive
 * (`corellia_events`, `corellia_jobs`), they only call {@link ReadModel.sync}
 * early; the cursor and the rows stay the single source of progress.
 */

import type { EventSource, StoredEvent } from '../events/event-source.js';
import type { JobQueue, JobRecord, WorkerRecord } from '../factory.js';
import { JobIndex } from './job-index.js';
import { jobView, type JobView } from './job-view.js';

export interface IndexedEvent extends StoredEvent {
  jobId: string;
}

export type Subscriber = (e: IndexedEvent) => void;
export type JobSubscriber = (jobId: string) => void;

const PAGE = 1000;

export class ReadModel {
  readonly index = new JobIndex();
  readonly #source: EventSource;
  readonly #queue: JobQueue | undefined;
  readonly #subscribers = new Set<Subscriber>();
  readonly #jobSubscribers = new Set<JobSubscriber>();
  #records = new Map<string, JobRecord>();
  #workers: WorkerRecord[] = [];
  #cursor = 0;
  #syncing: Promise<void> | null = null;
  #again = false;
  #timer: NodeJS.Timeout | null = null;

  constructor(source: EventSource, queue?: JobQueue) {
    this.#source = source;
    this.#queue = queue;
  }

  /** The highest `seq` indexed so far. */
  get cursor(): number {
    return this.#cursor;
  }

  /** Every job, most recently active first. */
  jobs(): JobView[] {
    const ids = new Set([...this.index.jobs().map((j) => j.jobId), ...this.#records.keys()]);
    return [...ids]
      .map((id) => this.job(id)!)
      .sort((a, b) => b.lastEventAt - a.lastEventAt || b.lastSeq - a.lastSeq || a.jobId.localeCompare(b.jobId));
  }

  job(jobId: string): JobView | undefined {
    return jobView(this.index.job(jobId), this.#records.get(jobId));
  }

  workers(): WorkerRecord[] {
    return this.#workers;
  }

  /**
   * Bring the model up to date. A call while a pull is running schedules one
   * more pull after it, so a notification never lands between two pulls unseen.
   */
  sync(): Promise<void> {
    if (this.#syncing) {
      this.#again = true;
      return this.#syncing;
    }
    this.#syncing = (async () => {
      do {
        this.#again = false;
        await this.#pull();
      } while (this.#again);
    })().finally(() => {
      this.#syncing = null;
    });
    return this.#syncing;
  }

  subscribe(fn: Subscriber): () => void {
    this.#subscribers.add(fn);
    return () => this.#subscribers.delete(fn);
  }

  subscribeJobs(fn: JobSubscriber): () => void {
    this.#jobSubscribers.add(fn);
    return () => this.#jobSubscribers.delete(fn);
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

  async #pull(): Promise<void> {
    const changed = new Set<string>();
    for (;;) {
      const page = await this.#source.after(this.#cursor, PAGE);
      for (const stored of page) {
        this.#cursor = stored.seq;
        const jobId = this.index.ingest(stored);
        if (jobId === null) continue;
        changed.add(jobId);
        this.#emit(this.#subscribers, { ...stored, jobId });
      }
      if (page.length < PAGE) break;
    }
    if (this.#queue) {
      const [records, workers] = await Promise.all([this.#queue.list(), this.#queue.workers()]);
      const next = new Map(records.map((r) => [r.id, r]));
      for (const r of records) {
        if (this.#records.get(r.id)?.updatedAt !== r.updatedAt) changed.add(r.id);
      }
      this.#records = next;
      this.#workers = workers;
    }
    for (const jobId of changed) this.#emit(this.#jobSubscribers, jobId);
  }

  #emit<T>(subscribers: Set<(v: T) => void>, value: T): void {
    for (const fn of subscribers) {
      try {
        fn(value);
      } catch (err) {
        console.error('[console] subscriber failed:', err);
      }
    }
  }
}
