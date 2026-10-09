/**
 * The whole Phase 2 loop on Postgres, in-process: an operator commissions over
 * the control plane's HTTP API, a worker claims and runs the job (simulated
 * engine, real listener, real stores), the job parks, the operator answers over
 * HTTP, the same worker resumes it, and it finishes. Needs DATABASE_URL.
 */

import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { WorkerLoop } from '../../../src/daemon/worker-loop.js';
import { buildSimulatedEngine } from '../../../src/dev/simulated-engine.js';
import { Listener } from '../../../src/listener/listener.js';
import { createApp } from '../src/api/app.js';
import { PgEventSource } from '../src/events/pg-event-source.js';
import { ensureJobSchema, PgEventStore, PgWorkerLink } from '../src/factory.js';
import { PgJobQueue } from '../src/jobs/pg-job-queue.js';
import { ReadModel } from '../src/read-model/read-model.js';
import { isolatedPool } from './pg-schema.js';

const DB_URL = process.env['DATABASE_URL'];

describe.skipIf(!DB_URL)('fleet end to end (postgres)', () => {
  const run = Date.now().toString(36);
  const repo = `repo-e2e-${run}`;
  const workerId = `w-e2e-${run}`;
  const jobIdPrefix = `e2e-${run}`;
  let pool: pg.Pool;
  let drop: () => Promise<void>;
  let model: ReadModel;
  let app: ReturnType<typeof createApp>;
  let worker: WorkerLoop;
  const headers = { authorization: 'Bearer t', 'content-type': 'application/json' };

  beforeAll(async () => {
    ({ pool, drop } = await isolatedPool(DB_URL!, 'e2e'));
    const store = new PgEventStore(pool);
    await store.ensureSchema();
    await ensureJobSchema(pool);

    const queue = new PgJobQueue(pool);
    model = new ReadModel(new PgEventSource(pool), queue);
    app = createApp({ model, token: 't', queue });

    const link = new PgWorkerLink(pool);
    const listener = new Listener({ engine: buildSimulatedEngine({ store, stepMs: 0, sleep: async () => {} }), store });
    worker = new WorkerLoop({ id: workerId, repos: [repo], host: 'e2e', link, listener, store, stamp: store, log: () => {} });
    await link.register({ id: workerId, repos: [repo], host: 'e2e' });
    await model.sync();
  });

  afterAll(async () => {
    await drop();
  });

  const getJob = async (id: string) => {
    await model.sync();
    return (await (await app.request(`/api/jobs/${id}`, { headers })).json()) as {
      job: { status: string; eventCount: number; queue: { brief: { question: string } | null; workerId: string | null } };
      tree: { state: string } | null;
    };
  };

  it('commissions, parks, takes an answer, resumes on the same worker, and finishes', async () => {
    const id = `${jobIdPrefix}-widget`;
    const commissioned = await app.request('/api/jobs', {
      method: 'POST',
      headers,
      body: JSON.stringify({ id, title: 'Widget pipeline', repo, description: 'Build it', scope: ['src/widget'], simulate: 'parked' }),
    });
    expect(commissioned.status).toBe(201);
    expect((await getJob(id)).job.status).toBe('queued');

    expect(await worker.tick()).toBe('ran');
    const parked = await getJob(id);
    expect(parked.job).toMatchObject({ status: 'parked', queue: { workerId } });
    expect(parked.job.queue.brief?.question).toMatch(/public API/);
    expect(parked.tree?.state).toBe('parked');
    expect(parked.job.eventCount).toBeGreaterThan(10);

    const stamped = await pool.query<{ n: string }>('SELECT count(*) AS n FROM corellia_events WHERE job_id = $1 AND worker_id = $2', [id, workerId]);
    expect(Number(stamped.rows[0]!.n)).toBe(parked.job.eventCount);

    const answered = await app.request(`/api/jobs/${id}/answer`, { method: 'POST', headers, body: JSON.stringify({ answer: 'Keep the API' }) });
    expect(answered.status).toBe(200);
    expect((await getJob(id)).job.status).toBe('queued');

    expect(await worker.tick()).toBe('ran');
    const done = await getJob(id);
    expect(done.job.status).toBe('done');
    expect(done.tree?.state).toBe('done');
    const resumed = await pool.query("SELECT payload FROM corellia_events WHERE job_id = $1 AND type = 'resumed'", [id]);
    expect(resumed.rows[0]?.payload).toMatchObject({ answer: 'Keep the API' });
  });
});
