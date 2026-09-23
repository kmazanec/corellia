import { describe, expect, it } from 'vitest';

import type { CommissionInput } from '../../src/contract/brief.js';
import type { Engine } from '../../src/engine/engine.js';
import { WorkerLoop } from '../../src/daemon/worker-loop.js';
import { buildSimulatedEngine } from '../../src/dev/simulated-engine.js';
import { InMemoryEventStore } from '../../src/eventlog/memory-store.js';
import { Listener } from '../../src/listener/listener.js';
import { MemoryJobQueue } from '../../src/substrate/memory-job-queue.js';

const REPO = 'acme/widgets';

function commission(id: string, simulate?: string): CommissionInput {
  return {
    id,
    title: `Job ${id}`,
    spec: simulate ? { description: 'x', simulate } : { description: 'x' },
    scope: [`src/${id}`],
    budget: { attempts: 3, tokens: 1000, toolCalls: 10, wallClockMs: 60_000 },
  };
}

function setup(engine?: (store: InMemoryEventStore) => Engine, workerSleep: (ms: number) => Promise<void> = async () => {}) {
  let now = 1_000;
  const clock = () => now;
  const queue = new MemoryJobQueue({ now: clock });
  const store = new InMemoryEventStore();
  const listener = new Listener({
    engine: engine ? engine(store) : buildSimulatedEngine({ store, stepMs: 0, now: clock, sleep: async () => {} }),
    store,
    now: clock,
  });
  const lines: string[] = [];
  const worker = new WorkerLoop({
    id: 'w1',
    repos: [REPO],
    host: 'test',
    link: queue,
    listener,
    store,
    now: clock,
    pollMs: 1,
    sleep: workerSleep,
    log: (l) => lines.push(l),
  });
  return { queue, store, worker, lines, advance: (ms: number) => (now += ms) };
}

// Each test drives WorkerLoop.tick() by hand; the start/stop loop gets its own test.

describe('WorkerLoop', () => {
  it('claims a queued job and records it done', async () => {
    const { queue, store, worker } = setup();
    await queue.register({ id: 'w1', repos: [REPO], host: 'test' });
    await queue.enqueue(commission('j1'), REPO);

    expect(await worker.tick()).toBe('ran');
    expect(await queue.get('j1')).toMatchObject({ state: 'done', workerId: 'w1', attempts: 1 });
    expect((await store.list({ goalId: 'j1' })).map((e) => e.type)).toContain('emitted');
    expect((await queue.workers())[0]?.currentJobId).toBeNull();
    expect(await worker.tick()).toBe('idle');
  });

  it('hands a park to the queue, and resumes it on the same worker once answered', async () => {
    const { queue, store, worker } = setup();
    await queue.register({ id: 'w1', repos: [REPO], host: 'test' });
    await queue.enqueue(commission('p1', 'parked'), REPO);

    await worker.tick();
    const parked = await queue.get('p1');
    expect(parked).toMatchObject({ state: 'parked', affinityWorkerId: 'w1' });
    expect(parked?.brief?.question).toMatch(/public API/);
    expect(parked?.brief?.options).toEqual(['Keep the API', 'Break it and migrate callers']);
    expect(await worker.tick()).toBe('idle');

    await queue.answer('p1', 'Keep the API');
    expect(await worker.tick()).toBe('ran');
    expect(await queue.get('p1')).toMatchObject({ state: 'done', attempts: 2 });
    const resumed = (await store.list({ goalId: 'p1', type: 'resumed' }))[0];
    expect(resumed).toMatchObject({ answer: 'Keep the API' });
  });

  it('records blockers as a failed job', async () => {
    const { queue, worker } = setup();
    await queue.enqueue(commission('f1', 'failed'), REPO);
    await queue.register({ id: 'w1', repos: [REPO], host: 'test' });
    await worker.tick();
    expect(await queue.get('f1')).toMatchObject({ state: 'failed', detail: 'module 3 blocked' });
  });

  it('records a run that throws as failed with its message', async () => {
    const { queue, worker } = setup(() => ({ run: () => Promise.reject(new Error('provider exploded')) }) as unknown as Engine);
    await queue.enqueue(commission('e1'), REPO);
    await queue.register({ id: 'w1', repos: [REPO], host: 'test' });
    await worker.tick();
    expect(await queue.get('e1')).toMatchObject({ state: 'failed', detail: 'provider exploded' });
  });

  it('bounces a park nobody answered, and logs the bounce', async () => {
    const { queue, store, worker, advance } = setup();
    await queue.enqueue(commission('b1', 'parked'), REPO);
    await queue.register({ id: 'w1', repos: [REPO], host: 'test' });
    await worker.tick();
    const deadline = (await queue.get('b1'))!.brief!.deadline;
    advance(deadline);
    await worker.tick();
    expect(await queue.get('b1')).toMatchObject({ state: 'blocked' });
    const bounce = (await store.list({ goalId: 'b1', type: 'blocked' })).at(-1);
    expect(bounce).toMatchObject({ resolution: 'bounce' });
  });

  it('marks the job in hand interrupted when the worker leaves', async () => {
    let release!: () => void;
    const hold = new Promise<void>((r) => (release = r));
    const { queue, worker } = setup(
      () =>
        ({
          run: async () => {
            await hold;
            return { artifact: null, proof: [], lessons: [], memoriesUsed: [], blockers: [], findings: [], learned: '' };
          },
        }) as unknown as Engine,
    );
    await queue.enqueue(commission('i1'), REPO);
    await queue.register({ id: 'w1', repos: [REPO], host: 'test' });
    const running = worker.tick();
    await new Promise((r) => setTimeout(r, 0));
    expect(worker.current?.id).toBe('i1');

    await worker.leave('worker shut down; worktree preserved');
    expect(await queue.get('i1')).toMatchObject({ state: 'interrupted', detail: 'worker shut down; worktree preserved' });
    expect(await queue.workers()).toEqual([]);
    release();
    await running;
    expect((await queue.get('i1'))?.state).toBe('interrupted');
  });

  it('runs the loop until stopped', async () => {
    const { queue, worker, lines } = setup(undefined, (ms) => new Promise((r) => setTimeout(r, ms)));
    await queue.enqueue(commission('l1'), REPO);
    await worker.start();
    for (let i = 0; i < 50 && (await queue.get('l1'))?.state !== 'done'; i++) await new Promise((r) => setTimeout(r, 1));
    await worker.stop();
    expect((await queue.get('l1'))?.state).toBe('done');
    expect(lines[0]).toBe(`registered for ${REPO}`);
  });
});
