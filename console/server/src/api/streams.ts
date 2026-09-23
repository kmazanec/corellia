/**
 * Live streams over SSE (ADR-051 § Liveness).
 *
 * - `GET /stream` — job summaries as they change, for the dashboard.
 * - `GET /jobs/:jobId/stream` — a job's events, replayed from `Last-Event-ID`
 *   (or `?after=`) and then followed live. Each message's `id` is the event's
 *   `seq`, so a reconnecting client resumes exactly where it stopped.
 *
 * A subscription is opened before the replay and its buffer is drained after
 * it, skipping anything the replay already sent, so no event falls between
 * the two.
 */

import { Hono } from 'hono';
import { streamSSE, type SSEStreamingApi } from 'hono/streaming';

import type { IndexedEvent, ReadModel } from '../read-model/read-model.js';

const HEARTBEAT_MS = 15_000;
const SUMMARY_COALESCE_MS = 250;

export function streamRoutes(model: ReadModel) {
  return new Hono()
    .get('/stream', (c) =>
      streamSSE(c, async (stream) => {
        const dirty = new Set<string>();
        const unsubscribe = model.subscribe((e) => dirty.add(e.jobId));
        stream.onAbort(unsubscribe);
        await stream.writeSSE({ event: 'snapshot', data: JSON.stringify({ jobs: model.index.jobs(), cursor: model.cursor }) });
        await pump(stream, SUMMARY_COALESCE_MS, async () => {
          for (const jobId of dirty) {
            const job = model.index.job(jobId);
            if (job) await stream.writeSSE({ event: 'job', id: String(job.lastSeq), data: JSON.stringify(job) });
          }
          dirty.clear();
        });
      }),
    )
    .get('/jobs/:jobId/stream', (c) => {
      const jobId = c.req.param('jobId');
      if (!model.index.job(jobId)) return c.json({ error: `no job ${jobId}` }, 404);
      const after = resumeCursor(c.req.header('last-event-id'), c.req.query('after'));
      return streamSSE(c, async (stream) => {
        const pending: IndexedEvent[] = [];
        const unsubscribe = model.subscribe((e) => {
          if (e.jobId === jobId) pending.push(e);
        });
        stream.onAbort(unsubscribe);
        let sent = after;
        for (const s of model.index.events(jobId, after) ?? []) {
          await stream.writeSSE({ event: 'event', id: String(s.seq), data: JSON.stringify(s) });
          sent = s.seq;
        }
        await pump(stream, 100, async () => {
          while (pending.length > 0) {
            const e = pending.shift()!;
            if (e.seq <= sent) continue;
            await stream.writeSSE({ event: 'event', id: String(e.seq), data: JSON.stringify({ seq: e.seq, event: e.event }) });
            sent = e.seq;
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
