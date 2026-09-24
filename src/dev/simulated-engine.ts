/**
 * An engine that runs no model: it plays a {@link sampleRun} for the goal into
 * the event store in real time and reports the matching outcome. It stands in
 * for the live engine wherever the surrounding machinery is what is being
 * exercised — the worker loop, the job queue, the operator console — and is
 * selected with `CORELLIA_ENGINE=simulated`.
 *
 * The outcome comes from the commission spec's `simulate` field (`done`,
 * `failed`, or `parked`; default `done`). A parked run blocks its root on a
 * park brief, as a real tree does when a module escalates, so the listener
 * parks it the ordinary way. Resumed with an answer, the run finishes `done`.
 */

import type { Engine } from '../engine/engine.js';
import type { EventStore, FactoryEvent } from '../contract/events.js';
import type { Goal } from '../contract/goal.js';
import type { Report } from '../contract/report.js';
import { sampleRun, type SampleOutcome } from './sample-run.js';

export interface SimulatedEngineOptions {
  store: EventStore;
  /** ms between events (default 400). */
  stepMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const OUTCOMES: readonly SampleOutcome[] = ['done', 'failed', 'parked'];

export function buildSimulatedEngine(opts: SimulatedEngineOptions): Engine {
  const stepMs = opts.stepMs ?? 400;
  const now = opts.now ?? (() => Date.now());
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  const run = async (goal: Goal): Promise<Report> => {
    const outcome = outcomeFor(goal);
    const events = sampleRun({ jobId: goal.id, title: goal.title, startAt: now(), outcome, stepMs, rootGoal: goal });
    let blockers: string[] = [];

    if (outcome === 'parked') {
      const parked = events.pop();
      if (parked?.type !== 'parked') throw new Error('sample run did not end parked');
      const brief = { ...parked.brief, links: [goal.id] };
      events.push({ type: 'blocked', at: parked.at, goalId: goal.id, brief, resolution: 'park' });
      blockers = [`parked: ${brief.question}`];
    } else {
      const last = events[events.length - 1];
      if (last?.type === 'emitted') blockers = last.report.blockers;
    }

    for (const e of events) {
      await sleep(stepMs);
      await opts.store.append({ ...e, at: now() } as FactoryEvent);
    }
    return { artifact: null, proof: [], lessons: [], memoriesUsed: [], blockers, findings: [], learned: '' };
  };

  return { run } as unknown as Engine;
}

function outcomeFor(goal: Goal): SampleOutcome {
  if (goal.memories.some((m) => m.id === `${goal.id}:answer`)) return 'done';
  const asked = (goal.spec as { simulate?: unknown } | null)?.simulate;
  return OUTCOMES.find((o) => o === asked) ?? 'done';
}
