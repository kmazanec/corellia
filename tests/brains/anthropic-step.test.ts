/**
 * Integration tests for LlmBrain.step over a catalog row whose `wire: 'anthropic'`
 * routes through the Anthropic Messages API codec — the same retry/timeout/backoff
 * discipline as the OpenAI path, exercised end-to-end with an injected fetch:
 *  - a tool_use response decodes to a StepOutput tool-call with the id preserved.
 *  - a 429 retries with backoff (injected sleep) and succeeds on the retry.
 *  - a network timeout retries and, on exhaustion, surfaces a transport error.
 *  - a terminal 401 throws immediately (no retries).
 *  - usage (input/output tokens) flows to the StepOutput.
 * No network — fetch is stubbed.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LlmBrain, type LlmBrainConfig } from '../../src/brains/llm.js';
import { StepTransportError } from '../../src/contract/brain.js';
import type { ModelSpec } from '../../src/brains/model-catalog.js';
import type { Goal } from '../../src/contract/goal.js';
import type { BrainContext, StepTranscript } from '../../src/contract/brain.js';
import type { ToolDef } from '../../src/contract/tool.js';

type FetchCall = { url: string; options: RequestInit };

function stubFetch(
  ...responses: Array<{ status: number; body: unknown } | { throw: Error }>
): { fetch: typeof fetch; calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  let idx = 0;
  const fetch = vi.fn(async (url: string | URL | Request, options?: RequestInit) => {
    calls.push({ url: String(url), options: options ?? {} });
    const resp = responses[Math.min(idx++, responses.length - 1)];
    if (resp && 'throw' in resp) throw resp.throw;
    const r = resp as { status: number; body: unknown };
    const body = typeof r.body === 'string' ? r.body : JSON.stringify(r.body ?? {});
    return new Response(body, { status: r.status, headers: { 'Content-Type': 'application/json' } });
  }) as unknown as typeof fetch;
  return { fetch, calls };
}

function anthropicToolUse(id: string, name: string, input: Record<string, unknown>) {
  return {
    content: [{ type: 'tool_use', id, name, input }],
    stop_reason: 'tool_use',
    usage: { input_tokens: 120, output_tokens: 15 },
  };
}

const tools: ToolDef[] = [
  {
    name: 'read_file',
    description: 'Read a file',
    parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
  },
];

/** A catalog with a single Anthropic-wire row pinned to every band. */
function anthropicCatalog(): ModelSpec[] {
  return [
    {
      id: 'claude-opus-4-8',
      capability: 8,
      costInPerMtok: 5,
      costOutPerMtok: 25,
      context: 200_000,
      vision: true,
      toolCalling: 'strong',
      wire: 'anthropic',
      endpoint: { baseUrl: 'https://api.anthropic.com/v1', apiKeyEnv: 'ANTHROPIC_API_KEY' },
    },
  ];
}

function anthropicBrain(fetch: typeof fetch, over: Partial<LlmBrainConfig> = {}): LlmBrain {
  const cfg: LlmBrainConfig = {
    baseUrl: 'https://openrouter.ai/api/v1',
    apiKey: 'sk-or',
    modelByTier: { low: 'claude-opus-4-8', mid: 'claude-opus-4-8', high: 'claude-opus-4-8' },
    catalog: anthropicCatalog(),
    fetchImpl: fetch,
    // Deterministic, instant backoff so retry tests don't spend wall-clock.
    sleepFn: async () => {},
    ...over,
  };
  return new LlmBrain(cfg);
}

const goal: Goal = {
  id: 'g1',
  type: 'implement',
  parentId: null,
  title: 'Build',
  spec: {},
  intent: 'production',
  scope: ['src/'],
  budget: { attempts: 3, tokens: 10_000, toolCalls: 20, wallClockMs: 120_000 },
  memories: [],
};
const ctx: BrainContext = { tier: 'high', memories: [] };
const transcript: StepTranscript = [{ role: 'context', content: 'system prompt' }];

describe('LlmBrain.step over the Anthropic wire', () => {
  // The direct key is read from process.env at the fetch site via endpoint.apiKeyEnv.
  beforeEach(() => {
    process.env['ANTHROPIC_API_KEY'] = 'sk-ant-test';
  });
  afterEach(() => {
    delete process.env['ANTHROPIC_API_KEY'];
  });

  it('decodes a tool_use response into a StepOutput tool-call and hits the direct endpoint', async () => {
    const { fetch, calls } = stubFetch({ status: 200, body: anthropicToolUse('toolu_1', 'read_file', { path: 'src/x.ts' }) });
    const out = await anthropicBrain(fetch).step(goal, transcript, tools, ctx);

    expect(calls[0]!.url).toBe('https://api.anthropic.com/v1/messages');
    const headers = calls[0]!.options.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('sk-ant-test');

    expect(out.kind).toBe('tool-calls');
    if (out.kind === 'tool-calls') {
      expect(out.calls).toEqual([{ id: 'toolu_1', name: 'read_file', args: { path: 'src/x.ts' } }]);
      expect(out.usage.promptTokens).toBe(120);
      expect(out.usage.completionTokens).toBe(15);
    }
  });

  it('retries a 429 with backoff and succeeds on the retry', async () => {
    const { fetch, calls } = stubFetch(
      { status: 429, body: { error: 'rate limited' } },
      { status: 200, body: anthropicToolUse('t1', 'read_file', { path: 'a' }) },
    );
    const out = await anthropicBrain(fetch).step(goal, transcript, tools, ctx);
    expect(calls).toHaveLength(2);
    expect(out.kind).toBe('tool-calls');
  });

  it('retries a network timeout and surfaces a StepTransportError on exhaustion', async () => {
    const timeout = new Error('The operation timed out');
    timeout.name = 'TimeoutError';
    const { fetch, calls } = stubFetch({ throw: timeout });
    await expect(anthropicBrain(fetch).step(goal, transcript, tools, ctx)).rejects.toBeInstanceOf(
      StepTransportError,
    );
    // One initial attempt + STEP_MAX_RETRIES (3) retries = 4 fetches.
    expect(calls.length).toBe(4);
  });

  it('throws immediately on a terminal 401 (no retries)', async () => {
    const { fetch, calls } = stubFetch({ status: 401, body: { error: 'bad key' } });
    await expect(anthropicBrain(fetch).step(goal, transcript, tools, ctx)).rejects.toThrow();
    expect(calls).toHaveLength(1);
  });
});
