import { describe, expect, it } from 'vitest';

import { createApp } from '../src/api/app.js';
import { MemoryEventSource } from '../src/events/event-source.js';
import { MemoryJobQueue, sampleRun } from '../src/factory.js';
import { ReadModel } from '../src/read-model/read-model.js';

const TOKEN = 't';
const headers = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' };
const REPO = 'acme/widgets';

async function setup() {
  let now = 50_000;
  const queue = new MemoryJobQueue({ now: () => now });
  const source = new MemoryEventSource();
  const model = new ReadModel(source, queue);
  await queue.register({ id: 'w1', repos: [REPO], host: 'box-1' });
  await model.sync();
  const app = createApp({ model, token: TOKEN, queue, now: () => now });
  const post = (path: string, body?: unknown) =>
    app.request(path, { method: 'POST', headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { queue, source, model, app, post, advance: (ms: number) => (now += ms) };
}

const request = { title: 'Add rate limiting', repo: REPO, description: 'Throttle the webhook ingress', scope: ['src/daemon'] };

describe('control plane commands', () => {
  it('commissions a job into the queue and shows it queued before any event', async () => {
    const { post, queue, app } = await setup();
    const res = await post('/api/jobs', { ...request, constraints: ['open a PR'], spendCeilingUsd: 5 });
    expect(res.status).toBe(201);
    const { job } = (await res.json()) as { job: { jobId: string; status: string; eventCount: number; queue: { repo: string } } };
    expect(job).toMatchObject({ status: 'queued', eventCount: 0, title: 'Add rate limiting', queue: { repo: REPO } });
    expect(job.jobId).toMatch(/^add-rate-limiting-[0-9a-f]{6}$/);

    const stored = await queue.get(job.jobId);
    expect(stored?.input).toMatchObject({
      title: 'Add rate limiting',
      scope: ['src/daemon'],
      intent: 'production',
      spendCeilingUsd: 5,
      spec: { description: 'Throttle the webhook ingress', constraints: ['open a PR'] },
      budget: { attempts: 3 },
    });
    const one = (await (await app.request(`/api/jobs/${job.jobId}`, { headers })).json()) as { tree: unknown };
    expect(one.tree).toBeNull();
  });

  it('validates the request and refuses repos no worker serves or ids already taken', async () => {
    const { post } = await setup();
    expect((await post('/api/jobs', { ...request, title: '' })).status).toBe(400);
    expect((await post('/api/jobs', { ...request, id: 'Bad Id' })).status).toBe(400);
    expect((await post('/api/jobs', { ...request, repo: 'nobody/serves-this' })).status).toBe(422);
    expect((await post('/api/jobs', { ...request, id: 'fixed-id' })).status).toBe(201);
    expect((await post('/api/jobs', { ...request, id: 'fixed-id' })).status).toBe(409);
  });

  it('answers a parked job, which re-queues for the worker holding it', async () => {
    const { post, queue } = await setup();
    await post('/api/jobs', { ...request, id: 'parky' });
    await queue.claim('w1', [REPO]);
    await queue.park('parky', 'w1', { question: 'Keep the API?', options: ['yes', 'no'], deadline: 9e12 });

    expect((await post('/api/jobs/parky/answer', { answer: '' })).status).toBe(400);
    const res = await post('/api/jobs/parky/answer', { answer: 'yes' });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { job: unknown }).job).toMatchObject({
      status: 'queued',
      queue: { answer: 'yes', affinityWorkerId: 'w1', brief: { question: 'Keep the API?' } },
    });
    expect((await post('/api/jobs/parky/answer', { answer: 'again' })).status).toBe(409);
    expect((await post('/api/jobs/missing/answer', { answer: 'x' })).status).toBe(404);
  });

  it('cancels only a job no worker has taken', async () => {
    const { post, queue } = await setup();
    await post('/api/jobs', { ...request, id: 'cancel-one' });
    await post('/api/jobs', { ...request, id: 'cancel-two', scope: ['src/other'] });
    await queue.claim('w1', [REPO]);
    expect((await post('/api/jobs/cancel-one/cancel')).status).toBe(409);
    const res = await post('/api/jobs/cancel-two/cancel');
    expect(((await res.json()) as { job: unknown }).job).toMatchObject({ status: 'cancelled', queue: { detail: 'cancelled by the operator' } });
  });

  it('joins a job row with its events: the row decides status, the log the run', async () => {
    const { post, queue, source, model, app } = await setup();
    await post('/api/jobs', { ...request, id: 'joined' });
    await queue.claim('w1', [REPO]);
    for (const e of sampleRun({ jobId: 'joined', title: 'Add rate limiting', startAt: 1, outcome: 'running' })) source.push(e);
    await model.sync();
    const { job } = (await (await app.request('/api/jobs/joined', { headers })).json()) as { job: Record<string, unknown> };
    expect(job).toMatchObject({ status: 'running', queue: { workerId: 'w1' }, goalCount: 4 });
    expect(job['eventCount']).toBeGreaterThan(10);
    expect((job['costUsd'] as number) > 0).toBe(true);
  });

  it('lists the fleet and the repos it serves, marking stale workers', async () => {
    const { app, queue, model, advance } = await setup();
    await queue.register({ id: 'w2', repos: [REPO, 'acme/docs'], host: 'box-2' });
    await model.sync();
    advance(61_000);
    await queue.heartbeat('w2');
    await model.sync();
    const { workers } = (await (await app.request('/api/workers', { headers })).json()) as { workers: { id: string; alive: boolean }[] };
    expect(workers.map((w) => [w.id, w.alive])).toEqual([
      ['w1', false],
      ['w2', true],
    ]);
    const { repos } = (await (await app.request('/api/repos', { headers })).json()) as { repos: unknown[] };
    expect(repos).toEqual([
      { repo: 'acme/docs', workers: 1, alive: 1, busy: 0 },
      { repo: REPO, workers: 2, alive: 1, busy: 0 },
    ]);
    expect((await app.request('/api/workers')).status).toBe(401);
  });

  it('answers 503 for commands when the control plane has no queue', async () => {
    const model = new ReadModel(new MemoryEventSource());
    const app = createApp({ model, token: TOKEN });
    const res = await app.request('/api/jobs', { method: 'POST', headers, body: JSON.stringify(request) });
    expect(res.status).toBe(503);
  });
});
