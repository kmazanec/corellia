/**
 * PostgreSQL-backed append-only event store.
 *
 * One row per event. The `id` bigserial is the global ordering key; `at`,
 * `goal_id`, and `type` are promoted to real columns so queries with those
 * filters never touch the JSONB payload. Everything else travels as `payload`.
 *
 * Construct with a connection string (a Pool is created internally) or pass an
 * already-configured Pool directly — useful for connection-pooler setups where
 * the caller controls pool sizing.
 *
 * Two additions serve the control plane (ADR-051):
 * - `job_id` / `worker_id` columns, stamped from the store's {@link EventContext}.
 *   A worker runs one job at a time, so it sets the context when it takes a job
 *   and clears it when the job leaves. Unstamped rows (the single-process
 *   daemon, the CLIs) keep them null; the control plane derives their job from
 *   the goal tree instead.
 * - Every append notifies `corellia_events` with `{id, job}`, so listening
 *   control planes pick new events up without polling.
 */

import pg from 'pg';
import type { EventStore, FactoryEvent } from '../contract/events.js';
import { parseFactoryEvent } from '../contract/event-parser.js';

const { Pool } = pg;

const CREATE_TABLE = `
  CREATE TABLE IF NOT EXISTS corellia_events (
    id       bigserial  PRIMARY KEY,
    at       bigint     NOT NULL,
    goal_id  text       NOT NULL,
    type     text       NOT NULL,
    payload  jsonb      NOT NULL
  )
`;

const CREATE_IDX_GOAL_ID = `
  CREATE INDEX IF NOT EXISTS corellia_events_goal_id ON corellia_events (goal_id)
`;

const CREATE_IDX_TYPE = `
  CREATE INDEX IF NOT EXISTS corellia_events_type ON corellia_events (type)
`;

const ADD_CONTEXT_COLUMNS = `
  ALTER TABLE corellia_events
    ADD COLUMN IF NOT EXISTS job_id    text,
    ADD COLUMN IF NOT EXISTS worker_id text
`;

const CREATE_IDX_JOB_ID = `
  CREATE INDEX IF NOT EXISTS corellia_events_job_id ON corellia_events (job_id)
`;

/** Which job, on which worker, the events being appended belong to. */
export interface EventContext {
  jobId: string;
  workerId: string;
}

export class PgEventStore implements EventStore {
  readonly #pool: pg.Pool;
  readonly #ownsPool: boolean;
  #context: EventContext | null = null;

  constructor(connectionStringOrPool: string | pg.Pool) {
    if (typeof connectionStringOrPool === 'string') {
      this.#pool = new Pool({ connectionString: connectionStringOrPool });
      this.#ownsPool = true;
    } else {
      this.#pool = connectionStringOrPool;
      this.#ownsPool = false;
    }
  }

  /**
   * Create the events table and its indexes idempotently (IF NOT EXISTS).
   * Call once at startup before the first append.
   */
  async ensureSchema(): Promise<void> {
    const client = await this.#pool.connect();
    try {
      await client.query(CREATE_TABLE);
      await client.query(CREATE_IDX_GOAL_ID);
      await client.query(CREATE_IDX_TYPE);
      await client.query(ADD_CONTEXT_COLUMNS);
      await client.query(CREATE_IDX_JOB_ID);
    } finally {
      client.release();
    }
  }

  /** Stamp subsequent appends with `context`, or stop stamping with null. */
  setContext(context: EventContext | null): void {
    this.#context = context;
  }

  async append(e: FactoryEvent): Promise<void> {
    await this.#pool.query(
      `WITH ins AS (
         INSERT INTO corellia_events (at, goal_id, type, payload, job_id, worker_id)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, job_id
       )
       SELECT pg_notify('corellia_events', json_build_object('id', id, 'job', job_id)::text) FROM ins`,
      [e.at, e.goalId, e.type, JSON.stringify(e), this.#context?.jobId ?? null, this.#context?.workerId ?? null],
    );
  }

  async list(filter?: {
    goalId?: string;
    type?: FactoryEvent['type'];
  }): Promise<FactoryEvent[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filter?.goalId !== undefined) {
      params.push(filter.goalId);
      conditions.push(`goal_id = $${params.length}`);
    }

    if (filter?.type !== undefined) {
      params.push(filter.type);
      conditions.push(`type = $${params.length}`);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const sql = `SELECT payload FROM corellia_events ${where} ORDER BY id`;

    const result = await this.#pool.query<{ payload: unknown }>(sql, params);
    const events: FactoryEvent[] = [];
    for (const row of result.rows) {
      const event = parseFactoryEvent(row.payload);
      if (event !== null) events.push(event);
    }
    return events;
  }

  /** End the pool. No-op when the pool was supplied externally. */
  async close(): Promise<void> {
    if (this.#ownsPool) {
      await this.#pool.end();
    }
  }
}
