/**
 * The control plane's HTTP app: `/api/health` and the OpenAPI document are
 * open; everything else under `/api` requires the operator token.
 */

import { OpenAPIHono } from '@hono/zod-openapi';
import { Hono } from 'hono';

import type { JobQueue } from '../factory.js';
import type { ReadModel } from '../read-model/read-model.js';
import { bearerAuth } from './auth.js';
import { commandRoutes } from './commands-routes.js';
import { fleetRoutes } from './fleet-routes.js';
import { jobsRoutes } from './jobs-routes.js';
import { streamRoutes } from './streams.js';

export interface AppDeps {
  model: ReadModel;
  token: string;
  /** The job queue; absent when the control plane only reads a local log. */
  queue?: JobQueue;
  now?: () => number;
}

export function createApp({ model, token, queue, now = Date.now }: AppDeps) {
  const api = new OpenAPIHono();
  for (const path of ['/jobs', '/jobs/*', '/stream', '/workers', '/repos']) api.use(path, bearerAuth(token));
  api.doc31('/openapi.json', {
    openapi: '3.1.0',
    info: { title: 'Corellia control plane', version: '0.2.0' },
  });

  const routes = api
    .get('/health', (c) => c.json({ ok: true, cursor: model.cursor, queue: queue !== undefined }))
    .route('/', jobsRoutes(model))
    .route('/', commandRoutes(model, queue))
    .route('/', fleetRoutes(model, now))
    .route('/', streamRoutes(model, now));

  return new Hono().route('/api', routes);
}

export type AppType = ReturnType<typeof createApp>;
