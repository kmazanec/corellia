/**
 * Operator commands, as mutations through the typed client. Each response is
 * the job's new view, written straight into the job-list cache.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';

import type { Job } from '../factory';
import { api } from './client';
import { upsertJob } from './live';

export type CommissionRequest = Parameters<typeof api.jobs.$post>[0]['json'];

/** Read a command response: the job on success, the server's own message on refusal. */
async function jobOrError(res: Response): Promise<Job> {
  const body = (await res.json()) as { job?: Job; error?: string };
  if (!res.ok || !body.job) throw new Error(body.error ?? `control plane answered ${res.status}`);
  return body.job;
}

export function useCommission() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (req: CommissionRequest) => jobOrError(await api.jobs.$post({ json: req })),
    onSuccess: (job) => upsertJob(queryClient, job),
  });
}

export function useAnswer(jobId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (answer: string) => jobOrError(await api.jobs[':jobId'].answer.$post({ param: { jobId }, json: { answer } })),
    onSuccess: (job) => upsertJob(queryClient, job),
  });
}

export function useCancel(jobId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => jobOrError(await api.jobs[':jobId'].cancel.$post({ param: { jobId } })),
    onSuccess: (job) => upsertJob(queryClient, job),
  });
}
