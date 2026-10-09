/**
 * The control plane's job index: the event log grouped by job.
 *
 * A job is one goal tree, identified by its root goal's id. Membership is
 * derived from the log itself: a `goal-received` with `parentId: null` opens a
 * job, and every other goal joins its parent's job. An event joins the job of
 * the goal it concerns. Events for goals that never arrived (the worktree
 * reaper's synthetic actor, for one) belong to no job and are not indexed.
 *
 * The index is a rebuildable cache over the log (ADR-003, ADR-051 Phase 1): it
 * is filled by {@link JobIndex.ingest} in `seq` order and holds nothing the log
 * does not.
 */

import {
  costSummary,
  projectGoalTree,
  type FactoryEvent,
  type Goal,
  type GoalState,
  type GoalTreeNode,
  type UsageTotals,
} from '../factory.js';
import type { StoredEvent } from '../events/event-source.js';

export interface JobSummary {
  jobId: string;
  title: string;
  goalType: string;
  state: GoalState;
  startedAt: number;
  lastEventAt: number;
  endedAt: number | null;
  eventCount: number;
  goalCount: number;
  costUsd: number | null;
  /** The newest `seq` in this job; a client holding it is up to date. */
  lastSeq: number;
}

export interface GoalDetail {
  goal: Goal;
  node: GoalTreeNode;
  usage: UsageTotals | null;
  events: StoredEvent[];
}

interface Job {
  jobId: string;
  events: StoredEvent[];
  goalIds: Set<string>;
  summary?: JobSummary;
  tree?: GoalTreeNode;
}

export class JobIndex {
  readonly #jobs = new Map<string, Job>();
  readonly #jobOfGoal = new Map<string, string>();

  /** Add one event. Returns the id of the job it joined, or null. */
  ingest(stored: StoredEvent): string | null {
    const jobId = this.#jobFor(stored.event);
    if (jobId === null) return null;
    let job = this.#jobs.get(jobId);
    if (!job) {
      job = { jobId, events: [], goalIds: new Set() };
      this.#jobs.set(jobId, job);
    }
    job.events.push(stored);
    if (stored.event.type === 'goal-received') job.goalIds.add(stored.event.goalId);
    delete job.summary;
    delete job.tree;
    return jobId;
  }

  /** Every job, most recently active first. */
  jobs(): JobSummary[] {
    return [...this.#jobs.values()]
      .map((j) => this.#summarize(j))
      .sort((a, b) => b.lastEventAt - a.lastEventAt || b.lastSeq - a.lastSeq);
  }

  job(jobId: string): JobSummary | undefined {
    const job = this.#jobs.get(jobId);
    return job && this.#summarize(job);
  }

  tree(jobId: string): GoalTreeNode | undefined {
    const job = this.#jobs.get(jobId);
    return job && this.#tree(job);
  }

  /** A job's events with `seq > after`, oldest first, at most `limit`. */
  events(jobId: string, after = 0, limit = Number.POSITIVE_INFINITY): StoredEvent[] | undefined {
    const job = this.#jobs.get(jobId);
    if (!job) return undefined;
    const out: StoredEvent[] = [];
    for (const s of job.events) {
      if (s.seq <= after) continue;
      out.push(s);
      if (out.length >= limit) break;
    }
    return out;
  }

  /** One goal in a job: its spec, tree node, spend, and every event about it. */
  goal(jobId: string, goalId: string): GoalDetail | undefined {
    const job = this.#jobs.get(jobId);
    if (!job || !job.goalIds.has(goalId)) return undefined;
    const node = findNode(this.#tree(job), goalId);
    const events = job.events.filter((s) => s.event.goalId === goalId);
    const received = events.find((s) => s.event.type === 'goal-received')?.event;
    if (!node || received?.type !== 'goal-received') return undefined;
    const usage = costSummary(events.map((s) => s.event)).byGoal[goalId] ?? null;
    return { goal: received.goal, node, usage, events };
  }

  #jobFor(e: FactoryEvent): string | null {
    if (e.type === 'goal-received' && !this.#jobOfGoal.has(e.goalId)) {
      const parent = e.goal.parentId;
      const jobId = (parent !== null && this.#jobOfGoal.get(parent)) || e.goalId;
      this.#jobOfGoal.set(e.goalId, jobId);
      return jobId;
    }
    return this.#jobOfGoal.get(e.goalId) ?? null;
  }

  #tree(job: Job): GoalTreeNode {
    if (!job.tree) {
      const roots = projectGoalTree(job.events.map((s) => s.event));
      job.tree = roots.find((r) => r.goalId === job.jobId) ?? roots[0]!;
    }
    return job.tree;
  }

  #summarize(job: Job): JobSummary {
    if (job.summary) return job.summary;
    const root = this.#tree(job);
    const last = job.events[job.events.length - 1]!;
    job.summary = {
      jobId: job.jobId,
      title: root.title,
      goalType: root.goalType,
      state: root.state,
      startedAt: root.startedAt,
      lastEventAt: last.event.at,
      endedAt: root.endedAt ?? null,
      eventCount: job.events.length,
      goalCount: job.goalIds.size,
      costUsd: costSummary(job.events.map((s) => s.event)).tree.costUsd ?? null,
      lastSeq: last.seq,
    };
    return job.summary;
  }
}

function findNode(node: GoalTreeNode, goalId: string): GoalTreeNode | undefined {
  if (node.goalId === goalId) return node;
  for (const c of node.children) {
    const hit = findNode(c, goalId);
    if (hit) return hit;
  }
  return undefined;
}
