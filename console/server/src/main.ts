/**
 * Control plane entrypoint (ADR-051).
 *
 * Environment:
 *   FRONT_DOOR_TOKEN        operator bearer token (required)
 *   DATABASE_URL            read the shared Postgres event log, or
 *   CONSOLE_EVENTS_JSONL    read a local JSONL log instead (development)
 *   CONSOLE_PORT            listen port (default 8090)
 *   CONSOLE_POLL_MS         read-model sync interval (default 500)
 *   CONSOLE_WEB_DIST        built SPA to serve at / (default ../web/dist, if present)
 */

import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';

import { createApp } from './api/app.js';
import type { EventSource } from './events/event-source.js';
import { JsonlEventSource } from './events/jsonl-event-source.js';
import { PgEventSource } from './events/pg-event-source.js';
import { ReadModel } from './read-model/read-model.js';
import { loadDotEnv } from './factory.js';

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

const model = new ReadModel(chooseSource());
await model.start(pollMs);

const server = new Hono().route('/', createApp({ model, token }));
server.all('/api/*', (c) => c.json({ error: 'not found' }, 404));
if (existsSync(webDist)) {
  server.use('/*', serveStatic({ root: webDist }));
  server.get('*', serveStatic({ path: resolve(webDist, 'index.html') }));
}

serve({ fetch: server.fetch, port }, (info) => {
  console.log(`[console] control plane on :${info.port} — ${model.index.jobs().length} jobs indexed`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void model.stop().finally(() => process.exit(0));
  });
}

function chooseSource(): EventSource {
  const dbUrl = process.env['DATABASE_URL'];
  if (dbUrl) return new PgEventSource(dbUrl);
  const jsonl = process.env['CONSOLE_EVENTS_JSONL'];
  if (jsonl) return new JsonlEventSource(resolve(jsonl));
  console.error('Set DATABASE_URL (shared event log) or CONSOLE_EVENTS_JSONL (a local log)');
  process.exit(1);
}
