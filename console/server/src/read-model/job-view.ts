/**
 * A job as the console shows it: the queue's lifecycle row (when the job came
 * through the queue) joined with what the event log says happened inside it.
 *
 * The row is authoritative for lifecycle (queued, parked, answered, cancelled,
 * which worker holds it); the log is authoritative for the run (tree, spend,
 * events). Jobs the queue never saw — single-process daemon runs, CLI runs —
 * are views of the log alone. A queued job has a row and no events yet.
 */

import type { JobBrief, JobRecord, JobState } from '../factory.js';
import type { JobSummary } from './job-index.js';

export type JobStatus = JobState;

export interface JobQueueView {
  repo: string;
  workerId: string | null;
  affinityWorkerId: string | null;
  attempts: number;
  brief: JobBrief | null;
  answer: string | null;
  detail: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface JobView {
  jobId: string;
  title: string;
  goalType: string;
  status: JobStatus;
  startedAt: number;
  lastEventAt: number;
  endedAt: number | null;
  eventCount: number;
  goalCount: number;
  costUsd: number | null;
  /** Newest event seq in this job; 0 before its first event. */
  lastSeq: number;
  /** The queue row, when the job came through the queue. */
  queue: JobQueueView | null;
}

export function jobView(summary: JobSummary | undefined, record: JobRecord | undefined): JobView | undefined {
  if (!summary && !record) return undefined;
  const queue: JobQueueView | null = record
    ? {
        repo: record.repo,
        workerId: record.workerId,
        affinityWorkerId: record.affinityWorkerId,
        attempts: record.attempts,
        brief: record.brief,
        answer: record.answer,
        detail: record.detail,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
      }
    : null;
  return {
    jobId: summary?.jobId ?? record!.id,
    title: summary?.title ?? record!.title,
    goalType: summary?.goalType ?? 'deliver-intent',
    status: record?.state ?? summary!.state,
    startedAt: summary?.startedAt ?? record!.createdAt,
    lastEventAt: Math.max(summary?.lastEventAt ?? 0, record?.updatedAt ?? 0),
    endedAt: summary?.endedAt ?? null,
    eventCount: summary?.eventCount ?? 0,
    goalCount: summary?.goalCount ?? 0,
    costUsd: summary?.costUsd ?? null,
    lastSeq: summary?.lastSeq ?? 0,
    queue,
  };
}
