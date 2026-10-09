/**
 * The fleet: registered workers and the repos they serve (ADR-051). A worker
 * is alive while it keeps heartbeating; a repo can take commissions while
 * some registered worker serves it.
 */

import { createRoute, z } from '@hono/zod-openapi';

import type { ReadModel } from '../read-model/read-model.js';
import { RepoView, WorkerView } from './schemas.js';
import { apiRouter } from './wire.js';

/** A worker unseen for this long is shown as not alive. */
export const WORKER_STALE_MS = 60_000;

const listWorkers = createRoute({
  method: 'get',
  path: '/workers',
  tags: ['fleet'],
  summary: 'Registered workers',
  responses: { 200: { content: { 'application/json': { schema: z.object({ workers: z.array(WorkerView) }) } }, description: 'Workers' } },
});

const listRepos = createRoute({
  method: 'get',
  path: '/repos',
  tags: ['fleet'],
  summary: 'Repos some registered worker serves',
  responses: { 200: { content: { 'application/json': { schema: z.object({ repos: z.array(RepoView) }) } }, description: 'Repos' } },
});

export function fleetView(model: ReadModel, now: number) {
  const workers = model.workers().map((w) => ({ ...w, alive: now - w.lastSeenAt < WORKER_STALE_MS }));
  const byRepo = new Map<string, { repo: string; workers: number; alive: number; busy: number }>();
  for (const w of workers) {
    for (const repo of w.repos) {
      const r = byRepo.get(repo) ?? { repo, workers: 0, alive: 0, busy: 0 };
      r.workers += 1;
      if (w.alive) r.alive += 1;
      if (w.currentJobId) r.busy += 1;
      byRepo.set(repo, r);
    }
  }
  return { workers, repos: [...byRepo.values()].sort((a, b) => a.repo.localeCompare(b.repo)) };
}

export function fleetRoutes(model: ReadModel, now: () => number = Date.now) {
  return apiRouter()
    .openapi(listWorkers, (c) => c.json({ workers: fleetView(model, now()).workers }, 200))
    .openapi(listRepos, (c) => c.json({ repos: fleetView(model, now()).repos }, 200));
}
