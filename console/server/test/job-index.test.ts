import { describe, expect, it } from 'vitest';

import { sampleRun } from '../src/dev/sample-run.js';
import type { StoredEvent } from '../src/events/event-source.js';
import { JobIndex } from '../src/read-model/job-index.js';

const stored = (events: ReturnType<typeof sampleRun>): StoredEvent[] => events.map((event, i) => ({ seq: i + 1, event }));

/** Interleave two event lists one-for-one, the way two concurrent workers write. */
function interleave<T>(a: T[], b: T[]): T[] {
  const out: T[] = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (i < a.length) out.push(a[i]!);
    if (i < b.length) out.push(b[i]!);
  }
  return out;
}

describe('JobIndex', () => {
  it('groups interleaved events from concurrent jobs by root goal', () => {
    const a = sampleRun({ jobId: 'job-a', title: 'Job A', startAt: 1_000 });
    const b = sampleRun({ jobId: 'job-b', title: 'Job B', startAt: 1_000, outcome: 'running' });
    const index = new JobIndex();
    for (const s of stored(interleave(a, b))) index.ingest(s);

    const jobs = index.jobs();
    expect(jobs.map((j) => j.jobId).sort()).toEqual(['job-a', 'job-b']);
    expect(index.job('job-a')).toMatchObject({ title: 'Job A', state: 'done', eventCount: a.length, goalCount: 4 });
    expect(index.job('job-b')).toMatchObject({ state: 'running', eventCount: b.length, endedAt: null });
    expect(index.events('job-a')!.every((s) => s.event.goalId.startsWith('job-a'))).toBe(true);
  });

  it('sums the job spend and reports the root state', () => {
    const index = new JobIndex();
    for (const s of stored(sampleRun({ jobId: 'j', title: 'J', startAt: 0, outcome: 'failed' }))) index.ingest(s);
    const job = index.job('j')!;
    expect(job.state).toBe('failed');
    expect(job.costUsd).toBeCloseTo(0.021 + 3 * (0.008 + 0.031 + 0.044) + 0.052, 6);
  });

  it('shows the parked job and the module that parked it', () => {
    const index = new JobIndex();
    for (const s of stored(sampleRun({ jobId: 'p', title: 'P', startAt: 0, outcome: 'parked' }))) index.ingest(s);
    const tree = index.tree('p')!;
    expect(tree.state).toBe('parked');
    expect(index.job('p')!.state).toBe('parked');
    expect(tree.children.map((c) => c.state)).toEqual(['done', 'done', 'parked']);
  });

  it('pages a job by cursor', () => {
    const index = new JobIndex();
    const all = stored(sampleRun({ jobId: 'j', title: 'J', startAt: 0 }));
    for (const s of all) index.ingest(s);
    const page = index.events('j', 5, 3)!;
    expect(page.map((s) => s.seq)).toEqual([6, 7, 8]);
    expect(index.events('nope')).toBeUndefined();
  });

  it('returns one goal with its events and spend', () => {
    const index = new JobIndex();
    for (const s of stored(sampleRun({ jobId: 'j', title: 'J', startAt: 0 }))) index.ingest(s);
    const detail = index.goal('j', 'j.2')!;
    expect(detail.goal.title).toBe('Core implementation');
    expect(detail.node.state).toBe('done');
    expect(detail.events.every((s) => s.event.goalId === 'j.2')).toBe(true);
    expect(detail.usage?.costUsd).toBeCloseTo(0.008 + 0.031 + 0.044, 6);
    expect(index.goal('j', 'other.1')).toBeUndefined();
  });

  it('ignores events for goals that never arrived', () => {
    const index = new JobIndex();
    const joined = index.ingest({ seq: 1, event: { type: 'worktree-reaped', at: 1, goalId: 'worktree-reaper', path: '/x', reason: 'stale' } });
    expect(joined).toBeNull();
    expect(index.jobs()).toEqual([]);
  });
});
