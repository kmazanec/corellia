/**
 * The Postgres event source: a cursor over `corellia_events` by `id`.
 * Rows whose payload fails the factory's event parser are skipped, never
 * surfaced half-typed.
 */

import { asc, gt } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';

import { corelliaEvents } from '../db/schema.js';
import { parseFactoryEvent } from '../factory.js';
import type { EventSource, StoredEvent } from './event-source.js';

export class PgEventSource implements EventSource {
  readonly #pool: pg.Pool;
  readonly #ownsPool: boolean;
  readonly #db: NodePgDatabase;

  constructor(connectionStringOrPool: string | pg.Pool) {
    this.#ownsPool = typeof connectionStringOrPool === 'string';
    this.#pool = typeof connectionStringOrPool === 'string' ? new pg.Pool({ connectionString: connectionStringOrPool }) : connectionStringOrPool;
    this.#db = drizzle(this.#pool);
  }

  async after(after: number, limit: number): Promise<StoredEvent[]> {
    const rows = await this.#db
      .select({ id: corelliaEvents.id, payload: corelliaEvents.payload })
      .from(corelliaEvents)
      .where(gt(corelliaEvents.id, after))
      .orderBy(asc(corelliaEvents.id))
      .limit(limit);
    const out: StoredEvent[] = [];
    for (const row of rows) {
      const event = parseFactoryEvent(row.payload);
      if (event) out.push({ seq: row.id, event });
    }
    return out;
  }

  async close(): Promise<void> {
    if (this.#ownsPool) await this.#pool.end();
  }
}
