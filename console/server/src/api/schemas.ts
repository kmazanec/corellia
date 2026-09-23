/**
 * The control plane's API shapes, declared once as Zod schemas. Each schema is
 * the route's validator, its OpenAPI component, and (through `hc`) the web
 * client's type (ADR-050).
 */

import { z } from '@hono/zod-openapi';

export const GoalState = z
  .enum(['done', 'failed', 'blocked', 'parked', 'running'])
  .openapi('GoalState');

export const JobSummary = z
  .object({
    jobId: z.string(),
    title: z.string(),
    goalType: z.string(),
    state: GoalState,
    startedAt: z.number().int().openapi({ description: 'ms since epoch' }),
    lastEventAt: z.number().int(),
    endedAt: z.number().int().nullable(),
    eventCount: z.number().int(),
    goalCount: z.number().int(),
    costUsd: z.number().nullable(),
    lastSeq: z.number().int().openapi({ description: 'Newest event seq in this job' }),
  })
  .openapi('JobSummary');

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
