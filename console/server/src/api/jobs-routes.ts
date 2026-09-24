/**
 * The job read API: list jobs, one job's summary and goal tree, its events
 * from a cursor, and one goal's detail for the inspector.
 */

import { createRoute, z } from '@hono/zod-openapi';

import type { ReadModel } from '../read-model/read-model.js';
import { apiRouter, wire } from './wire.js';
import { ErrorBody, Goal, GoalId, GoalTreeNode, JobId, JobView, StoredEvent, UsageTotals } from './schemas.js';

const notFound = { content: { 'application/json': { schema: ErrorBody } }, description: 'No such job or goal' };

const listJobs = createRoute({
  method: 'get',
  path: '/jobs',
  tags: ['jobs'],
  summary: 'Every job, most recently active first',
  responses: {
    200: { content: { 'application/json': { schema: z.object({ jobs: z.array(JobView), cursor: z.number().int() }) } }, description: 'Jobs' },
  },
});

const getJob = createRoute({
  method: 'get',
  path: '/jobs/{jobId}',
  tags: ['jobs'],
  summary: 'A job and its goal tree (null until its first event)',
  request: { params: z.object({ jobId: JobId }) },
  responses: {
    200: { content: { 'application/json': { schema: z.object({ job: JobView, tree: GoalTreeNode.nullable() }) } }, description: 'Job' },
    404: notFound,
  },
});

const listJobEvents = createRoute({
  method: 'get',
  path: '/jobs/{jobId}/events',
  tags: ['jobs'],
  summary: "A job's events after a cursor, oldest first",
  request: {
    params: z.object({ jobId: JobId }),
    query: z.object({
      after: z.coerce.number().int().min(0).default(0),
      limit: z.coerce.number().int().min(1).max(5000).default(1000),
    }),
  },
  responses: {
    200: { content: { 'application/json': { schema: z.object({ events: z.array(StoredEvent) }) } }, description: 'Events' },
    404: notFound,
  },
});

const GoalDetailBody = z
  .object({ goal: Goal, node: GoalTreeNode, usage: UsageTotals.nullable(), events: z.array(StoredEvent) })
  .openapi('GoalDetail');

const getGoal = createRoute({
  method: 'get',
  path: '/jobs/{jobId}/goals/{goalId}',
  tags: ['jobs'],
  summary: 'One goal: spec, state, spend, and every event about it',
  request: { params: z.object({ jobId: JobId, goalId: GoalId }) },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: GoalDetailBody,
        },
      },
      description: 'Goal detail',
    },
    404: notFound,
  },
});

export function jobsRoutes(model: ReadModel) {
  const { index } = model;
  return apiRouter()
    .openapi(listJobs, (c) => c.json({ jobs: wire(z.array(JobView), model.jobs()), cursor: model.cursor }, 200))
    .openapi(getJob, (c) => {
      const { jobId } = c.req.valid('param');
      const job = model.job(jobId);
      if (!job) return c.json({ error: `no job ${jobId}` }, 404);
      const tree = index.tree(jobId);
      return c.json({ job: wire(JobView, job), tree: tree ? wire(GoalTreeNode, tree) : null }, 200);
    })
    .openapi(listJobEvents, (c) => {
      const { jobId } = c.req.valid('param');
      const { after, limit } = c.req.valid('query');
      if (!model.job(jobId)) return c.json({ error: `no job ${jobId}` }, 404);
      const events = index.events(jobId, after, limit) ?? [];
      return c.json({ events: wire(z.array(StoredEvent), events) }, 200);
    })
    .openapi(getGoal, (c) => {
      const { jobId, goalId } = c.req.valid('param');
      const detail = index.goal(jobId, goalId);
      if (!detail) return c.json({ error: `no goal ${goalId} in job ${jobId}` }, 404);
      return c.json(wire(GoalDetailBody, detail), 200);
    });
}
