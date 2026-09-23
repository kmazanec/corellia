/**
 * Drizzle definitions for the tables the control plane reads.
 *
 * `corellia_events` is created and written by the factory
 * (`src/substrate/pg-event-store.ts`); this definition mirrors it for typed,
 * read-only queries. Its DDL stays with the factory (ADR-050).
 */

import { bigint, bigserial, jsonb, pgTable, text } from 'drizzle-orm/pg-core';

export const corelliaEvents = pgTable('corellia_events', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  at: bigint('at', { mode: 'number' }).notNull(),
  goalId: text('goal_id').notNull(),
  type: text('type').notNull(),
  payload: jsonb('payload').notNull(),
});
