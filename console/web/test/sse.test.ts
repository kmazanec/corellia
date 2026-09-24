import { describe, expect, it } from 'vitest';

import { readSseMessages, type SseMessage } from '../src/api/sse';

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(ctrl) {
      for (const c of chunks) ctrl.enqueue(enc.encode(c));
      ctrl.close();
    },
  });
}

async function collect(chunks: string[]): Promise<SseMessage[]> {
  const out: SseMessage[] = [];
  for await (const m of readSseMessages(streamOf(chunks))) out.push(m);
  return out;
}

describe('readSseMessages', () => {
  it('reassembles messages split across chunks and keeps ids', async () => {
    const msgs = await collect(['event: ev', 'ent\nid: 7\ndata: {"seq"', ':7}\n\n', 'event: caught-up\ndata: {}\n\n']);
    expect(msgs).toEqual([
      { event: 'event', id: '7', data: '{"seq":7}' },
      { event: 'caught-up', data: '{}' },
    ]);
  });

  it('skips heartbeat comments, joins multi-line data, and accepts CRLF', async () => {
    const msgs = await collect([': ping\n\n', 'data: a\r\ndata: b\r\n\r\n']);
    expect(msgs).toEqual([{ event: 'message', data: 'a\nb' }]);
  });
});
