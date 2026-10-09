/**
 * The production pairing — the factory's PgWorkerLink (raw pg) and the control
 * plane's PgJobQueue (Drizzle) over one database — held to the same job-queue
 * contract as the in-memory reference. Needs DATABASE_URL.
 */

import { describe, expect, it } from 'vitest';

import { commission, describeJobQueueContract } from '../../../tests/substrate/job-queue-contract.js';
import { ensureJobSchema, PgWorkerLink } from '../src/factory.js';
import { PgJobQueue } from '../src/jobs/pg-job-queue.js';
import { isolatedPool } from './pg-schema.js';

const DB_URL = process.env['DATABASE_URL'];

describeJobQueueContract(
  'postgres (PgWorkerLink + Drizzle PgJobQueue)',
  async () => {
    const { pool, drop } = await isolatedPool(DB_URL!, 'jq');
    await ensureJobSchema(pool);
    let now = 0;
    const clock = { now: () => now };
    return {
      queue: new PgJobQueue(pool, clock),
      link: new PgWorkerLink(pool, clock),
      setNow: (ms) => {
        now = ms;
      },
      close: drop,
    };
  },
  { skip: !DB_URL },
);

describe.skipIf(!DB_URL)('postgres claim under concurrency', () => {
  it('never lets two workers hold overlapping scopes, however the claims race', async () => {
    const { pool, drop } = await isolatedPool(DB_URL!, 'race', 12);
    await ensureJobSchema(pool);
    const repo = `repo-race-${Date.now()}`;
    const queue = new PgJobQueue(pool);
    const links = Array.from({ length: 8 }, () => new PgWorkerLink(pool));
    try {
      for (let i = 0; i < 6; i++) await queue.enqueue(commission(['src/shared']), repo);
      await queue.enqueue(commission(['src/elsewhere']), repo);
      for (let i = 0; i < links.length; i++) await links[i]!.register({ id: `w${i}-${repo}`, repos: [repo], host: 'h' });

      const claims = await Promise.all(links.map((l, i) => l.claim(`w${i}-${repo}`, [repo])));
      const won = claims.filter((c) => c !== null).map((c) => c!.job.input.scope[0]);
      expect(won.sort()).toEqual(['src/elsewhere', 'src/shared']);
    } finally {
      await drop();
    }
  });
});
