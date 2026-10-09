/**
 * Control plane entrypoint (ADR-051).
 *
 * Environment:
 *   FRONT_DOOR_TOKEN        operator bearer token (required)
 *   DATABASE_URL            the shared Postgres: event log, job queue, fleet; or
 *   CONSOLE_EVENTS_JSONL    read a local JSONL log instead (read-only; development)
 *   CONSOLE_PORT            listen port (default 8090)
 *   CONSOLE_POLL_MS         read-model poll interval (default 500; notifications
 *                           trigger a sync sooner on Postgres)
 *   CONSOLE_WEB_DIST        built SPA to serve at / (default ../web/dist, if present)
 */

import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import pg from 'pg';

import { createApp } from './api/app.js';
import type { EventSource } from './events/event-source.js';
import { JsonlEventSource } from './events/jsonl-event-source.js';
import { PgEventSource } from './events/pg-event-source.js';
import { ensureJobSchema, loadDotEnv, PgEventStore, type JobQueue } from './factory.js';
import { PgNotifier } from './jobs/notifier.js';
import { PgJobQueue } from './jobs/pg-job-queue.js';
import { ReadModel } from './read-model/read-model.js';

const here = dirname(fileURLToPath(import.meta.url));
loadDotEnv(resolve(here, '../../../.env'));

const token = process.env['FRONT_DOOR_TOKEN'];
if (!token) {
  console.error('FRONT_DOOR_TOKEN is required — set it and restart');
  process.exit(1);
}

const port = Number(process.env['CONSOLE_PORT'] ?? 8090);
const pollMs = Number(process.env['CONSOLE_POLL_MS'] ?? 500);
const webDist = resolve(process.env['CONSOLE_WEB_DIST'] ?? resolve(here, '../../web/dist'));

const { source, queue, pool } = await connect();
const model = new ReadModel(source, queue);
await model.start(pollMs);
const notifier = pool ? new PgNotifier(pool, () => void model.sync().catch(() => {})) : undefined;
await notifier?.start();

const server = new Hono().route('/', createApp({ model, token, ...(queue ? { queue } : {}) }));
server.all('/api/*', (c) => c.json({ error: 'not found' }, 404));
if (existsSync(webDist)) {
  server.use('/*', serveStatic({ root: webDist }));
  server.get('*', serveStatic({ path: resolve(webDist, 'index.html') }));
}

serve({ fetch: server.fetch, port }, (info) => {
  const mode = queue ? 'postgres: log + queue + fleet' : 'read-only local log';
  console.log(`[console] control plane on :${info.port} (${mode}) — ${model.jobs().length} jobs indexed`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void (async () => {
      await notifier?.close();
      await model.stop();
      await pool?.end();
      process.exit(0);
    })();
  });
}

async function connect(): Promise<{ source: EventSource; queue?: JobQueue; pool?: pg.Pool }> {
  const dbUrl = process.env['DATABASE_URL'];
  if (dbUrl) {
    const pool = new pg.Pool({ connectionString: dbUrl });
    await new PgEventStore(pool).ensureSchema();
    await ensureJobSchema(pool);
    return { source: new PgEventSource(pool), queue: new PgJobQueue(pool), pool };
  }
  const jsonl = process.env['CONSOLE_EVENTS_JSONL'];
  if (jsonl) return { source: new JsonlEventSource(resolve(jsonl)) };
  console.error('Set DATABASE_URL (shared event log and queue) or CONSOLE_EVENTS_JSONL (a local log, read-only)');
  process.exit(1);
}
