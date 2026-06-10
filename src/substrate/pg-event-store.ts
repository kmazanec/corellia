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
 */

import pg from 'pg';
import type { EventStore, FactoryEvent } from '../contract/events.js';

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

export class PgEventStore implements EventStore {
  readonly #pool: pg.Pool;
  readonly #ownsPool: boolean;

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
    } finally {
      client.release();
    }
  }

  async append(e: FactoryEvent): Promise<void> {
    await this.#pool.query(
      `INSERT INTO corellia_events (at, goal_id, type, payload)
       VALUES ($1, $2, $3, $4)`,
      [e.at, e.goalId, e.type, JSON.stringify(e)],
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

    const result = await this.#pool.query<{ payload: FactoryEvent }>(sql, params);
    return result.rows.map((row) => row.payload);
  }

  /** End the pool. No-op when the pool was supplied externally. */
  async close(): Promise<void> {
    if (this.#ownsPool) {
      await this.#pool.end();
    }
  }
}
