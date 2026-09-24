import { afterEach, describe, expect, it } from 'vitest';

import { createApp } from '../src/api/app.js';
import { sampleRun } from '../src/factory.js';
import { MemoryEventSource } from '../src/events/event-source.js';
import { ReadModel } from '../src/read-model/read-model.js';

const TOKEN = 'test-token';
const auth = { authorization: `Bearer ${TOKEN}` };

async function setup(outcome: 'done' | 'running' = 'done') {
  const source = new MemoryEventSource(sampleRun({ jobId: 'job-1', title: 'Add a widget', startAt: 1_000, outcome }));
  const model = new ReadModel(source);
  await model.sync();
  return { source, model, app: createApp({ model, token: TOKEN }) };
}

/** Read SSE messages from a streaming response until `count` arrive. */
export async function readSse(res: Response, count: number): Promise<{ event: string; id?: string; data: string }[]> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  const messages: { event: string; id?: string; data: string }[] = [];
  let buf = '';
  while (messages.length < count) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let end: number;
    while ((end = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, end);
      buf = buf.slice(end + 2);
      const msg: { event: string; id?: string; data: string } = { event: 'message', data: '' };
      for (const line of block.split('\n')) {
        if (line.startsWith('event: ')) msg.event = line.slice(7);
        else if (line.startsWith('id: ')) msg.id = line.slice(4);
        else if (line.startsWith('data: ')) msg.data += line.slice(6);
      }
      if (block.startsWith(':')) continue;
      messages.push(msg);
    }
  }
  await reader.cancel();
  return messages;
}

const controllers: AbortController[] = [];
afterEach(() => {
  for (const c of controllers.splice(0)) c.abort();
});

describe('control plane API', () => {
  it('serves health and the OpenAPI document without a token', async () => {
    const { app } = await setup();
    expect((await app.request('/api/health')).status).toBe(200);
    const doc = (await (await app.request('/api/openapi.json')).json()) as { paths: Record<string, unknown> };
    expect(Object.keys(doc.paths)).toEqual(
      expect.arrayContaining(['/jobs', '/jobs/{jobId}', '/jobs/{jobId}/events', '/jobs/{jobId}/goals/{goalId}']),
    );
  });

  it('refuses job routes without the operator token', async () => {
    const { app } = await setup();
    expect((await app.request('/api/jobs')).status).toBe(401);
    expect((await app.request('/api/jobs', { headers: { authorization: 'Bearer wrong' } })).status).toBe(401);
    expect((await app.request('/api/stream')).status).toBe(401);
  });

  it('lists jobs and returns a job with its tree', async () => {
    const { app } = await setup();
    const list = (await (await app.request('/api/jobs', { headers: auth })).json()) as { jobs: { jobId: string; status: string }[] };
    expect(list.jobs).toMatchObject([{ jobId: 'job-1', status: 'done', queue: null }]);

    const one = (await (await app.request('/api/jobs/job-1', { headers: auth })).json()) as {
      tree: { children: { title: string }[] };
    };
    expect(one.tree.children.map((c) => c.title)).toEqual(['Contract and types', 'Core implementation', 'Tests and fixtures']);
    expect((await app.request('/api/jobs/nope', { headers: auth })).status).toBe(404);
  });

  it('pages events by cursor and validates the query', async () => {
    const { app } = await setup();
    const res = await app.request('/api/jobs/job-1/events?after=2&limit=2', { headers: auth });
    const body = (await res.json()) as { events: { seq: number }[] };
    expect(body.events.map((e) => e.seq)).toEqual([3, 4]);
    expect((await app.request('/api/jobs/job-1/events?limit=0', { headers: auth })).status).toBe(400);
  });

  it('returns one goal for the inspector', async () => {
    const { app } = await setup();
    const res = await app.request('/api/jobs/job-1/goals/job-1.1', { headers: auth });
    const body = (await res.json()) as { goal: { title: string }; usage: { costUsd: number }; events: unknown[] };
    expect(body.goal.title).toBe('Contract and types');
    expect(body.usage.costUsd).toBeGreaterThan(0);
    expect(body.events.length).toBeGreaterThan(3);
  });

  it('streams a job: replays from Last-Event-ID, then follows new events live', async () => {
    const { app, source, model } = await setup('running');
    const total = model.cursor;
    const ctrl = new AbortController();
    controllers.push(ctrl);
    const res = await app.request('/api/jobs/job-1/stream', {
      headers: { ...auth, 'last-event-id': String(total - 2) },
      signal: ctrl.signal,
    });
    expect(res.headers.get('content-type')).toContain('text/event-stream');

    const pending = readSse(res, 4);
    source.push({ type: 'transport-retry', at: 99_000, goalId: 'job-1.3', detail: 'provider 529' });
    await model.sync();
    const messages = await pending;

    expect(messages.map((m) => m.event)).toEqual(['event', 'event', 'caught-up', 'event']);
    expect(messages.filter((m) => m.event === 'event').map((m) => Number(m.id))).toEqual([total - 1, total, total + 1]);
    expect(JSON.parse(messages[2]!.data)).toEqual({ seq: total });
    expect(JSON.parse(messages[3]!.data)).toMatchObject({ seq: total + 1, event: { type: 'transport-retry' } });
  });

  it('streams job summaries for the dashboard', async () => {
    const { app, source, model } = await setup('running');
    const ctrl = new AbortController();
    controllers.push(ctrl);
    const res = await app.request('/api/stream', { headers: auth, signal: ctrl.signal });
    const pending = readSse(res, 2);
    source.push({ type: 'transport-retry', at: 99_000, goalId: 'job-1.3', detail: 'provider 529' });
    await model.sync();
    const [snapshot, update] = await pending;
    expect(snapshot!.event).toBe('snapshot');
    expect(JSON.parse(snapshot!.data)).toMatchObject({ jobs: [{ jobId: 'job-1' }], workers: [], repos: [] });
    expect(update!.event).toBe('job');
    expect(JSON.parse(update!.data)).toMatchObject({ jobId: 'job-1', lastEventAt: 99_000, lastSeq: model.cursor });
  });
});
