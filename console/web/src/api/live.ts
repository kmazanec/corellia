/**
 * Live views over the control plane.
 *
 * - {@link useFloor}: every job and the fleet, seeded by the dashboard
 *   stream's snapshot and patched by its `job` and `fleet` messages. Jobs sit
 *   in the Query cache, so a command's response and the stream update one place.
 * - {@link useJobEvents}: one job's full event history, replayed and then
 *   followed, plus its queue view. The goal tree and spend are folded from the
 *   events in the browser with the factory's own projections, so the tree
 *   moves the instant an event lands.
 */

import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';

import { costSummary, projectGoalTree, type FactoryEvent, type Fleet, type GoalTreeNode, type Job } from '../factory';
import { api, json } from './client';
import { openStream, type LinkState } from './sse';

export const JOBS_KEY = ['jobs'] as const;
const FLEET_KEY = ['fleet'] as const;

export interface StoredEvent {
  seq: number;
  event: FactoryEvent;
}

const byActivity = (a: Job, b: Job) => b.lastEventAt - a.lastEventAt || b.lastSeq - a.lastSeq || a.jobId.localeCompare(b.jobId);

/** Put one job's latest view into the cached job list. */
export function upsertJob(queryClient: QueryClient, job: Job): void {
  queryClient.setQueryData<Job[]>(JOBS_KEY, (prev = []) => [job, ...prev.filter((j) => j.jobId !== job.jobId)].sort(byActivity));
}

export function useFloor(): { jobs: Job[] | undefined; fleet: Fleet | undefined; error: Error | null; link: LinkState } {
  const queryClient = useQueryClient();
  const [link, setLink] = useState<LinkState>('connecting');
  const jobs = useQuery({ queryKey: JOBS_KEY, queryFn: async () => (await json(await api.jobs.$get())).jobs as Job[] });
  const fleet = useQuery({
    queryKey: FLEET_KEY,
    queryFn: async () => ({ workers: (await json(await api.workers.$get())).workers, repos: (await json(await api.repos.$get())).repos }) as Fleet,
  });

  useEffect(
    () =>
      openStream('/api/stream', {
        onState: setLink,
        onMessage: (msg) => {
          if (msg.event === 'snapshot') {
            const snap = JSON.parse(msg.data) as { jobs: Job[] } & Fleet;
            queryClient.setQueryData(JOBS_KEY, snap.jobs);
            queryClient.setQueryData(FLEET_KEY, { workers: snap.workers, repos: snap.repos });
          } else if (msg.event === 'job') {
            upsertJob(queryClient, JSON.parse(msg.data) as Job);
          } else if (msg.event === 'fleet') {
            queryClient.setQueryData(FLEET_KEY, JSON.parse(msg.data) as Fleet);
          }
        },
      }),
    [queryClient],
  );

  return { jobs: jobs.data, fleet: fleet.data, error: jobs.error, link };
}

export interface JobLive {
  /** The job as the control plane sees it; undefined until the stream says. */
  job: Job | undefined;
  events: StoredEvent[];
  /** Events with a seq above this arrived live, after the replay caught up. */
  caughtUpAt: number;
  tree: GoalTreeNode | null;
  costUsd: number | null;
  link: LinkState;
  missing: boolean;
}

export function useJobEvents(jobId: string): JobLive {
  const queryClient = useQueryClient();
  const [events, setEvents] = useState<StoredEvent[]>([]);
  const [job, setJob] = useState<Job | undefined>(() => queryClient.getQueryData<Job[]>(JOBS_KEY)?.find((j) => j.jobId === jobId));
  const [caughtUpAt, setCaughtUpAt] = useState(Number.POSITIVE_INFINITY);
  const [link, setLink] = useState<LinkState>('connecting');
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    setEvents([]);
    setCaughtUpAt(Number.POSITIVE_INFINITY);
    setMissing(false);
    let buffer: StoredEvent[] = [];
    let lastSeq = 0;
    const flush = window.setInterval(() => {
      if (buffer.length === 0) return;
      const batch = buffer;
      buffer = [];
      setEvents((prev) => [...prev, ...batch]);
    }, 120);
    const close = openStream(`/api/jobs/${encodeURIComponent(jobId)}/stream`, {
      onState: setLink,
      onMissing: () => setMissing(true),
      onMessage: (msg) => {
        if (msg.event === 'event') {
          const stored = JSON.parse(msg.data) as StoredEvent;
          if (stored.seq <= lastSeq) return;
          lastSeq = stored.seq;
          buffer.push(stored);
        } else if (msg.event === 'caught-up') {
          const { seq } = JSON.parse(msg.data) as { seq: number };
          setCaughtUpAt((prev) => (Number.isFinite(prev) ? prev : seq));
        } else if (msg.event === 'job') {
          const next = JSON.parse(msg.data) as Job;
          setJob(next);
          upsertJob(queryClient, next);
        }
      },
    });
    return () => {
      close();
      window.clearInterval(flush);
    };
  }, [jobId, queryClient]);

  const tree = useMemo(() => {
    const roots = projectGoalTree(events.map((s) => s.event));
    return roots.find((r) => r.goalId === jobId) ?? roots[0] ?? null;
  }, [events, jobId]);
  const costUsd = useMemo(() => costSummary(events.map((s) => s.event)).tree.costUsd ?? null, [events]);

  return { job, events, caughtUpAt, tree, costUsd, link, missing };
}
