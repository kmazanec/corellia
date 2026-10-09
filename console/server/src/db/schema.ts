/**
 * Drizzle definitions for the tables the control plane uses.
 *
 * The factory creates all of them (`src/substrate/pg-event-store.ts`,
 * `src/substrate/pg-worker-link.ts`); these definitions mirror them so the
 * control plane queries with types instead of SQL strings. DDL stays with the
 * factory (ADR-050), and a round-trip test keeps the mirror honest.
 *
 * - `corellia_events`: read only. The log belongs to the workers (ADR-003).
 * - `corellia_jobs`: the control plane inserts jobs and records answers and
 *   cancels; workers claim, park, and finish them (ADR-051).
 * - `corellia_workers`: read only; workers register themselves.
 */

import { bigint, bigserial, integer, jsonb, pgTable, text } from 'drizzle-orm/pg-core';

import type { CommissionInput, JobBrief, JobState } from '../factory.js';

export const corelliaEvents = pgTable('corellia_events', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  at: bigint('at', { mode: 'number' }).notNull(),
  goalId: text('goal_id').notNull(),
  type: text('type').notNull(),
  payload: jsonb('payload').notNull(),
  jobId: text('job_id'),
  workerId: text('worker_id'),
});

export const corelliaJobs = pgTable('corellia_jobs', {
  id: text('id').primaryKey(),
  repo: text('repo').notNull(),
  title: text('title').notNull(),
  input: jsonb('input').$type<CommissionInput>().notNull(),
  state: text('state').$type<JobState>().notNull(),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
  workerId: text('worker_id'),
  affinityWorkerId: text('affinity_worker_id'),
  leaseUntil: bigint('lease_until', { mode: 'number' }),
  attempts: integer('attempts').notNull().default(0),
  brief: jsonb('brief').$type<JobBrief>(),
  answer: text('answer'),
  detail: text('detail'),
});

export const corelliaWorkers = pgTable('corellia_workers', {
  id: text('id').primaryKey(),
  repos: text('repos').array().notNull(),
  host: text('host').notNull(),
  startedAt: bigint('started_at', { mode: 'number' }).notNull(),
  lastSeenAt: bigint('last_seen_at', { mode: 'number' }).notNull(),
  currentJobId: text('current_job_id'),
});
