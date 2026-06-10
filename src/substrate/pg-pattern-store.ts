/**
 * PostgreSQL-backed pattern store.
 *
 * One row per shape. `decision`, `status`, `uses`, `successes`, and `failures`
 * are the mutable columns; `shape` is the natural primary key.
 *
 * Promotion to `trusted` is a human-signoff operation: the factory surfaces a
 * `provisional` memo as a suggestion; nothing in the engine auto-promotes. This
 * method is the API that ceremony calls — the authority gap lives here.
 */

import pg from 'pg';
import type { PatternStore, SplitMemo } from '../contract/pattern.js';
import type { Decision } from '../contract/decision.js';

const { Pool } = pg;

const CREATE_TABLE = `
  CREATE TABLE IF NOT EXISTS corellia_patterns (
    shape      text     PRIMARY KEY,
    decision   jsonb,
    status     text     NOT NULL,
    uses       int      NOT NULL DEFAULT 0,
    successes  int      NOT NULL DEFAULT 0,
    failures   int      NOT NULL DEFAULT 0
  )
`;

export class PgPatternStore implements PatternStore {
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
   * Create the patterns table idempotently (IF NOT EXISTS).
   * Call once at startup before the first record or match.
   */
  async ensureSchema(): Promise<void> {
    await this.#pool.query(CREATE_TABLE);
  }

  async match(shape: string): Promise<SplitMemo | null> {
    const result = await this.#pool.query<{
      shape: string;
      decision: Decision;
      status: string;
      uses: number;
      successes: number;
      failures: number;
    }>(
      `SELECT shape, decision, status, uses, successes, failures
       FROM corellia_patterns WHERE shape = $1`,
      [shape],
    );

    if (result.rowCount === 0) return null;

    const row = result.rows[0];
    if (!row) return null;

    return {
      shape: row.shape,
      decision: row.decision as Extract<Decision, { kind: 'split' }>,
      status: row.status as 'provisional' | 'trusted',
      uses: row.uses,
      successes: row.successes,
      failures: row.failures,
    };
  }

  async record(
    shape: string,
    decision: Extract<Decision, { kind: 'split' }>,
    outcome: 'success' | 'failure',
  ): Promise<void> {
    const successDelta = outcome === 'success' ? 1 : 0;
    const failureDelta = outcome === 'failure' ? 1 : 0;

    await this.#pool.query(
      `INSERT INTO corellia_patterns (shape, decision, status, uses, successes, failures)
         VALUES ($1, $2, 'provisional', 1, $3, $4)
       ON CONFLICT (shape) DO UPDATE
         SET uses      = corellia_patterns.uses + 1,
             successes = corellia_patterns.successes + $3,
             failures  = corellia_patterns.failures  + $4`,
      [shape, JSON.stringify(decision), successDelta, failureDelta],
    );
  }

  /**
   * Move a shape's memo to a trust plane.
   *
   * Promotion to `trusted` is a human-signoff step — the authority gap the
   * machine cannot close on its own. This method is the API that ceremony
   * calls; nothing in the engine calls it directly.
   */
  async promote(shape: string, to: 'provisional' | 'trusted'): Promise<void> {
    await this.#pool.query(
      `UPDATE corellia_patterns SET status = $2 WHERE shape = $1`,
      [shape, to],
    );
  }

  async list(): Promise<SplitMemo[]> {
    const result = await this.#pool.query<{
      shape: string;
      decision: Decision;
      status: string;
      uses: number;
      successes: number;
      failures: number;
    }>(
      `SELECT shape, decision, status, uses, successes, failures
       FROM corellia_patterns ORDER BY shape`,
    );

    return result.rows.map((row) => ({
      shape: row.shape,
      decision: row.decision as Extract<Decision, { kind: 'split' }>,
      status: row.status as 'provisional' | 'trusted',
      uses: row.uses,
      successes: row.successes,
      failures: row.failures,
    }));
  }

  /** End the pool. No-op when the pool was supplied externally. */
  async close(): Promise<void> {
    if (this.#ownsPool) {
      await this.#pool.end();
    }
  }
}
