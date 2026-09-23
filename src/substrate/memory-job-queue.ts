/**
 * The job queue in process memory: both sides of the jobs contract
 * (`JobQueue` and `WorkerLink`) over one map. It is the reference semantics
 * the Postgres implementations are tested against, and the queue for tests
 * and single-process development.
 */

import type { CommissionInput } from '../contract/brief.js';
import {
  JOB_LEASE_MS,
  MAX_JOB_ATTEMPTS,
  type ClaimedJob,
  type JobBrief,
  type JobCommandResult,
  type JobOutcome,
  type JobQueue,
  type JobRecord,
  type WorkerLink,
  type WorkerRecord,
} from '../contract/jobs.js';
import { scopesOverlap } from '../listener/scope-overlap.js';

export class MemoryJobQueue implements JobQueue, WorkerLink {
  readonly #jobs = new Map<string, JobRecord>();
  readonly #workers = new Map<string, WorkerRecord>();
  readonly #now: () => number;

  constructor(opts: { now?: () => number } = {}) {
    this.#now = opts.now ?? (() => Date.now());
  }

  // ── JobQueue ──────────────────────────────────────────────────────────────

  async enqueue(input: CommissionInput, repo: string): Promise<JobCommandResult> {
    if (this.#jobs.has(input.id)) return { ok: false, error: 'conflict', message: `job ${input.id} already exists` };
    const now = this.#now();
    const job: JobRecord = {
      id: input.id,
      repo,
      title: input.title,
      input: structuredClone(input),
      state: 'queued',
      createdAt: now,
      updatedAt: now,
      workerId: null,
      affinityWorkerId: null,
      leaseUntil: null,
      attempts: 0,
      brief: null,
      answer: null,
      detail: null,
    };
    this.#jobs.set(job.id, job);
    return { ok: true, job: structuredClone(job) };
  }

  async answer(jobId: string, answer: string): Promise<JobCommandResult> {
    const job = this.#jobs.get(jobId);
    if (!job) return { ok: false, error: 'not-found', message: `no job ${jobId}` };
    if (job.state !== 'parked') return { ok: false, error: 'conflict', message: `job ${jobId} is ${job.state}, not parked` };
    this.#update(job, { state: 'queued', answer });
    return { ok: true, job: structuredClone(job) };
  }

  async cancel(jobId: string): Promise<JobCommandResult> {
    const job = this.#jobs.get(jobId);
    if (!job) return { ok: false, error: 'not-found', message: `no job ${jobId}` };
    if (job.state !== 'queued') return { ok: false, error: 'conflict', message: `job ${jobId} is ${job.state}; only queued jobs cancel` };
    this.#update(job, { state: 'cancelled', detail: 'cancelled by the operator', affinityWorkerId: null });
    return { ok: true, job: structuredClone(job) };
  }

  async get(jobId: string): Promise<JobRecord | null> {
    const job = this.#jobs.get(jobId);
    return job ? structuredClone(job) : null;
  }

  async list(): Promise<JobRecord[]> {
    return [...this.#jobs.values()].sort((a, b) => a.createdAt - b.createdAt).map((j) => structuredClone(j));
  }

  async workers(): Promise<WorkerRecord[]> {
    return [...this.#workers.values()].map((w) => structuredClone(w));
  }

  // ── WorkerLink ────────────────────────────────────────────────────────────

  async register(worker: { id: string; repos: string[]; host: string }): Promise<void> {
    const now = this.#now();
    this.#workers.set(worker.id, { ...worker, repos: [...worker.repos], startedAt: now, lastSeenAt: now, currentJobId: null });
  }

  async deregister(workerId: string): Promise<void> {
    this.#workers.delete(workerId);
  }

  async heartbeat(workerId: string): Promise<void> {
    const now = this.#now();
    const worker = this.#workers.get(workerId);
    if (!worker) return;
    worker.lastSeenAt = now;
    const job = worker.currentJobId ? this.#jobs.get(worker.currentJobId) : undefined;
    if (job && job.state === 'running' && job.workerId === workerId) this.#update(job, { leaseUntil: now + JOB_LEASE_MS });
  }

  async claim(workerId: string, repos: string[]): Promise<ClaimedJob | null> {
    const now = this.#now();
    const lapsed = (j: JobRecord) => j.state === 'running' && j.leaseUntil !== null && j.leaseUntil < now;

    for (const j of this.#jobs.values()) {
      if (lapsed(j) && j.attempts >= MAX_JOB_ATTEMPTS) {
        this.#update(j, { state: 'failed', leaseUntil: null, detail: `lease lost after ${j.attempts} claims` });
      }
    }

    const running = [...this.#jobs.values()].filter((j) => j.state === 'running' && !lapsed(j));
    const candidates = [...this.#jobs.values()]
      .filter((j) => repos.includes(j.repo))
      .filter((j) => (j.state === 'queued' && (j.affinityWorkerId === null || j.affinityWorkerId === workerId)) || lapsed(j))
      .sort((a, b) => a.createdAt - b.createdAt);

    const job = candidates.find(
      (c) => !running.some((r) => r.repo === c.repo && scopesOverlap(r.input.scope, c.input.scope)),
    );
    if (!job) return null;

    const resume = job.brief && job.answer !== null ? { question: job.brief.question, answer: job.answer } : null;
    this.#update(job, {
      state: 'running',
      workerId,
      affinityWorkerId: null,
      leaseUntil: now + JOB_LEASE_MS,
      attempts: job.attempts + 1,
      brief: null,
      answer: null,
    });
    const worker = this.#workers.get(workerId);
    if (worker) worker.currentJobId = job.id;
    return { job: structuredClone(job), resume };
  }

  async park(jobId: string, workerId: string, brief: JobBrief): Promise<void> {
    const job = this.#held(jobId, workerId);
    if (!job) return;
    this.#update(job, { state: 'parked', brief, affinityWorkerId: workerId, leaseUntil: null });
    this.#release(workerId);
  }

  async finish(jobId: string, workerId: string, outcome: JobOutcome, detail?: string): Promise<void> {
    const job = this.#held(jobId, workerId);
    if (!job) return;
    this.#update(job, { state: outcome, leaseUntil: null, affinityWorkerId: null, detail: detail ?? null });
    this.#release(workerId);
  }

  async sweepExpiredParks(now: number): Promise<JobRecord[]> {
    const swept: JobRecord[] = [];
    for (const j of this.#jobs.values()) {
      if (j.state === 'parked' && j.brief && j.brief.deadline <= now) {
        this.#update(j, { state: 'blocked', affinityWorkerId: null, detail: 'brief unanswered past its deadline' });
        swept.push(structuredClone(j));
      }
    }
    return swept;
  }

  // ── internals ─────────────────────────────────────────────────────────────

  /** The job, if `workerId` still holds it; a worker whose lease lapsed does not. */
  #held(jobId: string, workerId: string): JobRecord | undefined {
    const job = this.#jobs.get(jobId);
    return job && job.state === 'running' && job.workerId === workerId ? job : undefined;
  }

  #release(workerId: string): void {
    const worker = this.#workers.get(workerId);
    if (worker) worker.currentJobId = null;
  }

  #update(job: JobRecord, patch: Partial<JobRecord>): void {
    Object.assign(job, patch, { updatedAt: this.#now() });
  }
}
