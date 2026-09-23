/**
 * Event sources against real storage. The Postgres suite needs a live
 * database and runs only when DATABASE_URL is set, like the factory's
 * tests/substrate/pg-stores.test.ts.
 */

import { mkdtempSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PgEventStore } from '../../../src/substrate/pg-event-store.js';
import { sampleRun } from '../src/dev/sample-run.js';
import { JsonlEventSource } from '../src/events/jsonl-event-source.js';
import { PgEventSource } from '../src/events/pg-event-source.js';

describe('JsonlEventSource', () => {
  const dir = mkdtempSync(join(tmpdir(), 'console-jsonl-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('reads by line cursor, skips bad lines, and sees appends', async () => {
    const path = join(dir, 'events.jsonl');
    const events = sampleRun({ jobId: 'j', title: 'J', startAt: 0 });
    writeFileSync(path, [JSON.stringify(events[0]), 'not json', JSON.stringify(events[1])].join('\n') + '\n');
    const source = new JsonlEventSource(path);

    const first = await source.after(0, 10);
    expect(first.map((s) => s.seq)).toEqual([1, 3]);

    appendFileSync(path, JSON.stringify(events[2]) + '\n');
    expect((await source.after(3, 10)).map((s) => s.event.type)).toEqual([events[2]!.type]);
    expect(await new JsonlEventSource(join(dir, 'missing.jsonl')).after(0, 10)).toEqual([]);
  });
});

const DB_URL = process.env['DATABASE_URL'];

describe.skipIf(!DB_URL)('PgEventSource (integration)', () => {
  const pool = new pg.Pool({ connectionString: DB_URL });
  const store = new PgEventStore(pool);
  const jobId = `console-it-${Date.now()}`;
  let before = 0;

  beforeAll(async () => {
    await store.ensureSchema();
    const { rows } = await pool.query<{ max: string | null }>('SELECT max(id) AS max FROM corellia_events');
    before = Number(rows[0]?.max ?? 0);
  });
  afterAll(async () => {
    await pool.query('DELETE FROM corellia_events WHERE goal_id LIKE $1', [`${jobId}%`]);
    await pool.end();
  });

  it('reads back what the factory store appended, in id order, from a cursor', async () => {
    const events = sampleRun({ jobId, title: 'pg round trip', startAt: 0 });
    for (const e of events) await store.append(e);

    const source = new PgEventSource(DB_URL!);
    try {
      const page = await source.after(before, 10_000);
      const mine = page.filter((s) => s.event.goalId.startsWith(jobId));
      expect(mine.map((s) => s.event)).toEqual(events);
      expect(mine.every((s, i) => i === 0 || s.seq > mine[i - 1]!.seq)).toBe(true);

      const tail = await source.after(mine[4]!.seq, 2);
      expect(tail.map((s) => s.seq)).toEqual([mine[5]!.seq, mine[6]!.seq]);
    } finally {
      await source.close();
    }
  });
});
