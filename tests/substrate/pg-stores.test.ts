/**
 * Integration tests for PgEventStore and PgPatternStore.
 *
 * Requires a live Postgres instance. Set DATABASE_URL to run:
 *   DATABASE_URL=postgres://postgres:corellia@localhost:54329/postgres npx vitest run tests/substrate
 *
 * Without DATABASE_URL the entire suite is skipped, keeping CI green for
 * contributors without a local database.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import pg from 'pg';
import { PgEventStore } from '../../src/substrate/pg-event-store.js';
import { PgPatternStore } from '../../src/substrate/pg-pattern-store.js';
import type { FactoryEvent } from '../../src/contract/events.js';
import type { Decision } from '../../src/contract/decision.js';

const { Pool } = pg;

const DB_URL = process.env['DATABASE_URL'];
const skip = !DB_URL;

// A minimal valid FactoryEvent for payload-fidelity checks.
const SAMPLE_EVENT: FactoryEvent = {
  type: 'goal-received',
  at: 1_700_000_000_000,
  goalId: 'goal-abc',
  goal: {
    id: 'goal-abc',
    type: 'write-code',
    parentId: null,
    title: 'Write a greeting',
    spec: { language: 'ts' },
    intent: 'production',
    scope: ['src/'],
    budget: { attempts: 3, tokens: 8000, toolCalls: 20, wallClockMs: 60_000 },
    memories: [],
  },
};

const SPLIT_DECISION: Extract<Decision, { kind: 'split' }> = {
  kind: 'split',
  children: [
    {
      localId: 'child-1',
      type: 'write-code',
      title: 'Implement foo',
      spec: {},
      dependsOn: [],
      scope: ['src/foo.ts'],
      budgetShare: 0.5,
    },
  ],
};

// --------------------------------------------------------------------------
// PgEventStore
// --------------------------------------------------------------------------
describe.skipIf(skip)('PgEventStore (integration)', () => {
  let pool: pg.Pool;
  let store: PgEventStore;

  beforeAll(async () => {
    pool = new Pool({ connectionString: DB_URL });
    store = new PgEventStore(pool);
    await store.ensureSchema();
    // Start each test suite with a clean slate.
    await pool.query('TRUNCATE corellia_events RESTART IDENTITY');
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await pool.query('TRUNCATE corellia_events RESTART IDENTITY');
  });

  it('schema creation is idempotent — ensureSchema can be called twice', async () => {
    await store.ensureSchema();
    // No error means the IF NOT EXISTS guards held.
  });

  it('list returns empty array on a fresh log', async () => {
    expect(await store.list()).toEqual([]);
  });

  it('appends and lists an event in insertion order', async () => {
    await store.append(SAMPLE_EVENT);
    const events = await store.list();
    expect(events).toHaveLength(1);
  });

  it('preserves full FactoryEvent payload fidelity', async () => {
    await store.append(SAMPLE_EVENT);
    const [stored] = await store.list();
    expect(stored).toEqual(SAMPLE_EVENT);
  });

  it('multiple events come back in append order', async () => {
    const e1: FactoryEvent = { ...SAMPLE_EVENT, goalId: 'g1', at: 1000 };
    const e2: FactoryEvent = {
      type: 'emitted',
      at: 2000,
      goalId: 'g2',
      report: {
        artifact: null,
        proof: [],
        lessons: [],
        memoriesUsed: [],
        blockers: [],
        findings: [],
        learned: 'Nothing new.',
      },
    };
    await store.append(e1);
    await store.append(e2);
    const events = await store.list();
    expect(events).toHaveLength(2);
    expect(events[0]!.goalId).toBe('g1');
    expect(events[1]!.goalId).toBe('g2');
  });

  it('filters by goalId', async () => {
    const e1: FactoryEvent = { ...SAMPLE_EVENT, goalId: 'filter-a', at: 100 };
    const e2: FactoryEvent = { ...SAMPLE_EVENT, goalId: 'filter-b', at: 200 };
    await store.append(e1);
    await store.append(e2);
    const result = await store.list({ goalId: 'filter-a' });
    expect(result).toHaveLength(1);
    expect(result[0]!.goalId).toBe('filter-a');
  });

  it('filters by type', async () => {
    const e1: FactoryEvent = {
      type: 'goal-received',
      at: 100,
      goalId: 'g-type-test',
      goal: SAMPLE_EVENT.goal,
    } satisfies FactoryEvent;
    const e2: FactoryEvent = {
      type: 'budget-exhausted',
      at: 200,
      goalId: 'g-type-test',
      dimension: 'tokens',
    };
    await store.append(e1);
    await store.append(e2);
    const result = await store.list({ type: 'budget-exhausted' });
    expect(result).toHaveLength(1);
    expect(result[0]!.type).toBe('budget-exhausted');
  });

  it('filters by both goalId and type', async () => {
    const e1: FactoryEvent = { ...SAMPLE_EVENT, goalId: 'combo-a', at: 1 };
    const e2: FactoryEvent = { ...SAMPLE_EVENT, goalId: 'combo-b', at: 2 };
    await store.append(e1);
    await store.append(e2);
    const result = await store.list({ goalId: 'combo-a', type: 'goal-received' });
    expect(result).toHaveLength(1);
    expect(result[0]!.goalId).toBe('combo-a');
  });
});

// --------------------------------------------------------------------------
// PgPatternStore
// --------------------------------------------------------------------------
describe.skipIf(skip)('PgPatternStore (integration)', () => {
  let pool: pg.Pool;
  let store: PgPatternStore;

  beforeAll(async () => {
    pool = new Pool({ connectionString: DB_URL });
    store = new PgPatternStore(pool);
    await store.ensureSchema();
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await pool.query('TRUNCATE corellia_patterns');
  });

  it('schema creation is idempotent', async () => {
    await store.ensureSchema();
  });

  it('match returns null for an unknown shape', async () => {
    expect(await store.match('never-seen')).toBeNull();
  });

  it('record creates a provisional memo on first success', async () => {
    await store.record('pg-shape-1', SPLIT_DECISION, 'success');
    const memo = await store.match('pg-shape-1');
    expect(memo).not.toBeNull();
    expect(memo!.status).toBe('provisional');
    expect(memo!.uses).toBe(1);
    expect(memo!.successes).toBe(1);
    expect(memo!.failures).toBe(0);
  });

  it('record creates a provisional memo on first failure', async () => {
    await store.record('pg-shape-fail', SPLIT_DECISION, 'failure');
    const memo = await store.match('pg-shape-fail');
    expect(memo!.status).toBe('provisional');
    expect(memo!.uses).toBe(1);
    expect(memo!.successes).toBe(0);
    expect(memo!.failures).toBe(1);
  });

  it('subsequent records increment counters', async () => {
    await store.record('pg-shape-2', SPLIT_DECISION, 'success');
    await store.record('pg-shape-2', SPLIT_DECISION, 'success');
    await store.record('pg-shape-2', SPLIT_DECISION, 'failure');
    const memo = await store.match('pg-shape-2');
    expect(memo!.uses).toBe(3);
    expect(memo!.successes).toBe(2);
    expect(memo!.failures).toBe(1);
  });

  it('decision payload survives roundtrip', async () => {
    await store.record('pg-shape-payload', SPLIT_DECISION, 'success');
    const memo = await store.match('pg-shape-payload');
    expect(memo!.decision).toEqual(SPLIT_DECISION);
  });

  it('promote sets status to trusted', async () => {
    await store.record('pg-promo', SPLIT_DECISION, 'success');
    await store.promote('pg-promo', 'trusted');
    const memo = await store.match('pg-promo');
    expect(memo!.status).toBe('trusted');
  });

  it('promote can lower back to provisional', async () => {
    await store.record('pg-demote', SPLIT_DECISION, 'success');
    await store.promote('pg-demote', 'trusted');
    await store.promote('pg-demote', 'provisional');
    const memo = await store.match('pg-demote');
    expect(memo!.status).toBe('provisional');
  });

  it('list returns all recorded memos', async () => {
    await store.record('pg-list-a', SPLIT_DECISION, 'success');
    await store.record('pg-list-b', SPLIT_DECISION, 'failure');
    const all = await store.list();
    expect(all).toHaveLength(2);
    const shapes = all.map((m) => m.shape).sort();
    expect(shapes).toEqual(['pg-list-a', 'pg-list-b']);
  });

  it('list returns empty array when table is empty', async () => {
    expect(await store.list()).toEqual([]);
  });
});
