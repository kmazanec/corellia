/**
 * The control plane's API shapes, declared once as Zod schemas. Each schema is
 * the route's validator, its OpenAPI component, and (through `hc`) the web
 * client's type (ADR-050).
 */

import { z } from '@hono/zod-openapi';

export const GoalState = z
  .enum(['done', 'failed', 'blocked', 'parked', 'running'])
  .openapi('GoalState');

export const JobStatus = z
  .enum(['queued', 'running', 'parked', 'done', 'failed', 'blocked', 'interrupted', 'cancelled'])
  .openapi('JobStatus');

export const JobBrief = z
  .object({ question: z.string(), options: z.array(z.string()), deadline: z.number().int() })
  .openapi('JobBrief');

export const JobQueueView = z
  .object({
    repo: z.string(),
    workerId: z.string().nullable(),
    affinityWorkerId: z.string().nullable(),
    attempts: z.number().int(),
    brief: JobBrief.nullable(),
    answer: z.string().nullable(),
    detail: z.string().nullable(),
    createdAt: z.number().int(),
    updatedAt: z.number().int(),
  })
  .openapi('JobQueueView');

export const JobView = z
  .object({
    jobId: z.string(),
    title: z.string(),
    goalType: z.string(),
    status: JobStatus,
    startedAt: z.number().int().openapi({ description: 'ms since epoch' }),
    lastEventAt: z.number().int(),
    endedAt: z.number().int().nullable(),
    eventCount: z.number().int(),
    goalCount: z.number().int(),
    costUsd: z.number().nullable(),
    lastSeq: z.number().int().openapi({ description: 'Newest event seq in this job; 0 before its first event' }),
    queue: JobQueueView.nullable().openapi({ description: 'The queue row, when the job came through the queue' }),
  })
  .openapi('Job');

export const WorkerView = z
  .object({
    id: z.string(),
    repos: z.array(z.string()),
    host: z.string(),
    startedAt: z.number().int(),
    lastSeenAt: z.number().int(),
    currentJobId: z.string().nullable(),
    alive: z.boolean().openapi({ description: 'Seen within the staleness window' }),
  })
  .openapi('Worker');

export const RepoView = z
  .object({ repo: z.string(), workers: z.number().int(), alive: z.number().int(), busy: z.number().int() })
  .openapi('Repo');

export const Budget = z
  .object({
    attempts: z.number().int().positive(),
    tokens: z.number().int().positive(),
    toolCalls: z.number().int().positive(),
    wallClockMs: z.number().int().positive(),
  })
  .openapi('Budget');

export const CommissionRequest = z
  .object({
    id: z
      .string()
      .regex(/^[a-z0-9][a-z0-9-]{2,79}$/, 'lowercase kebab-case, 3-80 characters')
      .optional()
      .openapi({ description: 'Defaults to a slug of the title plus a short suffix' }),
    title: z.string().trim().min(3).max(200),
    repo: z.string().min(1).openapi({ description: 'A repo some worker serves (see GET /repos)' }),
    description: z.string().trim().min(1).openapi({ description: 'What should exist when done: behaviour, not implementation' }),
    constraints: z.array(z.string().trim().min(1)).default([]),
    scope: z.array(z.string().trim().min(1)).default([]).openapi({ description: 'Path prefixes the job owns; empty means the whole repo' }),
    intent: z.enum(['production', 'spike', 'characterization']).default('production'),
    spendCeilingUsd: z.number().positive().max(1000).optional(),
    budget: Budget.optional(),
    simulate: z
      .enum(['done', 'failed', 'parked'])
      .optional()
      .openapi({ description: 'Outcome for workers running the simulated engine; ignored by a live engine' }),
  })
  .openapi('CommissionRequest');

export const AnswerRequest = z.object({ answer: z.string().trim().min(1).max(4000) }).openapi('AnswerRequest');

export interface GoalTreeNodeShape {
  goalId: string;
  goalType: string;
  title: string;
  parentId: string | null;
  state: z.infer<typeof GoalState>;
  startedAt: number;
  endedAt?: number | undefined;
  children: GoalTreeNodeShape[];
}

export const GoalTreeNode: z.ZodType<GoalTreeNodeShape> = z
  .object({
    goalId: z.string(),
    goalType: z.string(),
    title: z.string(),
    parentId: z.string().nullable(),
    state: GoalState,
    startedAt: z.number().int(),
    endedAt: z.number().int().optional(),
    get children(): z.ZodArray<z.ZodType<GoalTreeNodeShape>> {
      return z.array(GoalTreeNode);
    },
  })
  .openapi('GoalTreeNode');

/** A factory event as stored. Typed loosely here; `type` discriminates it. */
export const FactoryEvent = z
  .looseObject({ type: z.string(), at: z.number(), goalId: z.string() })
  .openapi('FactoryEvent');

export const StoredEvent = z
  .object({ seq: z.number().int(), event: FactoryEvent })
  .openapi('StoredEvent');

export const UsageTotals = z
  .object({
    promptTokens: z.number(),
    completionTokens: z.number(),
    cachedPromptTokens: z.number(),
    costUsd: z.number().optional(),
    cacheHitShare: z.number().optional(),
  })
  .openapi('UsageTotals');

export const Goal = z
  .looseObject({
    id: z.string(),
    type: z.string(),
    title: z.string(),
    parentId: z.string().nullable(),
    scope: z.array(z.string()),
  })
  .openapi('Goal');

export const JobId = z.string().min(1).openapi({ param: { name: 'jobId', in: 'path' } });
export const GoalId = z.string().min(1).openapi({ param: { name: 'goalId', in: 'path' } });

export const ErrorBody = z.object({ error: z.string() }).openapi('Error');
