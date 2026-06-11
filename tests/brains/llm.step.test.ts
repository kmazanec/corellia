/**
 * Tests for LlmBrain.step — wire adapter tests covering:
 * - Request shaping (transcript → OpenAI tool-calling wire body, prefix stability)
 * - Response translation (tool_calls with id preservation, content-only artifact path)
 * - Transport retries (429/5xx → bounded retries with backoff via injectable sleep,
 *   incidents on envelope, no usage on retried calls; exhaustion throws)
 * - Malformation re-prompt (one corrective re-prompt then success; double fails)
 * - Terminal errors (401/403/404 → zero retries, throws immediately)
 *
 * No live API calls are made. All fetches use the fetchImpl injection pattern.
 */

import { describe, it, expect, vi } from 'vitest';
import { LlmBrain } from '../../src/brains/llm.js';
import type { Goal } from '../../src/contract/goal.js';
import type { BrainContext } from '../../src/contract/brain.js';
import type { StepTranscript } from '../../src/contract/brain.js';
import type { ToolDef } from '../../src/contract/tool.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type FetchCall = { url: string; options: RequestInit };

/**
 * Build a stub fetch that plays through a sequence of (status, body) pairs.
 * Non-ok responses return an error body; ok responses return JSON.
 */
function stubFetch(
  ...responses: Array<{ status: number; body: unknown }>
): { fetch: typeof fetch; calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  let idx = 0;
  const fetch = vi.fn(async (url: string | URL | Request, options?: RequestInit) => {
    calls.push({ url: String(url), options: options ?? {} });
    const resp = responses[Math.min(idx++, responses.length - 1)];
    const body = typeof resp?.body === 'string' ? resp.body : JSON.stringify(resp?.body ?? {});
    return new Response(body, {
      status: resp?.status ?? 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return { fetch, calls };
}

/** Build a minimal wire step response with tool_calls. */
function toolCallResponse(
  calls: Array<{ id: string; name: string; args: Record<string, unknown> }>,
  usage?: { prompt_tokens: number; completion_tokens: number; cost?: number },
) {
  return {
    choices: [
      {
        message: {
          role: 'assistant',
          content: null,
          tool_calls: calls.map((c) => ({
            id: c.id,
            type: 'function',
            function: { name: c.name, arguments: JSON.stringify(c.args) },
          })),
        },
      },
    ],
    ...(usage ? { usage } : {}),
  };
}

/** Build a minimal wire step response with content-only (no tool_calls). */
function contentResponse(content: string, usage?: { prompt_tokens: number; completion_tokens: number; cost?: number }) {
  return {
    choices: [{ message: { role: 'assistant', content } }],
    ...(usage ? { usage } : {}),
  };
}

/** Build an error-body response (non-ok). */
function errorResponse(status: number, message: string) {
  return { status, body: JSON.stringify({ error: { message } }) };
}

/** Minimal brain setup. */
const modelByTier = { haiku: 'haiku-m', sonnet: 'sonnet-m', opus: 'opus-m' };
const BASE = 'https://api.test.com/v1';
const KEY = 'test-key';

const baseGoal: Goal = {
  id: 'g1',
  type: 'implement',
  parentId: null,
  title: 'Build something',
  spec: {},
  intent: 'production',
  scope: ['src/'],
  budget: { attempts: 3, tokens: 10000, toolCalls: 20, wallClockMs: 120000 },
  memories: [],
};

const ctx: BrainContext = { tier: 'sonnet', memories: [] };

const tools: ToolDef[] = [
  {
    name: 'read_file',
    description: 'Read a file',
    parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
  },
  {
    name: 'write_file',
    description: 'Write a file',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string' }, content: { type: 'string' } },
      required: ['path', 'content'],
    },
  },
];

// ---------------------------------------------------------------------------
// Chunk 1: Request shaping
// ---------------------------------------------------------------------------

describe('step request shaping', () => {
  it('sends POST to /chat/completions', async () => {
    const { fetch, calls } = stubFetch({ status: 200, body: contentResponse('done') });
    const brain = new LlmBrain({ baseUrl: BASE, apiKey: KEY, modelByTier, fetchImpl: fetch });
    await brain.step(baseGoal, [{ role: 'context', content: 'sys' }], tools, ctx);
    expect(calls[0]?.url).toBe(`${BASE}/chat/completions`);
  });

  it('uses the model matching the context tier', async () => {
    const { fetch, calls } = stubFetch({ status: 200, body: contentResponse('done') });
    const brain = new LlmBrain({ baseUrl: BASE, apiKey: KEY, modelByTier, fetchImpl: fetch });
    await brain.step(baseGoal, [{ role: 'context', content: 'sys' }], tools, { tier: 'opus', memories: [] });
    const body = JSON.parse(calls[0]!.options.body as string);
    expect(body.model).toBe('opus-m');
  });

  it('maps the first context message to role:system', async () => {
    const { fetch, calls } = stubFetch({ status: 200, body: contentResponse('done') });
    const brain = new LlmBrain({ baseUrl: BASE, apiKey: KEY, modelByTier, fetchImpl: fetch });
    const transcript: StepTranscript = [{ role: 'context', content: 'system prompt here' }];
    await brain.step(baseGoal, transcript, tools, ctx);
    const body = JSON.parse(calls[0]!.options.body as string);
    expect(body.messages[0]).toEqual({ role: 'system', content: 'system prompt here' });
  });

  it('maps subsequent context messages to role:user', async () => {
    const { fetch, calls } = stubFetch({ status: 200, body: contentResponse('done') });
    const brain = new LlmBrain({ baseUrl: BASE, apiKey: KEY, modelByTier, fetchImpl: fetch });
    const transcript: StepTranscript = [
      { role: 'context', content: 'first' },
      { role: 'context', content: 'second observation' },
    ];
    await brain.step(baseGoal, transcript, tools, ctx);
    const body = JSON.parse(calls[0]!.options.body as string);
    expect(body.messages[0]).toEqual({ role: 'system', content: 'first' });
    expect(body.messages[1]).toEqual({ role: 'user', content: 'second observation' });
  });

  it('maps assistant message with toolCalls to assistant role with tool_calls array', async () => {
    const { fetch, calls } = stubFetch({ status: 200, body: contentResponse('done') });
    const brain = new LlmBrain({ baseUrl: BASE, apiKey: KEY, modelByTier, fetchImpl: fetch });
    const transcript: StepTranscript = [
      { role: 'context', content: 'sys' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'call-1', name: 'read_file', args: { path: 'foo.ts' } }],
      },
    ];
    await brain.step(baseGoal, transcript, tools, ctx);
    const body = JSON.parse(calls[0]!.options.body as string);
    const asst = body.messages[1];
    expect(asst.role).toBe('assistant');
    expect(asst.tool_calls).toHaveLength(1);
    expect(asst.tool_calls[0].id).toBe('call-1');
    expect(asst.tool_calls[0].function.name).toBe('read_file');
    expect(JSON.parse(asst.tool_calls[0].function.arguments)).toEqual({ path: 'foo.ts' });
  });

  it('maps assistant message without toolCalls to plain assistant role message', async () => {
    const { fetch, calls } = stubFetch({ status: 200, body: contentResponse('done') });
    const brain = new LlmBrain({ baseUrl: BASE, apiKey: KEY, modelByTier, fetchImpl: fetch });
    const transcript: StepTranscript = [
      { role: 'context', content: 'sys' },
      { role: 'assistant', content: 'I will write the code now.' },
    ];
    await brain.step(baseGoal, transcript, tools, ctx);
    const body = JSON.parse(calls[0]!.options.body as string);
    const asst = body.messages[1];
    expect(asst.role).toBe('assistant');
    expect(asst.tool_calls).toBeUndefined();
    expect(asst.content).toBe('I will write the code now.');
  });

  it('maps tool result messages to role:tool with tool_call_id', async () => {
    const { fetch, calls } = stubFetch({ status: 200, body: contentResponse('done') });
    const brain = new LlmBrain({ baseUrl: BASE, apiKey: KEY, modelByTier, fetchImpl: fetch });
    const transcript: StepTranscript = [
      { role: 'context', content: 'sys' },
      { role: 'tool', callId: 'call-1', content: 'file contents here' },
    ];
    await brain.step(baseGoal, transcript, tools, ctx);
    const body = JSON.parse(calls[0]!.options.body as string);
    const toolMsg = body.messages[1];
    expect(toolMsg.role).toBe('tool');
    expect(toolMsg.tool_call_id).toBe('call-1');
    expect(toolMsg.content).toBe('file contents here');
  });

  it('serializes tools[] as OpenAI function tool params', async () => {
    const { fetch, calls } = stubFetch({ status: 200, body: contentResponse('done') });
    const brain = new LlmBrain({ baseUrl: BASE, apiKey: KEY, modelByTier, fetchImpl: fetch });
    await brain.step(baseGoal, [{ role: 'context', content: 'sys' }], tools, ctx);
    const body = JSON.parse(calls[0]!.options.body as string);
    expect(body.tools).toHaveLength(2);
    expect(body.tools[0].type).toBe('function');
    expect(body.tools[0].function.name).toBe('read_file');
    expect(body.tools[1].function.name).toBe('write_file');
  });

  it('includes Authorization Bearer header', async () => {
    const { fetch, calls } = stubFetch({ status: 200, body: contentResponse('done') });
    const brain = new LlmBrain({ baseUrl: BASE, apiKey: 'my-secret-key', modelByTier, fetchImpl: fetch });
    await brain.step(baseGoal, [{ role: 'context', content: 'sys' }], tools, ctx);
    const headers = calls[0]!.options.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer my-secret-key');
  });

  it('includes extra headers when provided', async () => {
    const { fetch, calls } = stubFetch({ status: 200, body: contentResponse('done') });
    const brain = new LlmBrain({
      baseUrl: BASE,
      apiKey: KEY,
      modelByTier,
      headers: { 'X-Custom': 'header-value' },
      fetchImpl: fetch,
    });
    await brain.step(baseGoal, [{ role: 'context', content: 'sys' }], tools, ctx);
    const headers = calls[0]!.options.headers as Record<string, string>;
    expect(headers['X-Custom']).toBe('header-value');
  });
});

// ---------------------------------------------------------------------------
// Chunk 1b: Prefix stability (AC-6)
// ---------------------------------------------------------------------------

describe('step prefix stability', () => {
  it('produces byte-identical messages array across two consecutive steps with the same transcript', async () => {
    const transcript: StepTranscript = [
      { role: 'context', content: 'system framing' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'c1', name: 'read_file', args: { path: 'src/index.ts' } }],
      },
      { role: 'tool', callId: 'c1', content: 'file content' },
    ];

    const { fetch: fetch1, calls: calls1 } = stubFetch({ status: 200, body: contentResponse('result') });
    const { fetch: fetch2, calls: calls2 } = stubFetch({ status: 200, body: contentResponse('result') });

    const brain1 = new LlmBrain({ baseUrl: BASE, apiKey: KEY, modelByTier, fetchImpl: fetch1 });
    const brain2 = new LlmBrain({ baseUrl: BASE, apiKey: KEY, modelByTier, fetchImpl: fetch2 });

    await brain1.step(baseGoal, transcript, tools, ctx);
    await brain2.step(baseGoal, transcript, tools, ctx);

    const body1 = JSON.parse(calls1[0]!.options.body as string);
    const body2 = JSON.parse(calls2[0]!.options.body as string);

    expect(JSON.stringify(body1.messages)).toBe(JSON.stringify(body2.messages));
  });

  it('messages array is a prefix-stable serialization: args JSON key order is deterministic', async () => {
    const transcript: StepTranscript = [
      { role: 'context', content: 'sys' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'c1', name: 'write_file', args: { path: 'a.ts', content: 'x' } }],
      },
    ];

    const { fetch, calls } = stubFetch({ status: 200, body: contentResponse('done') });
    const brain = new LlmBrain({ baseUrl: BASE, apiKey: KEY, modelByTier, fetchImpl: fetch });
    await brain.step(baseGoal, transcript, tools, ctx);

    const body = JSON.parse(calls[0]!.options.body as string);
    const argStr: string = body.messages[1].tool_calls[0].function.arguments;
    const parsed = JSON.parse(argStr) as Record<string, unknown>;
    expect(parsed).toEqual({ path: 'a.ts', content: 'x' });
    expect(argStr).toBe(JSON.stringify({ path: 'a.ts', content: 'x' }));
  });
});

