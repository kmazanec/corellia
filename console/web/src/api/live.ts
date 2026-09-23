/**
 * Live views over the control plane.
 *
 * - {@link useJobs}: the job list, seeded by the dashboard stream's snapshot
 *   and patched by each `job` message.
 * - {@link useJobEvents}: one job's full event history, replayed and then
 *   followed. The goal tree and spend are folded from it in the browser with
 *   the factory's own projections, so the tree moves the instant an event lands.
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';

import { costSummary, projectGoalTree, type FactoryEvent, type GoalTreeNode, type JobSummary } from '../factory';
import { api, json } from './client';
import { openStream, type LinkState } from './sse';

const JOBS_KEY = ['jobs'] as const;

export interface StoredEvent {
  seq: number;
  event: FactoryEvent;
}

export function useJobs(): { jobs: JobSummary[] | undefined; error: Error | null; link: LinkState } {
  const queryClient = useQueryClient();
  const [link, setLink] = useState<LinkState>('connecting');
  const query = useQuery({
    queryKey: JOBS_KEY,
    queryFn: async () => (await json(await api.jobs.$get())).jobs,
  });

  useEffect(
    () =>
      openStream('/api/stream', {
        onState: setLink,
        onMessage: (msg) => {
          if (msg.event === 'snapshot') {
            queryClient.setQueryData(JOBS_KEY, (JSON.parse(msg.data) as { jobs: JobSummary[] }).jobs);
          } else if (msg.event === 'job') {
            const job = JSON.parse(msg.data) as JobSummary;
            queryClient.setQueryData<JobSummary[]>(JOBS_KEY, (prev = []) =>
              [job, ...prev.filter((j) => j.jobId !== job.jobId)].sort(
                (a, b) => b.lastEventAt - a.lastEventAt || b.lastSeq - a.lastSeq,
              ),
            );
          }
        },
      }),
    [queryClient],
  );

  return { jobs: query.data, error: query.error, link };
}

export interface JobLive {
  events: StoredEvent[];
  /** Events with a seq above this arrived live, after the replay caught up. */
  caughtUpAt: number;
  tree: GoalTreeNode | null;
  costUsd: number | null;
  link: LinkState;
}

export function useJobEvents(jobId: string): JobLive {
  const [events, setEvents] = useState<StoredEvent[]>([]);
  const [caughtUpAt, setCaughtUpAt] = useState(Number.POSITIVE_INFINITY);
  const [link, setLink] = useState<LinkState>('connecting');

  useEffect(() => {
    setEvents([]);
    setCaughtUpAt(Number.POSITIVE_INFINITY);
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
      onMessage: (msg) => {
        if (msg.event === 'event') {
          const stored = JSON.parse(msg.data) as StoredEvent;
          if (stored.seq <= lastSeq) return;
          lastSeq = stored.seq;
          buffer.push(stored);
        } else if (msg.event === 'caught-up') {
          const { seq } = JSON.parse(msg.data) as { seq: number };
          setCaughtUpAt((prev) => (Number.isFinite(prev) ? prev : seq));
        }
      },
    });
    return () => {
      close();
      window.clearInterval(flush);
    };
  }, [jobId]);

  const tree = useMemo(() => {
    const roots = projectGoalTree(events.map((s) => s.event));
    return roots.find((r) => r.goalId === jobId) ?? roots[0] ?? null;
  }, [events, jobId]);
  const costUsd = useMemo(() => costSummary(events.map((s) => s.event)).tree.costUsd ?? null, [events]);

  return { events, caughtUpAt, tree, costUsd, link };
}
