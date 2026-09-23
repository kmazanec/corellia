/**
 * The control plane's HTTP app: `/api/health` and the OpenAPI document are
 * open; everything else under `/api` requires the operator token.
 */

import { OpenAPIHono } from '@hono/zod-openapi';
import { Hono } from 'hono';

import type { ReadModel } from '../read-model/read-model.js';
import { bearerAuth } from './auth.js';
import { jobsRoutes } from './jobs-routes.js';
import { streamRoutes } from './streams.js';

export interface AppDeps {
  model: ReadModel;
  token: string;
}

export function createApp({ model, token }: AppDeps) {
  const api = new OpenAPIHono();
  for (const path of ['/jobs', '/jobs/*', '/stream']) api.use(path, bearerAuth(token));
  api.doc31('/openapi.json', {
    openapi: '3.1.0',
    info: { title: 'Corellia control plane', version: '0.1.0' },
  });

  const routes = api
    .get('/health', (c) => c.json({ ok: true, cursor: model.cursor }))
    .route('/', jobsRoutes(model))
    .route('/', streamRoutes(model));

  return new Hono().route('/api', routes);
}

export type AppType = ReturnType<typeof createApp>;
