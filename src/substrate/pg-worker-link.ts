/**
 * The worker's side of the job queue on Postgres (ADR-051).
 *
 * The factory owns the queue's tables ({@link ensureJobSchema}); the control
 * plane writes the same rows through its own client. Every mutation notifies
 * `corellia_jobs` with the job id, so control planes can refresh without
 * polling.
 *
 * Claims are serialised by a transaction-scoped advisory lock. That makes the
 * scope-overlap check (a read of the running set) and the claim (a write)
 * atomic across workers; claims are rare enough that one lock is cheap.
 */

import pg from 'pg';

import {
  JOB_LEASE_MS,
  MAX_JOB_ATTEMPTS,
  type ClaimedJob,
  type JobBrief,
  type JobOutcome,
  type JobRecord,
  type WorkerLink,
} from '../contract/jobs.js';
import { scopesOverlap } from '../listener/scope-overlap.js';

const { Pool } = pg;

/** The queue's tables. Idempotent; safe for every process to run at start. */
export const JOBS_DDL = [
  `CREATE TABLE IF NOT EXISTS corellia_jobs (
     id                 text    PRIMARY KEY,
     repo               text    NOT NULL,
     title              text    NOT NULL,
     input              jsonb   NOT NULL,
     state              text    NOT NULL,
     created_at         bigint  NOT NULL,
     updated_at         bigint  NOT NULL,
     worker_id          text,
     affinity_worker_id text,
     lease_until        bigint,
     attempts           integer NOT NULL DEFAULT 0,
     brief              jsonb,
     answer             text,
     detail             text
   )`,
  `CREATE INDEX IF NOT EXISTS corellia_jobs_claim ON corellia_jobs (repo, state, created_at)`,
  `CREATE TABLE IF NOT EXISTS corellia_workers (
     id             text    PRIMARY KEY,
     repos          text[]  NOT NULL,
     host           text    NOT NULL,
     started_at     bigint  NOT NULL,
     last_seen_at   bigint  NOT NULL,
     current_job_id text
   )`,
];

/** The advisory-lock key that serialises claims (arbitrary, fixed). */
const CLAIM_LOCK = 0x636f7231;

export async function ensureJobSchema(pool: pg.Pool): Promise<void> {
  for (const ddl of JOBS_DDL) await pool.query(ddl);
}

interface JobRow {
  id: string;
  repo: string;
  title: string;
  input: JobRecord['input'];
  state: JobRecord['state'];
  created_at: string;
  updated_at: string;
  worker_id: string | null;
  affinity_worker_id: string | null;
  lease_until: string | null;
  attempts: number;
  brief: JobBrief | null;
  answer: string | null;
  detail: string | null;
}

export function jobFromRow(r: JobRow): JobRecord {
  return {
    id: r.id,
    repo: r.repo,
    title: r.title,
    input: r.input,
    state: r.state,
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
    workerId: r.worker_id,
    affinityWorkerId: r.affinity_worker_id,
    leaseUntil: r.lease_until === null ? null : Number(r.lease_until),
    attempts: r.attempts,
    brief: r.brief,
    answer: r.answer,
    detail: r.detail,
  };
}

export class PgWorkerLink implements WorkerLink {
  readonly #pool: pg.Pool;
  readonly #ownsPool: boolean;
  readonly #now: () => number;

  constructor(connectionStringOrPool: string | pg.Pool, opts: { now?: () => number } = {}) {
    this.#ownsPool = typeof connectionStringOrPool === 'string';
    this.#pool = typeof connectionStringOrPool === 'string' ? new Pool({ connectionString: connectionStringOrPool }) : connectionStringOrPool;
    this.#now = opts.now ?? (() => Date.now());
  }

