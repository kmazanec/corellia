/**
 * Write synthetic concurrent jobs into a JSONL event log in real time, so the
 * console can be developed against a live-looking factory with no model.
 *
 *   npm run simulate -w @corellia/console-server -- out/console-dev/events.jsonl
 *   CONSOLE_EVENTS_JSONL=out/console-dev/events.jsonl npm run dev -w @corellia/console-server
 */

import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import type { FactoryEvent } from '../factory.js';
import { sampleRun, type SampleOutcome } from './sample-run.js';

const path = resolve(process.argv[2] ?? 'out/console-dev/events.jsonl');
const speedMs = Number(process.env['SIMULATE_STEP_MS'] ?? 700);

const JOBS: { title: string; outcome: SampleOutcome; modules?: string[]; delaySteps: number }[] = [
  { title: 'Add rate limiting to the webhook ingress', outcome: 'done', delaySteps: 0 },
  { title: 'Migrate the pattern store to Drizzle', outcome: 'parked', delaySteps: 4, modules: ['Schema mirror', 'Store adapter'] },
  { title: 'Word-count CLI with a behavioural smoke check', outcome: 'failed', delaySteps: 9 },
  {
    title: 'Operator console: job tree view',
    outcome: 'running',
    delaySteps: 14,
    modules: ['Tree projection', 'Tree component', 'Live updates', 'Inspector panel'],
  },
];

mkdirSync(dirname(path), { recursive: true });
writeFileSync(path, '');

const now = Date.now();
const timeline: { step: number; event: FactoryEvent }[] = [];
JOBS.forEach((job, i) => {
  const events = sampleRun({
    jobId: `sim-${i + 1}-${now.toString(36)}`,
    title: job.title,
    startAt: now,
    outcome: job.outcome,
    stepMs: speedMs,
    ...(job.modules ? { modules: job.modules } : {}),
  });
  events.forEach((event, k) => timeline.push({ step: job.delaySteps + k, event }));
});
timeline.sort((a, b) => a.step - b.step);

console.log(`[simulate] writing ${timeline.length} events for ${JOBS.length} jobs to ${path}`);
const start = Date.now();
let i = 0;
const timer = setInterval(() => {
  const due = Math.floor((Date.now() - start) / speedMs);
  while (i < timeline.length && timeline[i]!.step <= due) {
    const { event } = timeline[i++]!;
    appendFileSync(path, JSON.stringify({ ...event, at: Date.now() }) + '\n');
  }
  if (i >= timeline.length) {
    clearInterval(timer);
    console.log('[simulate] done');
  }
}, Math.max(50, speedMs / 4));
