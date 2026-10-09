/**
 * Event sources against real storage. The Postgres suite needs a live
 * database and runs only when DATABASE_URL is set, like the factory's
 * tests/substrate/pg-stores.test.ts.
 */

import { mkdtempSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PgEventStore } from '../../../src/substrate/pg-event-store.js';
import { sampleRun } from '../src/factory.js';
import { JsonlEventSource } from '../src/events/jsonl-event-source.js';
import { PgEventSource } from '../src/events/pg-event-source.js';
import { isolatedPool } from './pg-schema.js';

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
  let pool: pg.Pool;
  let drop: () => Promise<void>;

  beforeAll(async () => {
    ({ pool, drop } = await isolatedPool(DB_URL!, 'src'));
    await new PgEventStore(pool).ensureSchema();
  });
  afterAll(async () => {
    await drop();
  });

  it('reads back what the factory store appended, in id order, from a cursor', async () => {
    const store = new PgEventStore(pool);
    const events = sampleRun({ jobId: 'pg-round-trip', title: 'pg round trip', startAt: 0 });
    for (const e of events) await store.append(e);

    const source = new PgEventSource(pool);
    const page = await source.after(0, 10_000);
    expect(page.map((s) => s.event)).toEqual(events);
    expect(page.every((s, i) => i === 0 || s.seq > page[i - 1]!.seq)).toBe(true);

    const tail = await source.after(page[4]!.seq, 2);
    expect(tail.map((s) => s.seq)).toEqual([page[5]!.seq, page[6]!.seq]);
  });
});
