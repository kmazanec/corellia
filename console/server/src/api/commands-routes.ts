/**
 * Operator commands on the queue (ADR-051): commission a job, answer a parked
 * one, cancel one no worker has taken. Each writes through the {@link JobQueue}
 * and then syncs the read-model, so the response carries the job as the
 * console will show it.
 */

import { randomBytes } from 'node:crypto';

import { createRoute, z } from '@hono/zod-openapi';

import type { CommissionInput, JobCommandResult, JobQueue } from '../factory.js';
import type { ReadModel } from '../read-model/read-model.js';
import { AnswerRequest, CommissionRequest, ErrorBody, JobId, JobView } from './schemas.js';
import { apiRouter, wire } from './wire.js';

const DEFAULT_BUDGET = { attempts: 3, tokens: 200_000, toolCalls: 200, wallClockMs: 1_800_000 };

const json = <S extends z.ZodType>(schema: S, description: string) => ({ content: { 'application/json': { schema } }, description });
const errors = {
  404: json(ErrorBody, 'No such job'),
  409: json(ErrorBody, 'The job is not in a state that allows this'),
  422: json(ErrorBody, 'The request names something that does not exist'),
  503: json(ErrorBody, 'This control plane has no job queue (it reads a local log)'),
};
const jobBody = z.object({ job: JobView });

const commission = createRoute({
  method: 'post',
  path: '/jobs',
  tags: ['commands'],
  summary: 'Commission a job: queue it for a worker serving its repo',
  request: { body: { content: { 'application/json': { schema: CommissionRequest } }, required: true } },
  responses: { 201: json(jobBody, 'Queued'), 409: errors[409], 422: errors[422], 503: errors[503] },
});

const answer = createRoute({
  method: 'post',
  path: '/jobs/{jobId}/answer',
  tags: ['commands'],
  summary: 'Answer a parked job; it resumes on the worker holding its worktree',
  request: {
    params: z.object({ jobId: JobId }),
    body: { content: { 'application/json': { schema: AnswerRequest } }, required: true },
  },
  responses: { 200: json(jobBody, 'Answered and re-queued'), 404: errors[404], 409: errors[409], 503: errors[503] },
});

const cancel = createRoute({
  method: 'post',
  path: '/jobs/{jobId}/cancel',
  tags: ['commands'],
  summary: 'Cancel a job no worker has taken yet',
  request: { params: z.object({ jobId: JobId }) },
  responses: { 200: json(jobBody, 'Cancelled'), 404: errors[404], 409: errors[409], 503: errors[503] },
});

export function commandRoutes(model: ReadModel, queue: JobQueue | undefined) {
  const noQueue = { error: 'commissioning needs the shared Postgres (DATABASE_URL)' };

  /** Sync, then answer with the job as the console now shows it. */
  const settle = async (result: JobCommandResult) => {
    if (!result.ok) return result;
    await model.sync();
    return { ok: true as const, job: wire(JobView, model.job(result.job.id)) };
  };

  return apiRouter()
    .openapi(commission, async (c) => {
      if (!queue) return c.json(noQueue, 503);
      const req = c.req.valid('json');
      const served = (await queue.workers()).some((w) => w.repos.includes(req.repo));
      if (!served) return c.json({ error: `no registered worker serves ${req.repo}` }, 422);
      const result = await settle(await queue.enqueue(toCommission(req), req.repo));
      if (!result.ok) return c.json({ error: result.message }, 409);
      return c.json({ job: result.job }, 201);
    })
    .openapi(answer, async (c) => {
      if (!queue) return c.json(noQueue, 503);
      const { jobId } = c.req.valid('param');
      const result = await settle(await queue.answer(jobId, c.req.valid('json').answer));
      if (!result.ok) return c.json({ error: result.message }, result.error === 'not-found' ? 404 : 409);
      return c.json({ job: result.job }, 200);
    })
    .openapi(cancel, async (c) => {
      if (!queue) return c.json(noQueue, 503);
      const result = await settle(await queue.cancel(c.req.valid('param').jobId));
      if (!result.ok) return c.json({ error: result.message }, result.error === 'not-found' ? 404 : 409);
      return c.json({ job: result.job }, 200);
    });
}

function toCommission(req: z.infer<typeof CommissionRequest>): CommissionInput {
  return {
    id: req.id ?? `${slug(req.title)}-${randomBytes(3).toString('hex')}`,
    title: req.title,
    spec: {
      description: req.description,
      constraints: req.constraints,
      ...(req.simulate ? { simulate: req.simulate } : {}),
    },
    scope: req.scope,
    budget: req.budget ?? DEFAULT_BUDGET,
    intent: req.intent,
    ...(req.spendCeilingUsd !== undefined ? { spendCeilingUsd: req.spendCeilingUsd } : {}),
  };
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48).replace(/-$/, '') || 'job';
}