  ensureSchema(): Promise<void> {
    return ensureJobSchema(this.#pool);
  }

  async close(): Promise<void> {
    if (this.#ownsPool) await this.#pool.end();
  }

  async register(worker: { id: string; repos: string[]; host: string }): Promise<void> {
    const now = this.#now();
    await this.#pool.query(
      `INSERT INTO corellia_workers (id, repos, host, started_at, last_seen_at, current_job_id)
       VALUES ($1, $2, $3, $4, $4, NULL)
       ON CONFLICT (id) DO UPDATE SET repos = $2, host = $3, started_at = $4, last_seen_at = $4, current_job_id = NULL`,
      [worker.id, worker.repos, worker.host, now],
    );
  }

  async deregister(workerId: string): Promise<void> {
    await this.#pool.query('DELETE FROM corellia_workers WHERE id = $1', [workerId]);
  }

  async heartbeat(workerId: string): Promise<void> {
    const now = this.#now();
    await this.#tx(async (c) => {
      const { rows } = await c.query<{ current_job_id: string | null }>(
        'UPDATE corellia_workers SET last_seen_at = $2 WHERE id = $1 RETURNING current_job_id',
        [workerId, now],
      );
      const jobId = rows[0]?.current_job_id;
      if (!jobId) return;
      const held = await c.query(
        `UPDATE corellia_jobs SET lease_until = $3, updated_at = $4
         WHERE id = $1 AND worker_id = $2 AND state = 'running'`,
        [jobId, workerId, now + JOB_LEASE_MS, now],
      );
      if (held.rowCount) await notify(c, jobId);
    });
  }

  async claim(workerId: string, repos: string[]): Promise<ClaimedJob | null> {
    const now = this.#now();
    return this.#tx(async (c) => {
      await c.query('SELECT pg_advisory_xact_lock($1)', [CLAIM_LOCK]);

      const exhausted = await c.query<{ id: string }>(
        `UPDATE corellia_jobs
         SET state = 'failed', lease_until = NULL, updated_at = $1,
             detail = 'lease lost after ' || attempts || ' claims'
         WHERE state = 'running' AND lease_until < $1 AND attempts >= $2
         RETURNING id`,
        [now, MAX_JOB_ATTEMPTS],
      );
      for (const r of exhausted.rows) await notify(c, r.id);

      // Affinity binds only while its worker is registered and recently seen.
      const { rows: candidates } = await c.query<JobRow>(
        `SELECT j.* FROM corellia_jobs j
         WHERE j.repo = ANY($1)
           AND ((j.state = 'queued'
                 AND (j.affinity_worker_id IS NULL
                      OR j.affinity_worker_id = $2
                      OR NOT EXISTS (SELECT 1 FROM corellia_workers w
                                     WHERE w.id = j.affinity_worker_id AND w.last_seen_at >= $4)))
                OR (j.state = 'running' AND j.lease_until < $3))
         ORDER BY j.created_at, j.id`,
        [repos, workerId, now, now - JOB_LEASE_MS],
      );
      if (candidates.length === 0) return null;

      const { rows: running } = await c.query<{ repo: string; scope: string[] }>(
        `SELECT repo, input->'scope' AS scope FROM corellia_jobs
         WHERE repo = ANY($1) AND state = 'running' AND lease_until >= $2`,
        [repos, now],
      );
      const pick = candidates.find(
        (cand) => !running.some((r) => r.repo === cand.repo && scopesOverlap(r.scope, cand.input.scope)),
      );
      if (!pick) return null;

      const resume = pick.brief && pick.answer !== null ? { question: pick.brief.question, answer: pick.answer } : null;
      const { rows } = await c.query<JobRow>(
        `UPDATE corellia_jobs
         SET state = 'running', worker_id = $2, affinity_worker_id = NULL, lease_until = $3,
             attempts = attempts + 1, brief = NULL, answer = NULL, updated_at = $4
         WHERE id = $1 RETURNING *`,
        [pick.id, workerId, now + JOB_LEASE_MS, now],
      );
      await c.query('UPDATE corellia_workers SET current_job_id = $2, last_seen_at = $3 WHERE id = $1', [workerId, pick.id, now]);
      await notify(c, pick.id);
      return { job: jobFromRow(rows[0]!), resume };
    });
  }

  async park(jobId: string, workerId: string, brief: JobBrief): Promise<void> {
    const now = this.#now();
    await this.#tx(async (c) => {
      const res = await c.query(
        `UPDATE corellia_jobs
         SET state = 'parked', brief = $3, affinity_worker_id = $2, lease_until = NULL, updated_at = $4
         WHERE id = $1 AND worker_id = $2 AND state = 'running'`,
        [jobId, workerId, JSON.stringify(brief), now],
      );
      if (!res.rowCount) return;
      await this.#release(c, workerId);
      await notify(c, jobId);
    });
  }

  async finish(jobId: string, workerId: string, outcome: JobOutcome, detail?: string): Promise<void> {
    const now = this.#now();
    await this.#tx(async (c) => {
      const res = await c.query(
        `UPDATE corellia_jobs
         SET state = $3, detail = $4, lease_until = NULL, affinity_worker_id = NULL, updated_at = $5
         WHERE id = $1 AND worker_id = $2 AND state = 'running'`,
        [jobId, workerId, outcome, detail ?? null, now],
      );
      if (!res.rowCount) return;
      await this.#release(c, workerId);
      await notify(c, jobId);
    });
  }

  async sweepExpiredParks(now: number): Promise<JobRecord[]> {
    return this.#tx(async (c) => {
      const { rows } = await c.query<JobRow>(
        `UPDATE corellia_jobs
         SET state = 'blocked', affinity_worker_id = NULL, updated_at = $1,
             detail = 'brief unanswered past its deadline'
         WHERE state = 'parked' AND (brief->>'deadline')::bigint <= $1
         RETURNING *`,
        [now],
      );
      for (const r of rows) await notify(c, r.id);
      return rows.map(jobFromRow);
    });
  }

  async #release(c: pg.PoolClient, workerId: string): Promise<void> {
    await c.query('UPDATE corellia_workers SET current_job_id = NULL WHERE id = $1', [workerId]);
  }

  async #tx<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
    const c = await this.#pool.connect();
    try {
      await c.query('BEGIN');
      const out = await fn(c);
      await c.query('COMMIT');
      return out;
    } catch (err) {
      await c.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      c.release();
    }
  }
}

/** Tell listening control planes a job row changed. Delivered on commit. */
function notify(c: pg.PoolClient, jobId: string): Promise<unknown> {
  return c.query("SELECT pg_notify('corellia_jobs', $1)", [jobId]);
}