// ---------------------------------------------------------------------------
// Chunk 2: Response translation fidelity
// ---------------------------------------------------------------------------

describe('step translation', () => {
  it('returns {kind:tool-calls} with ids preserved 1:1 when response has tool_calls', async () => {
    const wireBody = toolCallResponse([
      { id: 'tc-abc', name: 'read_file', args: { path: 'src/main.ts' } },
      { id: 'tc-def', name: 'write_file', args: { path: 'src/out.ts', content: 'hello' } },
    ]);
    const { fetch } = stubFetch({ status: 200, body: wireBody });
    const brain = new LlmBrain({ baseUrl: BASE, apiKey: KEY, modelByTier, fetchImpl: fetch });
    const result = await brain.step(baseGoal, [{ role: 'context', content: 'sys' }], tools, ctx);

    expect(result.kind).toBe('tool-calls');
    if (result.kind !== 'tool-calls') throw new Error('unreachable');
    expect(result.calls).toHaveLength(2);
    expect(result.calls[0]!.id).toBe('tc-abc');
    expect(result.calls[0]!.name).toBe('read_file');
    expect(result.calls[0]!.args).toEqual({ path: 'src/main.ts' });
    expect(result.calls[1]!.id).toBe('tc-def');
    expect(result.calls[1]!.name).toBe('write_file');
  });

  it('returns {kind:artifact, files} when response is content-only with file blocks', async () => {
    const content = '```src/widget.ts\nexport const x = 1;\n```';
    const { fetch } = stubFetch({ status: 200, body: contentResponse(content) });
    const brain = new LlmBrain({ baseUrl: BASE, apiKey: KEY, modelByTier, fetchImpl: fetch });
    const result = await brain.step(baseGoal, [{ role: 'context', content: 'sys' }], tools, ctx);

    expect(result.kind).toBe('artifact');
    if (result.kind !== 'artifact') throw new Error('unreachable');
    expect(result.artifact.kind).toBe('files');
    if (result.artifact.kind !== 'files') throw new Error('unreachable');
    expect(result.artifact.files).toHaveLength(1);
    expect(result.artifact.files![0]!.path).toBe('src/widget.ts');
    expect(result.artifact.files![0]!.content).toContain('export const x = 1;');
  });

  it('returns {kind:artifact, text} when response is content-only without file blocks', async () => {
    const { fetch } = stubFetch({ status: 200, body: contentResponse('I am done with the task.') });
    const brain = new LlmBrain({ baseUrl: BASE, apiKey: KEY, modelByTier, fetchImpl: fetch });
    const result = await brain.step(baseGoal, [{ role: 'context', content: 'sys' }], tools, ctx);

    expect(result.kind).toBe('artifact');
    if (result.kind !== 'artifact') throw new Error('unreachable');
    expect(result.artifact.kind).toBe('text');
    if (result.artifact.kind !== 'text') throw new Error('unreachable');
    expect(result.artifact.text).toContain('I am done with the task.');
  });

  it('reads usage from response.usage when present', async () => {
    const wireBody = toolCallResponse(
      [{ id: 'c1', name: 'read_file', args: { path: 'x' } }],
      { prompt_tokens: 100, completion_tokens: 50, cost: 0.001 },
    );
    const { fetch } = stubFetch({ status: 200, body: wireBody });
    const brain = new LlmBrain({ baseUrl: BASE, apiKey: KEY, modelByTier, fetchImpl: fetch });
    const result = await brain.step(baseGoal, [{ role: 'context', content: 'sys' }], tools, ctx);

    expect(result.usage.promptTokens).toBe(100);
    expect(result.usage.completionTokens).toBe(50);
    expect(result.usage.costUsd).toBe(0.001);
  });

  it('returns ZERO_USAGE-style fallback when response.usage is absent', async () => {
    const wireBody = contentResponse('done');
    const { fetch } = stubFetch({ status: 200, body: wireBody });
    const brain = new LlmBrain({ baseUrl: BASE, apiKey: KEY, modelByTier, fetchImpl: fetch });
    const result = await brain.step(baseGoal, [{ role: 'context', content: 'sys' }], tools, ctx);

    expect(result.usage.promptTokens).toBe(0);
    expect(result.usage.completionTokens).toBe(0);
    expect(result.usage.costUsd).toBeUndefined();
  });

  it('preserves tool call ids 1:1 through translation', async () => {
    const ids = ['id-aaa', 'id-bbb', 'id-ccc'];
    const wireBody = toolCallResponse(
      ids.map((id) => ({ id, name: 'read_file', args: { path: 'f.ts' } })),
    );
    const { fetch } = stubFetch({ status: 200, body: wireBody });
    const brain = new LlmBrain({ baseUrl: BASE, apiKey: KEY, modelByTier, fetchImpl: fetch });
    const result = await brain.step(baseGoal, [{ role: 'context', content: 'sys' }], tools, ctx);

    if (result.kind !== 'tool-calls') throw new Error('unreachable');
    expect(result.calls.map((c) => c.id)).toEqual(ids);
  });
});

