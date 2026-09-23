/**
 * A server-sent-events reader over `fetch`, so the operator token travels in
 * the Authorization header (EventSource cannot send headers). It reconnects
 * with backoff and resumes from the last `id` it saw via `Last-Event-ID`.
 */

import { getToken, setToken } from './token';

export interface SseMessage {
  event: string;
  id?: string;
  data: string;
}

export type LinkState = 'connecting' | 'live' | 'retrying';

export interface SseOptions {
  onMessage(msg: SseMessage): void;
  onState?(state: LinkState): void;
  /** Resume point for the first connection. */
  lastEventId?: string;
}

/** Open a stream. Returns a function that closes it for good. */
export function openStream(url: string, opts: SseOptions): () => void {
  const ctrl = new AbortController();
  let lastEventId = opts.lastEventId;
  let delay = 500;

  const run = async (): Promise<void> => {
    while (!ctrl.signal.aborted) {
      opts.onState?.('connecting');
      try {
        const headers: Record<string, string> = { accept: 'text/event-stream' };
        const token = getToken();
        if (token) headers['authorization'] = `Bearer ${token}`;
        if (lastEventId) headers['last-event-id'] = lastEventId;
        const res = await fetch(url, { headers, signal: ctrl.signal });
        if (res.status === 401) {
          setToken(null);
          return;
        }
        if (!res.ok || !res.body) throw new Error(`stream answered ${res.status}`);
        opts.onState?.('live');
        delay = 500;
        for await (const msg of readSseMessages(res.body)) {
          if (msg.id !== undefined) lastEventId = msg.id;
          opts.onMessage(msg);
        }
      } catch {
        if (ctrl.signal.aborted) return;
      }
      opts.onState?.('retrying');
      await sleep(delay, ctrl.signal);
      delay = Math.min(delay * 2, 10_000);
    }
  };
  void run();
  return () => ctrl.abort();
}

/** Parse an SSE byte stream into messages; comments and data-less blocks are skipped. */
export async function* readSseMessages(body: ReadableStream<Uint8Array>): AsyncGenerator<SseMessage> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buf += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
    let end: number;
    while ((end = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, end);
      buf = buf.slice(end + 2);
      const msg: SseMessage = { event: 'message', data: '' };
      let hasData = false;
      for (const line of block.split('\n')) {
        if (line.startsWith(':')) continue;
        const colon = line.indexOf(':');
        const field = colon < 0 ? line : line.slice(0, colon);
        const value = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '');
        if (field === 'event') msg.event = value;
        else if (field === 'id') msg.id = value;
        else if (field === 'data') {
          msg.data += hasData ? `\n${value}` : value;
          hasData = true;
        }
      }
      if (hasData) yield msg;
    }
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(t);
      resolve();
    });
  });
}
