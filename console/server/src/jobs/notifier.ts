/**
 * Wakes the read-model on Postgres notifications: `corellia_events` (a worker
 * appended) and `corellia_jobs` (a queue row changed). The notification only
 * triggers a sync; the read-model's cursor and rows stay the source of truth,
 * so a missed notification costs latency (until the next poll), never data.
 */

import type pg from 'pg';

const CHANNELS = ['corellia_events', 'corellia_jobs'];

export class PgNotifier {
  readonly #pool: pg.Pool;
  readonly #onNotify: () => void;
  #client: pg.PoolClient | null = null;
  #closed = false;
  #retryMs = 500;

  constructor(pool: pg.Pool, onNotify: () => void) {
    this.#pool = pool;
    this.#onNotify = onNotify;
  }

  async start(): Promise<void> {
    try {
      const client = await this.#pool.connect();
      client.on('notification', () => this.#onNotify());
      client.on('error', () => this.#reconnect(client));
      for (const ch of CHANNELS) await client.query(`LISTEN ${ch}`);
      this.#client = client;
      this.#retryMs = 500;
    } catch (err) {
      console.error('[console] LISTEN failed; polling only until it reconnects:', err instanceof Error ? err.message : err);
      this.#scheduleRetry();
    }
  }

  async close(): Promise<void> {
    this.#closed = true;
    const client = this.#client;
    this.#client = null;
    if (client) {
      await client.query('UNLISTEN *').catch(() => {});
      client.release();
    }
  }

  #reconnect(client: pg.PoolClient): void {
    if (this.#client !== client) return;
    this.#client = null;
    client.release(true);
    this.#scheduleRetry();
  }

  #scheduleRetry(): void {
    if (this.#closed) return;
    setTimeout(() => void this.start(), this.#retryMs).unref();
    this.#retryMs = Math.min(this.#retryMs * 2, 30_000);
  }
}