// ---------------------------------------------------------------------------
// Chunk 3: Transport retries
// ---------------------------------------------------------------------------

describe('step transport retries', () => {
  it('succeeds after two 429 retries; step resolves with the successful response', async () => {
    const delays: number[] = [];
    const fakeSleep = async (ms: number) => { delays.push(ms); };

    const { fetch, calls } = stubFetch(
      errorResponse(429, 'rate limited'),
      errorResponse(429, 'rate limited again'),
      { status: 200, body: contentResponse('done') },
    );
    const brain = new LlmBrain({ baseUrl: BASE, apiKey: KEY, modelByTier, fetchImpl: fetch, sleepFn: fakeSleep });
    const result = await brain.step(baseGoal, [{ role: 'context', content: 'sys' }], tools, ctx);

    expect(result.kind).toBe('artifact');
    expect(calls).toHaveLength(3);
  });

  it('records exactly 2 transport-retry incidents on the envelope after two 429s then success', async () => {
    const fakeSleep = async (_ms: number) => {};

    const { fetch } = stubFetch(
      errorResponse(429, 'rate limited'),
      errorResponse(429, 'rate limited again'),
      { status: 200, body: contentResponse('done') },
    );
    const brain = new LlmBrain({ baseUrl: BASE, apiKey: KEY, modelByTier, fetchImpl: fetch, sleepFn: fakeSleep });
    const result = await brain.step(baseGoal, [{ role: 'context', content: 'sys' }], tools, ctx);

    expect(result.incidents).toHaveLength(2);
    expect(result.incidents!.every((i) => i.kind === 'transport-retry')).toBe(true);
    expect(result.incidents![0]!.detail).toContain('429');
    expect(result.incidents![1]!.detail).toContain('429');
  });

  it('requests backoff delays with jitter bounds (delay > 0, non-zero between retries)', async () => {
    const delays: number[] = [];
    const fakeSleep = async (ms: number) => { delays.push(ms); };

    const { fetch } = stubFetch(
      errorResponse(429, 'rate limited'),
      errorResponse(429, 'rate limited again'),
      { status: 200, body: contentResponse('done') },
    );
    const brain = new LlmBrain({ baseUrl: BASE, apiKey: KEY, modelByTier, fetchImpl: fetch, sleepFn: fakeSleep });
    await brain.step(baseGoal, [{ role: 'context', content: 'sys' }], tools, ctx);

    expect(delays).toHaveLength(2);
    expect(delays[0]!).toBeGreaterThan(0);
    expect(delays[1]!).toBeGreaterThan(0);
    expect(delays[1]!).toBeGreaterThan(delays[0]!);
  });

  it('retried calls carry no usage (usage only on the successful call)', async () => {
    const fakeSleep = async (_ms: number) => {};

    const successUsage = { prompt_tokens: 75, completion_tokens: 25 };
    const { fetch } = stubFetch(
      errorResponse(429, 'rate limited'),
      { status: 200, body: contentResponse('done', successUsage) },
    );
    const brain = new LlmBrain({ baseUrl: BASE, apiKey: KEY, modelByTier, fetchImpl: fetch, sleepFn: fakeSleep });
    const result = await brain.step(baseGoal, [{ role: 'context', content: 'sys' }], tools, ctx);

    expect(result.usage.promptTokens).toBe(75);
    expect(result.usage.completionTokens).toBe(25);
  });

  it('succeeds after a 503 retry', async () => {
    const fakeSleep = async (_ms: number) => {};
    const { fetch, calls } = stubFetch(
      errorResponse(503, 'service unavailable'),
      { status: 200, body: contentResponse('done') },
    );
    const brain = new LlmBrain({ baseUrl: BASE, apiKey: KEY, modelByTier, fetchImpl: fetch, sleepFn: fakeSleep });
    const result = await brain.step(baseGoal, [{ role: 'context', content: 'sys' }], tools, ctx);

    expect(result.kind).toBe('artifact');
    expect(calls).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Chunk 3b: Retries exhausted
// ---------------------------------------------------------------------------

describe('step transport retries exhausted', () => {
  it('throws when all retries are exhausted (four 429 responses)', async () => {
    const fakeSleep = async (_ms: number) => {};
    const { fetch } = stubFetch(
      errorResponse(429, 'rate limited'),
      errorResponse(429, 'rate limited'),
      errorResponse(429, 'rate limited'),
      errorResponse(429, 'rate limited'),
    );
    const brain = new LlmBrain({ baseUrl: BASE, apiKey: KEY, modelByTier, fetchImpl: fetch, sleepFn: fakeSleep });
    await expect(brain.step(baseGoal, [{ role: 'context', content: 'sys' }], tools, ctx)).rejects.toThrow(
      /429/,
    );
  });

  it('makes exactly MAX_RETRIES+1 fetch calls before giving up', async () => {
    const fakeSleep = async (_ms: number) => {};
    const { fetch, calls } = stubFetch(
      errorResponse(429, 'r1'),
      errorResponse(429, 'r2'),
      errorResponse(429, 'r3'),
      errorResponse(429, 'r4'),
    );
    const brain = new LlmBrain({ baseUrl: BASE, apiKey: KEY, modelByTier, fetchImpl: fetch, sleepFn: fakeSleep });
    await brain.step(baseGoal, [{ role: 'context', content: 'sys' }], tools, ctx).catch(() => {});
    expect(calls).toHaveLength(4);
  });
});

// ---------------------------------------------------------------------------
// Chunk 4: Malformation re-prompt
// ---------------------------------------------------------------------------

describe('step malformation', () => {
  it('issues exactly one corrective re-prompt when tool_calls have unparseable args, then succeeds', async () => {
    const malformedBody = {
      choices: [
        {
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'c1',
                type: 'function',
                function: { name: 'read_file', arguments: 'NOT VALID JSON {{{' },
              },
            ],
          },
        },
      ],
    };

    const { fetch, calls } = stubFetch(
      { status: 200, body: malformedBody },
      { status: 200, body: contentResponse('repaired artifact') },
    );
    const brain = new LlmBrain({ baseUrl: BASE, apiKey: KEY, modelByTier, fetchImpl: fetch });
    const result = await brain.step(baseGoal, [{ role: 'context', content: 'sys' }], tools, ctx);

    expect(calls).toHaveLength(2);
    expect(result.kind).toBe('artifact');
  });

  it('records a malformation-reprompt incident on the envelope after one re-prompt', async () => {
    const malformedBody = {
      choices: [
        {
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'c1',
                type: 'function',
                function: { name: 'read_file', arguments: '{not json' },
              },
            ],
          },
        },
      ],
    };

    const { fetch } = stubFetch(
      { status: 200, body: malformedBody },
      { status: 200, body: contentResponse('recovered') },
    );
    const brain = new LlmBrain({ baseUrl: BASE, apiKey: KEY, modelByTier, fetchImpl: fetch });
    const result = await brain.step(baseGoal, [{ role: 'context', content: 'sys' }], tools, ctx);

    expect(result.incidents).toHaveLength(1);
    expect(result.incidents![0]!.kind).toBe('malformation-reprompt');
  });

  it('the re-prompt includes the parse error description in the corrective context message', async () => {
    const malformedBody = {
      choices: [
        {
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'c1',
                type: 'function',
                function: { name: 'read_file', arguments: 'bad json' },
              },
            ],
          },
        },
      ],
    };

    const { fetch, calls } = stubFetch(
      { status: 200, body: malformedBody },
      { status: 200, body: contentResponse('ok') },
    );
    const brain = new LlmBrain({ baseUrl: BASE, apiKey: KEY, modelByTier, fetchImpl: fetch });
    await brain.step(baseGoal, [{ role: 'context', content: 'sys' }], tools, ctx);

    const repromptBody = JSON.parse(calls[1]!.options.body as string);
    const lastMessage = repromptBody.messages[repromptBody.messages.length - 1];
    expect(lastMessage.content).toMatch(/unparseable|parse error/i);
  });

  it('debits usage from both the initial call and the re-prompt call', async () => {
    const malformedBody = {
      choices: [
        {
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'c1',
                type: 'function',
                function: { name: 'read_file', arguments: 'invalid' },
              },
            ],
          },
        },
      ],
      usage: { prompt_tokens: 30, completion_tokens: 10 },
    };
    const repromptBody = contentResponse('recovered', { prompt_tokens: 20, completion_tokens: 5 });

    const { fetch } = stubFetch(
      { status: 200, body: malformedBody },
      { status: 200, body: repromptBody },
    );
    const brain = new LlmBrain({ baseUrl: BASE, apiKey: KEY, modelByTier, fetchImpl: fetch });
    const result = await brain.step(baseGoal, [{ role: 'context', content: 'sys' }], tools, ctx);

    expect(result.usage.promptTokens).toBe(50);
    expect(result.usage.completionTokens).toBe(15);
  });

  it('fails the step on a second consecutive malformation', async () => {
    const malformedBody = {
      choices: [
        {
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'c1',
                type: 'function',
                function: { name: 'read_file', arguments: 'bad json' },
              },
            ],
          },
        },
      ],
    };

    const { fetch } = stubFetch(
      { status: 200, body: malformedBody },
      { status: 200, body: malformedBody },
    );
    const brain = new LlmBrain({ baseUrl: BASE, apiKey: KEY, modelByTier, fetchImpl: fetch });
    await expect(brain.step(baseGoal, [{ role: 'context', content: 'sys' }], tools, ctx)).rejects.toThrow(
      /malform|consecutive|parse error/i,
    );
  });
});

