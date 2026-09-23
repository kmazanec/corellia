/**
 * The jobs contract (ADR-051): how commissions queue, how workers claim and
 * run them, and how parked jobs wait for an operator.
 *
 * A job is one commission run as one goal tree. Its id is the commission id,
 * which is also the tree's root goal id, so the job row and the event log join
 * on it. The job row holds lifecycle state only; everything that happened
 * inside the run lives in the event log (ADR-003).
 *
 * Two sides meet here:
 * - {@link JobQueue}: the control plane commissions, answers, and cancels jobs.
 * - {@link WorkerLink}: a worker registers, claims one job at a time, keeps its
 *   lease alive, and reports a park or a finish.
 *
 * Both can be implemented over any store. The factory ships an in-memory one
 * (tests, single process) and a Postgres one; the control plane implements
 * {@link JobQueue} over the same tables with its own client.
 */

import type { CommissionInput } from './brief.js';

/**
 * Where a job is in its life.
 *
 * - `queued`      — waiting for a worker (new, or answered and waiting to resume).
 * - `running`     — a worker holds it under a lease.
 * - `parked`      — waiting on an operator answer to a decision brief.
 * - `done`        — finished clean.
 * - `failed`      — finished with blockers, or the run threw.
 * - `blocked`     — a parked brief went unanswered past its deadline (bounced).
 * - `interrupted` — the worker shut down mid-run and preserved its worktree.
 * - `cancelled`   — withdrawn by the operator before a worker took it.
 */
export type JobState = 'queued' | 'running' | 'parked' | 'done' | 'failed' | 'blocked' | 'interrupted' | 'cancelled';

export const TERMINAL_JOB_STATES: readonly JobState[] = ['done', 'failed', 'blocked', 'interrupted', 'cancelled'];

/** The question a parked job is waiting on. */
export interface JobBrief {
  question: string;
  options: string[];
  /** Wall-clock ms after which the park is swept to `blocked`. */
  deadline: number;
}

export interface JobRecord {
  /** The commission id: also the root goal id in the event log. */
  id: string;
  /** Which repository the job targets; only workers serving it may claim it. */
  repo: string;
  title: string;
  input: CommissionInput;
  state: JobState;
  createdAt: number;
  updatedAt: number;
  /** The worker holding (or that last held) the job. */
  workerId: string | null;
  /**
   * The worker a parked job must resume on, because its worktree is on that
   * worker's disk (ADR-051 § Parked jobs). Null for jobs any worker may take.
   */
  affinityWorkerId: string | null;
  /** Lease expiry while running; a lapsed lease makes the job claimable again. */
  leaseUntil: number | null;
  /** How many times a worker has claimed it. */
  attempts: number;
  brief: JobBrief | null;
  /** The operator's answer to {@link brief}, waiting to be resumed with. */
  answer: string | null;
  /** A one-line reason for a terminal state other than `done`. */
  detail: string | null;
}

export interface WorkerRecord {
  id: string;
  /** Repositories this worker can run jobs for. */
  repos: string[];
  host: string;
  startedAt: number;
  lastSeenAt: number;
  currentJobId: string | null;
}

/** A job handed to a worker. `resume` is set when it is picking up an answered park. */
export interface ClaimedJob {
  job: JobRecord;
  resume: { question: string; answer: string } | null;
}

export type JobOutcome = 'done' | 'failed' | 'interrupted';

/** The worker's side of the queue. One job at a time per worker. */
export interface WorkerLink {
  register(worker: { id: string; repos: string[]; host: string }): Promise<void>;
  deregister(workerId: string): Promise<void>;
  /** Mark the worker alive and extend the lease on the job it holds, if any. */
  heartbeat(workerId: string): Promise<void>;
  /**
   * Take the oldest claimable job for one of `repos`, or null. Claimable: queued
   * (and, if it has an affinity, for this worker), or running with a lapsed
   * lease. A job whose scope overlaps a job already running on the same repo is
   * skipped, so two workers never edit the same paths at once.
   */
  claim(workerId: string, repos: string[]): Promise<ClaimedJob | null>;
  /** Record that the held job parked on `brief`. The worker is free again. */
  park(jobId: string, workerId: string, brief: JobBrief): Promise<void>;
  /** Record that the held job finished. The worker is free again. */
  finish(jobId: string, workerId: string, outcome: JobOutcome, detail?: string): Promise<void>;
  /** Move parked jobs past their deadline to `blocked`; returns the jobs moved. */
  sweepExpiredParks(now: number): Promise<JobRecord[]>;
}

export type JobCommandError = 'not-found' | 'conflict';

export type JobCommandResult = { ok: true; job: JobRecord } | { ok: false; error: JobCommandError; message: string };

/** The control plane's side of the queue. */
export interface JobQueue {
  /** Queue a new job. Fails with `conflict` when the id is already taken. */
  enqueue(input: CommissionInput, repo: string): Promise<JobCommandResult>;
  /** Answer a parked job; it re-queues for its affinity worker. */
  answer(jobId: string, answer: string): Promise<JobCommandResult>;
  /** Withdraw a job no worker has taken yet. */
  cancel(jobId: string): Promise<JobCommandResult>;
  get(jobId: string): Promise<JobRecord | null>;
  list(): Promise<JobRecord[]>;
  workers(): Promise<WorkerRecord[]>;
}

/** Lease length and claim cap shared by every implementation. */
export const JOB_LEASE_MS = 60_000;
export const MAX_JOB_ATTEMPTS = 3;
