/**
 * The control plane's side of the job queue on Postgres, through Drizzle.
 * Workers take the other side (`PgWorkerLink` in the factory) over the same
 * rows. Each change notifies `corellia_jobs`, like the worker side does.
 */

import { and, asc, eq, sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import type pg from 'pg';

import { corelliaJobs, corelliaWorkers } from '../db/schema.js';
import type { CommissionInput, JobCommandResult, JobQueue, JobRecord, JobState, WorkerRecord } from '../factory.js';

type Db = NodePgDatabase;

export class PgJobQueue implements JobQueue {
  readonly #db: Db;
  readonly #now: () => number;

  constructor(pool: pg.Pool, opts: { now?: () => number } = {}) {
    this.#db = drizzle(pool);
    this.#now = opts.now ?? (() => Date.now());
  }

  async enqueue(input: CommissionInput, repo: string): Promise<JobCommandResult> {
    const now = this.#now();
    return this.#db.transaction(async (tx) => {
      const [row] = await tx
        .insert(corelliaJobs)
        .values({ id: input.id, repo, title: input.title, input, state: 'queued', createdAt: now, updatedAt: now })
        .onConflictDoNothing()
        .returning();
      if (!row) return { ok: false, error: 'conflict', message: `job ${input.id} already exists` };
      await notify(tx, row.id);
      return { ok: true, job: row };
    });
  }

  answer(jobId: string, answer: string): Promise<JobCommandResult> {
    return this.#transition(jobId, 'parked', { state: 'queued', answer });
  }

  cancel(jobId: string): Promise<JobCommandResult> {
    return this.#transition(jobId, 'queued', { state: 'cancelled', detail: 'cancelled by the operator', affinityWorkerId: null });
  }

  async get(jobId: string): Promise<JobRecord | null> {
    const [row] = await this.#db.select().from(corelliaJobs).where(eq(corelliaJobs.id, jobId));
    return row ?? null;
  }

  list(): Promise<JobRecord[]> {
    return this.#db.select().from(corelliaJobs).orderBy(asc(corelliaJobs.createdAt), asc(corelliaJobs.id));
  }

  workers(): Promise<WorkerRecord[]> {
    return this.#db.select().from(corelliaWorkers).orderBy(asc(corelliaWorkers.id));
  }

  /** Move a job out of `from` with `patch`, or say why it could not move. */
  async #transition(jobId: string, from: JobState, patch: Partial<typeof corelliaJobs.$inferInsert>): Promise<JobCommandResult> {
    return this.#db.transaction(async (tx) => {
      const [row] = await tx
        .update(corelliaJobs)
        .set({ ...patch, updatedAt: this.#now() })
        .where(and(eq(corelliaJobs.id, jobId), eq(corelliaJobs.state, from)))
        .returning();
      if (row) {
        await notify(tx, row.id);
        return { ok: true, job: row };
      }
      const [current] = await tx.select({ state: corelliaJobs.state }).from(corelliaJobs).where(eq(corelliaJobs.id, jobId));
      return current
        ? { ok: false, error: 'conflict', message: `job ${jobId} is ${current.state}, not ${from}` }
        : { ok: false, error: 'not-found', message: `no job ${jobId}` };
    });
  }
}

function notify(tx: Pick<Db, 'execute'>, jobId: string): Promise<unknown> {
  return tx.execute(sql`SELECT pg_notify('corellia_jobs', ${jobId})`);
}
