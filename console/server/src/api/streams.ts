/**
 * Live streams over SSE (ADR-051 § Liveness).
 *
 * - `GET /stream` — the dashboard: a `snapshot` of every job and the fleet,
 *   then a `job` message whenever a job's view changes and a `fleet` message
 *   every few seconds.
 * - `GET /jobs/:jobId/stream` — one job: its events replayed from
 *   `Last-Event-ID` (or `?after=`), a `caught-up` marker, then new events live,
 *   interleaved with `job` messages when its queue state changes. Each event
 *   message's `id` is the event's `seq`, so a reconnecting client resumes
 *   exactly where it stopped.
 *
 * A subscription is opened before any replay and drained after it, skipping
 * what the replay already sent, so nothing falls between the two.
 */

import { Hono } from 'hono';
import { streamSSE, type SSEStreamingApi } from 'hono/streaming';

import type { IndexedEvent, ReadModel } from '../read-model/read-model.js';
import { fleetView } from './fleet-routes.js';

const HEARTBEAT_MS = 15_000;
const FLEET_EVERY_MS = 5_000;
const SUMMARY_COALESCE_MS = 250;

export function streamRoutes(model: ReadModel, now: () => number = Date.now) {
  return new Hono()
    .get('/stream', (c) =>
      streamSSE(c, async (stream) => {
        const dirty = new Set<string>();
        const unsubscribe = model.subscribeJobs((jobId) => dirty.add(jobId));
        stream.onAbort(unsubscribe);
        const fleet = () => stream.writeSSE({ event: 'fleet', data: JSON.stringify(fleetView(model, now())) });
        await stream.writeSSE({
          event: 'snapshot',
          data: JSON.stringify({ jobs: model.jobs(), cursor: model.cursor, ...fleetView(model, now()) }),
        });
        let sinceFleet = 0;
        await pump(stream, SUMMARY_COALESCE_MS, async () => {
          for (const jobId of dirty) {
            const job = model.job(jobId);
            if (job) await stream.writeSSE({ event: 'job', data: JSON.stringify(job) });
          }
          dirty.clear();
          sinceFleet += SUMMARY_COALESCE_MS;
          if (sinceFleet >= FLEET_EVERY_MS) {
            sinceFleet = 0;
            await fleet();
          }
        });
      }),
    )
    .get('/jobs/:jobId/stream', (c) => {
      const jobId = c.req.param('jobId');
      if (!model.job(jobId)) return c.json({ error: `no job ${jobId}` }, 404);
      const after = resumeCursor(c.req.header('last-event-id'), c.req.query('after'));
      return streamSSE(c, async (stream) => {
        const pending: IndexedEvent[] = [];
        let jobChanged = true;
        const offEvents = model.subscribe((e) => {
          if (e.jobId === jobId) pending.push(e);
        });
        const offJobs = model.subscribeJobs((id) => {
          if (id === jobId) jobChanged = true;
        });
        stream.onAbort(() => {
          offEvents();
          offJobs();
        });
        let sent = after;
        for (const s of model.index.events(jobId, after) ?? []) {
          await stream.writeSSE({ event: 'event', id: String(s.seq), data: JSON.stringify(s) });
          sent = s.seq;
        }
        await stream.writeSSE({ event: 'caught-up', data: JSON.stringify({ seq: sent }) });
        await pump(stream, 100, async () => {
          while (pending.length > 0) {
            const e = pending.shift()!;
            if (e.seq <= sent) continue;
            await stream.writeSSE({ event: 'event', id: String(e.seq), data: JSON.stringify({ seq: e.seq, event: e.event }) });
            sent = e.seq;
          }
          if (jobChanged) {
            jobChanged = false;
            const job = model.job(jobId);
            if (job) await stream.writeSSE({ event: 'job', data: JSON.stringify(job) });
          }
        });
      });
    });
}

function resumeCursor(lastEventId: string | undefined, after: string | undefined): number {
  const n = Number(lastEventId ?? after ?? 0);
  return Number.isInteger(n) && n > 0 ? n : 0;
}

/** Run `flush` every `everyMs` and a heartbeat comment every 15s, until the client goes away. */
async function pump(stream: SSEStreamingApi, everyMs: number, flush: () => Promise<void>): Promise<void> {
  let sinceBeat = 0;
  while (!stream.aborted && !stream.closed) {
    await flush();
    await stream.sleep(everyMs);
    sinceBeat += everyMs;
    if (sinceBeat >= HEARTBEAT_MS) {
      await stream.write(': ping\n\n');
      sinceBeat = 0;
    }
  }
}