// ---------------------------------------------------------------------------
// Chunk 5: Terminal errors
// ---------------------------------------------------------------------------

describe('step terminal errors', () => {
  it('throws immediately on 401 with zero retries', async () => {
    const fakeSleep = vi.fn(async (_ms: number) => {});
    const { fetch, calls } = stubFetch(errorResponse(401, 'Unauthorized'));
    const brain = new LlmBrain({ baseUrl: BASE, apiKey: KEY, modelByTier, fetchImpl: fetch, sleepFn: fakeSleep });
    await expect(brain.step(baseGoal, [{ role: 'context', content: 'sys' }], tools, ctx)).rejects.toThrow(
      /401/,
    );
    expect(calls).toHaveLength(1);
    expect(fakeSleep).not.toHaveBeenCalled();
  });

  it('throws immediately on 403 with zero retries', async () => {
    const fakeSleep = vi.fn(async (_ms: number) => {});
    const { fetch, calls } = stubFetch(errorResponse(403, 'Forbidden'));
    const brain = new LlmBrain({ baseUrl: BASE, apiKey: KEY, modelByTier, fetchImpl: fetch, sleepFn: fakeSleep });
    await expect(brain.step(baseGoal, [{ role: 'context', content: 'sys' }], tools, ctx)).rejects.toThrow(
      /403/,
    );
    expect(calls).toHaveLength(1);
    expect(fakeSleep).not.toHaveBeenCalled();
  });

  it('throws immediately on 404 (invalid model id) with zero retries', async () => {
    const fakeSleep = vi.fn(async (_ms: number) => {});
    const { fetch, calls } = stubFetch(errorResponse(404, 'model not found'));
    const brain = new LlmBrain({ baseUrl: BASE, apiKey: KEY, modelByTier, fetchImpl: fetch, sleepFn: fakeSleep });
    await expect(brain.step(baseGoal, [{ role: 'context', content: 'sys' }], tools, ctx)).rejects.toThrow(
      /404/,
    );
    expect(calls).toHaveLength(1);
    expect(fakeSleep).not.toHaveBeenCalled();
  });

  it('treats unknown status codes as terminal (no retries)', async () => {
    const fakeSleep = vi.fn(async (_ms: number) => {});
    const { fetch, calls } = stubFetch(errorResponse(418, "I'm a teapot"));
    const brain = new LlmBrain({ baseUrl: BASE, apiKey: KEY, modelByTier, fetchImpl: fetch, sleepFn: fakeSleep });
    await expect(brain.step(baseGoal, [{ role: 'context', content: 'sys' }], tools, ctx)).rejects.toThrow(
      /418/,
    );
    expect(calls).toHaveLength(1);
    expect(fakeSleep).not.toHaveBeenCalled();
  });

  it('error message names the terminal cause (status code + body excerpt)', async () => {
    const { fetch } = stubFetch(errorResponse(401, 'API key revoked'));
    const brain = new LlmBrain({ baseUrl: BASE, apiKey: KEY, modelByTier, fetchImpl: fetch });
    const err = await brain.step(baseGoal, [{ role: 'context', content: 'sys' }], tools, ctx).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain('401');
  });
});
