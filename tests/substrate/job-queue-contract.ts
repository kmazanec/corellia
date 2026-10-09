/**
 * The behaviour every job-queue implementation must share (ADR-051). Each
 * implementation's test file calls {@link describeJobQueueContract} with a
 * factory; the memory queue is the reference, the Postgres queues must match it.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { CommissionInput } from '../../src/contract/brief.js';
import { JOB_LEASE_MS, MAX_JOB_ATTEMPTS, type JobQueue, type WorkerLink } from '../../src/contract/jobs.js';

export interface QueueHarness {
  queue: JobQueue;
  link: WorkerLink;
  /** Set the wall clock both sides read. */
  setNow(ms: number): void;
  close(): Promise<void>;
}

let seq = 0;
/** A commission with a unique id, so suites can share one database. */
export function commission(scope: string[], title = 'job'): CommissionInput {
  seq += 1;
  return {
    id: `jq-${process.pid}-${Date.now().toString(36)}-${seq}`,
    title,
    spec: { description: title },
    scope,
    budget: { attempts: 3, tokens: 1000, toolCalls: 10, wallClockMs: 60_000 },
  };
}

export function describeJobQueueContract(name: string, make: () => Promise<QueueHarness>, opts: { skip?: boolean } = {}): void {
  describe.skipIf(opts.skip ?? false)(`job queue contract: ${name}`, () => {
    let h: QueueHarness;
    let t: number;
    const repo = () => `repo-${seq}-${t}`;
    let R: string;
    const at = (ms: number) => {
      t = ms;
      h.setNow(ms);
    };

    beforeEach(async () => {
      h = await make();
      at(1_000_000);
      R = repo();
      await h.link.register({ id: `w1-${R}`, repos: [R], host: 'h1' });
      await h.link.register({ id: `w2-${R}`, repos: [R], host: 'h2' });
    });
    afterEach(async () => {
      await h.close();
    });

    const w1 = () => `w1-${R}`;
    const w2 = () => `w2-${R}`;

    it('queues a job once and refuses a duplicate id', async () => {
      const c = commission(['src/a']);
      const first = await h.queue.enqueue(c, R);
      expect(first).toMatchObject({ ok: true, job: { id: c.id, state: 'queued', repo: R, attempts: 0 } });
      expect(await h.queue.enqueue(c, R)).toMatchObject({ ok: false, error: 'conflict' });
      expect((await h.queue.get(c.id))?.input).toEqual(c);
    });

    it('hands out the oldest job for a served repo only', async () => {
      const a = commission(['src/a']);
      at(t + 1);
      const b = commission(['src/b']);
      await h.queue.enqueue(a, R);
      at(t + 1);
      await h.queue.enqueue(b, R);
      await h.queue.enqueue(commission(['src/c']), `${R}-other`);

      const claimed = await h.link.claim(w1(), [R]);
      expect(claimed).toMatchObject({ job: { id: a.id, state: 'running', workerId: w1(), attempts: 1 }, resume: null });
      expect(claimed!.job.leaseUntil).toBe(t + JOB_LEASE_MS);
      expect((await h.queue.workers()).find((w) => w.id === w1())?.currentJobId).toBe(a.id);
    });

    it('skips a job whose scope overlaps one already running on the same repo', async () => {
      const a = commission(['src/a']);
      const overlapping = commission(['src/a/deep']);
      const disjoint = commission(['src/b']);
      for (const c of [a, overlapping, disjoint]) {
        at(t + 1);
        await h.queue.enqueue(c, R);
      }
      expect((await h.link.claim(w1(), [R]))?.job.id).toBe(a.id);
      expect((await h.link.claim(w2(), [R]))?.job.id).toBe(disjoint.id);
      await h.link.finish(a.id, w1(), 'done');
      expect((await h.link.claim(w1(), [R]))?.job.id).toBe(overlapping.id);
    });

    it('parks, takes an answer, and resumes only on the worker holding the worktree', async () => {
      const c = commission(['src/p']);
      await h.queue.enqueue(c, R);
      await h.link.claim(w1(), [R]);
      const brief = { question: 'Keep the API?', options: ['yes', 'no'], deadline: t + 10_000 };
      await h.link.park(c.id, w1(), brief);
      expect(await h.queue.get(c.id)).toMatchObject({ state: 'parked', brief, affinityWorkerId: w1() });
      expect(await h.link.claim(w1(), [R])).toBeNull();

      expect(await h.queue.answer(c.id, 'yes')).toMatchObject({ ok: true, job: { state: 'queued', answer: 'yes' } });
      expect(await h.link.claim(w2(), [R])).toBeNull();
      const resumed = await h.link.claim(w1(), [R]);
      expect(resumed).toMatchObject({ job: { id: c.id, state: 'running', attempts: 2 }, resume: { question: 'Keep the API?', answer: 'yes' } });
      expect(resumed!.job.brief).toBeNull();
      expect(resumed!.job.answer).toBeNull();
    });

    it('lets any worker resume an answered park once its holder has left or gone silent', async () => {
      const left = commission(['src/left']);
      const silent = commission(['src/silent']);
      for (const c of [left, silent]) {
        at(t + 1);
        await h.queue.enqueue(c, R);
        expect((await h.link.claim(w1(), [R]))?.job.id).toBe(c.id);
        await h.link.park(c.id, w1(), { question: 'q?', options: [], deadline: t + 10 * JOB_LEASE_MS });
      }
      for (const c of [left, silent]) await h.queue.answer(c.id, 'a');
      await h.link.register({ id: `w3-${R}`, repos: [R], host: 'h3' });
      expect(await h.link.claim(`w3-${R}`, [R])).toBeNull();

      at(t + JOB_LEASE_MS + 1);
      await h.link.heartbeat(`w3-${R}`);
      const first = await h.link.claim(`w3-${R}`, [R]);
      expect(first).toMatchObject({ job: { id: left.id }, resume: { question: 'q?', answer: 'a' } });

      await h.link.heartbeat(w1());
      await h.link.finish(left.id, `w3-${R}`, 'done');
      expect(await h.link.claim(`w3-${R}`, [R])).toBeNull();
      await h.link.deregister(w1());
      expect((await h.link.claim(`w3-${R}`, [R]))?.job.id).toBe(silent.id);
    });

    it('refuses answers and cancels that do not fit the state', async () => {
      const c = commission(['src/x']);
      expect(await h.queue.answer('missing-job', 'x')).toMatchObject({ ok: false, error: 'not-found' });
      await h.queue.enqueue(c, R);
      expect(await h.queue.answer(c.id, 'x')).toMatchObject({ ok: false, error: 'conflict' });
      await h.link.claim(w1(), [R]);
      expect(await h.queue.cancel(c.id)).toMatchObject({ ok: false, error: 'conflict' });

      const d = commission(['src/y']);
      await h.queue.enqueue(d, R);
      expect(await h.queue.cancel(d.id)).toMatchObject({ ok: true, job: { state: 'cancelled' } });
      expect(await h.link.claim(w2(), [R])).toBeNull();
    });

    it('records a finish from the holder and ignores one from a worker that lost the lease', async () => {
      const c = commission(['src/f']);
      await h.queue.enqueue(c, R);
      await h.link.claim(w1(), [R]);
      await h.link.finish(c.id, w2(), 'done');
      expect((await h.queue.get(c.id))?.state).toBe('running');
      await h.link.finish(c.id, w1(), 'failed', 'typecheck failed');
      expect(await h.queue.get(c.id)).toMatchObject({ state: 'failed', detail: 'typecheck failed', leaseUntil: null });
      expect((await h.queue.workers()).find((w) => w.id === w1())?.currentJobId).toBeNull();
    });

    it('extends the lease on heartbeat and reclaims a lapsed one, up to the attempt cap', async () => {
      const c = commission(['src/l']);
      await h.queue.enqueue(c, R);
      await h.link.claim(w1(), [R]);
      at(t + JOB_LEASE_MS - 1);
      await h.link.heartbeat(w1());
      expect((await h.queue.get(c.id))?.leaseUntil).toBe(t + JOB_LEASE_MS);
      expect(await h.link.claim(w2(), [R])).toBeNull();

      for (let n = 2; n <= MAX_JOB_ATTEMPTS; n++) {
        at(t + JOB_LEASE_MS + 1);
        const again = await h.link.claim(w2(), [R]);
        expect(again).toMatchObject({ job: { id: c.id, workerId: w2(), attempts: n } });
      }
      at(t + JOB_LEASE_MS + 1);
      expect(await h.link.claim(w2(), [R])).toBeNull();
      expect(await h.queue.get(c.id)).toMatchObject({ state: 'failed', detail: `lease lost after ${MAX_JOB_ATTEMPTS} claims` });
    });

    it('sweeps parks past their deadline to blocked', async () => {
      const c = commission(['src/s']);
      await h.queue.enqueue(c, R);
      await h.link.claim(w1(), [R]);
      await h.link.park(c.id, w1(), { question: 'q', options: [], deadline: t + 100 });
      expect(await h.link.sweepExpiredParks(t + 99)).toEqual([]);
      const swept = await h.link.sweepExpiredParks(t + 100);
      expect(swept.map((j) => j.id)).toContain(c.id);
      expect(await h.queue.get(c.id)).toMatchObject({ state: 'blocked', affinityWorkerId: null });
    });

    it('forgets a deregistered worker', async () => {
      await h.link.deregister(w2());
      expect((await h.queue.workers()).map((w) => w.id)).not.toContain(w2());
    });
  });
}
