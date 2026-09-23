/**
 * The job read API: list jobs, one job's summary and goal tree, its events
 * from a cursor, and one goal's detail for the inspector.
 */

import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';

import type { ReadModel } from '../read-model/read-model.js';
import { ErrorBody, Goal, GoalId, GoalTreeNode, JobId, JobSummary, StoredEvent, UsageTotals } from './schemas.js';

const notFound = { content: { 'application/json': { schema: ErrorBody } }, description: 'No such job or goal' };

const listJobs = createRoute({
  method: 'get',
  path: '/jobs',
  tags: ['jobs'],
  summary: 'Every job, most recently active first',
  responses: {
    200: { content: { 'application/json': { schema: z.object({ jobs: z.array(JobSummary), cursor: z.number().int() }) } }, description: 'Jobs' },
  },
});

const getJob = createRoute({
  method: 'get',
  path: '/jobs/{jobId}',
  tags: ['jobs'],
  summary: "A job's summary and goal tree",
  request: { params: z.object({ jobId: JobId }) },
  responses: {
    200: { content: { 'application/json': { schema: z.object({ job: JobSummary, tree: GoalTreeNode }) } }, description: 'Job' },
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

/**
 * The wire form of a read-model value: a JSON round-trip, which drops the
 * `undefined` members the schemas treat as absent, typed as the route's schema.
 */
const wire = <S extends z.ZodType>(_schema: S, v: unknown): z.infer<S> => JSON.parse(JSON.stringify(v)) as z.infer<S>;

export function jobsRoutes(model: ReadModel) {
  const { index } = model;
  return new OpenAPIHono()
    .openapi(listJobs, (c) => c.json({ jobs: index.jobs(), cursor: model.cursor }, 200))
    .openapi(getJob, (c) => {
      const { jobId } = c.req.valid('param');
      const job = index.job(jobId);
      const tree = index.tree(jobId);
      if (!job || !tree) return c.json({ error: `no job ${jobId}` }, 404);
      return c.json({ job, tree: wire(GoalTreeNode, tree) }, 200);
    })
    .openapi(listJobEvents, (c) => {
      const { jobId } = c.req.valid('param');
      const { after, limit } = c.req.valid('query');
      const events = index.events(jobId, after, limit);
      if (!events) return c.json({ error: `no job ${jobId}` }, 404);
      return c.json({ events: wire(z.array(StoredEvent), events) }, 200);
    })
    .openapi(getGoal, (c) => {
      const { jobId, goalId } = c.req.valid('param');
      const detail = index.goal(jobId, goalId);
      if (!detail) return c.json({ error: `no goal ${goalId} in job ${jobId}` }, 404);
      return c.json(wire(GoalDetailBody, detail), 200);
    });
}
