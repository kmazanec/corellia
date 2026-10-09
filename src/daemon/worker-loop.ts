/**
 * The queue worker's loop (ADR-051): register, then repeatedly sweep expired
 * parks, claim one job, and run it to a park or a finish, keeping its lease
 * alive meanwhile. One job at a time; parallelism is more workers.
 *
 * The worker runs each job through its own {@link Listener}, so the listener
 * stays the single brief authority for the run (ADR-008). A park the listener
 * records is handed straight to the queue, which owns waiting and answers
 * from then on; a claimed answer comes back through {@link Listener.resume}.
 */

import type { EventStore } from '../contract/events.js';
import type { ClaimedJob, JobRecord, WorkerLink } from '../contract/jobs.js';
import type { Listener } from '../listener/listener.js';
import type { EventContext } from '../substrate/pg-event-store.js';

export interface WorkerLoopOptions {
  id: string;
  repos: string[];
  host: string;
  link: WorkerLink;
  listener: Listener;
  /** The store the listener appends to, for the worker's own events. */
  store: EventStore;
  /** Stamps appended events with the job being run (a `PgEventStore`), when the store supports it. */
  stamp?: { setContext(context: EventContext | null): void };
  pollMs?: number;
  heartbeatMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  log?: (line: string) => void;
}

export type TickResult = 'idle' | 'ran';

export class WorkerLoop {
  readonly #o: Required<Omit<WorkerLoopOptions, 'stamp'>> & Pick<WorkerLoopOptions, 'stamp'>;
  #running = false;
  #current: ClaimedJob | null = null;
  #stopped: Promise<void> | null = null;

  constructor(opts: WorkerLoopOptions) {
    this.#o = {
      pollMs: 2_000,
      heartbeatMs: 15_000,
      now: () => Date.now(),
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      log: (line) => console.log(`[worker ${opts.id}] ${line}`),
      ...opts,
    };
  }

  /** The job being run right now, if any. */
  get current(): JobRecord | null {
    return this.#current?.job ?? null;
  }

  async start(): Promise<void> {
    const { link, id, repos, host } = this.#o;
    await link.register({ id, repos, host });
    this.#o.log(`registered for ${repos.join(', ')}`);
    this.#running = true;
    this.#stopped = this.#loop();
  }

  /** Stop claiming. Resolves once the loop has let go (a running job keeps running). */
  async stop(): Promise<void> {
    this.#running = false;
    await this.#stopped;
  }

  /**
   * Leave the queue: record the job in hand as interrupted (its worktree is
   * the caller's to preserve) and deregister.
   */
  async leave(reason: string): Promise<void> {
    this.#running = false;
    const job = this.#current?.job;
    if (job) await this.#o.link.finish(job.id, this.#o.id, 'interrupted', reason);
    await this.#o.link.deregister(this.#o.id);
  }

  /** One pass: sweep expired parks, then claim and run at most one job. */
  async tick(): Promise<TickResult> {
    await this.#sweep();
    const claimed = await this.#o.link.claim(this.#o.id, this.#o.repos);
    if (!claimed) {
      await this.#o.link.heartbeat(this.#o.id);
      return 'idle';
    }
    await this.#run(claimed);
    return 'ran';
  }

  async #loop(): Promise<void> {
    let backoff = this.#o.pollMs;
    while (this.#running) {
      try {
        const result = await this.tick();
        backoff = this.#o.pollMs;
        if (result === 'idle' && this.#running) await this.#o.sleep(this.#o.pollMs);
      } catch (err) {
        this.#o.log(`loop error: ${err instanceof Error ? err.message : String(err)}`);
        await this.#o.sleep(backoff);
        backoff = Math.min(backoff * 2, 60_000);
      }
    }
  }

  async #run(claimed: ClaimedJob): Promise<void> {
    const { link, listener, id: workerId } = this.#o;
    const { job, resume } = claimed;
    this.#current = claimed;
    this.#o.stamp?.setContext({ jobId: job.id, workerId });
    this.#o.log(`${resume ? 'resuming' : 'running'} ${job.id} (${job.title})`);
    const beat = setInterval(() => {
      link.heartbeat(workerId).catch((err: unknown) => this.#o.log(`heartbeat failed: ${String(err)}`));
    }, this.#o.heartbeatMs);

    try {
      const report = resume
        ? await listener.resume(job.input, resume.question, resume.answer)
        : await listener.commission(job.input);
      const parked = listener.handOffParked(job.id);
      if (parked) {
        await link.park(job.id, workerId, parked);
        this.#o.log(`${job.id} parked: ${parked.question}`);
      } else if (report.blockers.length > 0) {
        await link.finish(job.id, workerId, 'failed', summarize(report.blockers));
        this.#o.log(`${job.id} failed`);
      } else {
        await link.finish(job.id, workerId, 'done');
        this.#o.log(`${job.id} done`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await link.finish(job.id, workerId, 'failed', message.slice(0, 500));
      this.#o.log(`${job.id} errored: ${message}`);
    } finally {
      clearInterval(beat);
      this.#o.stamp?.setContext(null);
      this.#current = null;
    }
  }

  /** Bounce parks nobody answered in time, recording each in the log as the listener's own sweep does. */
  async #sweep(): Promise<void> {
    const now = this.#o.now();
    for (const job of await this.#o.link.sweepExpiredParks(now)) {
      this.#o.stamp?.setContext({ jobId: job.id, workerId: this.#o.id });
      try {
        await this.#o.store.append({
          type: 'blocked',
          at: now,
          goalId: job.id,
          brief: { question: job.brief?.question ?? '', options: ['bounce'], links: [job.id], deadlineMs: 0, onTimeout: 'park' },
          resolution: 'bounce',
        });
      } finally {
        this.#o.stamp?.setContext(null);
      }
      this.#o.log(`${job.id} bounced: brief unanswered past its deadline`);
    }
  }
}

function summarize(blockers: string[]): string {
  const text = blockers.join(' · ');
  return text.length > 500 ? `${text.slice(0, 497)}...` : text;
}
