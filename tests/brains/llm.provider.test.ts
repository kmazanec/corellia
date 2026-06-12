/**
 * Tests for F-64 Chunk 1: per-tier provider routing field on step requests.
 *
 * Verifies that buildStepRequest (via LlmBrain.step) correctly includes or
 * omits the `provider` field depending on whether LlmBrainConfig.providerByTier
 * carries config for the active tier. Uses the same stubFetch pattern as
 * llm.step.test.ts — no network calls are made.
 *
 * AC 1: StepRequest carries `provider` from per-tier binding config; absent
 * config → field absent (wire-compatible).
 * AC 2: scripted test shows field serialized correctly per tier.
 */

import { describe, it, expect, vi } from 'vitest';
import { LlmBrain } from '../../src/brains/llm.js';
import type { Goal } from '../../src/contract/goal.js';
import type { BrainContext } from '../../src/contract/brain.js';
import type { ToolDef } from '../../src/contract/tool.js';

// ---------------------------------------------------------------------------
// Helpers — same stubFetch pattern as llm.step.test.ts
// ---------------------------------------------------------------------------

type FetchCall = { url: string; options: RequestInit };

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

function contentResponse(content: string) {
  return {
    choices: [{ message: { role: 'assistant', content } }],
  };
}

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const BASE = 'https://api.test.com/v1';
const KEY = 'test-key';
const modelByTier = { low: 'low-m', mid: 'mid-m', high: 'high-m' };

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

const tools: ToolDef[] = [
  {
    name: 'read_file',
    description: 'Read a file',
    parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
  },
];

// ---------------------------------------------------------------------------
// AC 1 + AC 2: provider field present when tier config set
// ---------------------------------------------------------------------------

describe('provider field — present when providerByTier config set for active tier', () => {
  it('includes provider.order and provider.allow_fallbacks on the wire body for mid tier', async () => {
    const { fetch, calls } = stubFetch({ status: 200, body: contentResponse('done') });
    const brain = new LlmBrain({
      baseUrl: BASE,
      apiKey: KEY,
      modelByTier,
      fetchImpl: fetch,
      providerByTier: {
        mid: { order: ['DeepSeek'], allow_fallbacks: false },
      },
    });
    const ctx: BrainContext = { tier: 'mid', memories: [] };
    await brain.step(baseGoal, [{ role: 'context', content: 'sys' }], tools, ctx);

    const body = JSON.parse(calls[0]!.options.body as string);
    expect(body.provider).toBeDefined();
    expect(body.provider.order).toEqual(['DeepSeek']);
    expect(body.provider.allow_fallbacks).toBe(false);
  });

  it('includes provider config for low tier when configured', async () => {
    const { fetch, calls } = stubFetch({ status: 200, body: contentResponse('done') });
    const brain = new LlmBrain({
      baseUrl: BASE,
      apiKey: KEY,
      modelByTier,
      fetchImpl: fetch,
      providerByTier: {
        low: { order: ['Anthropic', 'OpenAI'], allow_fallbacks: true },
      },
    });
    const ctx: BrainContext = { tier: 'low', memories: [] };
    await brain.step(baseGoal, [{ role: 'context', content: 'sys' }], tools, ctx);

    const body = JSON.parse(calls[0]!.options.body as string);
    expect(body.provider).toBeDefined();
    expect(body.provider.order).toEqual(['Anthropic', 'OpenAI']);
    expect(body.provider.allow_fallbacks).toBe(true);
  });

  it('includes provider config for high tier when configured', async () => {
    const { fetch, calls } = stubFetch({ status: 200, body: contentResponse('done') });
    const brain = new LlmBrain({
      baseUrl: BASE,
      apiKey: KEY,
      modelByTier,
      fetchImpl: fetch,
      providerByTier: {
        high: { order: ['Qwen'], allow_fallbacks: false },
      },
    });
    const ctx: BrainContext = { tier: 'high', memories: [] };
    await brain.step(baseGoal, [{ role: 'context', content: 'sys' }], tools, ctx);

    const body = JSON.parse(calls[0]!.options.body as string);
    expect(body.provider).toBeDefined();
    expect(body.provider.order).toEqual(['Qwen']);
    expect(body.provider.allow_fallbacks).toBe(false);
  });

  it('serializes allow_fallbacks=false correctly (not truthy coercion)', async () => {
    const { fetch, calls } = stubFetch({ status: 200, body: contentResponse('done') });
    const brain = new LlmBrain({
      baseUrl: BASE,
      apiKey: KEY,
      modelByTier,
      fetchImpl: fetch,
      providerByTier: {
        mid: { order: ['DeepSeek'], allow_fallbacks: false },
      },
    });
    const ctx: BrainContext = { tier: 'mid', memories: [] };
    await brain.step(baseGoal, [{ role: 'context', content: 'sys' }], tools, ctx);

    const rawBody = calls[0]!.options.body as string;
    // The JSON must literally contain `"allow_fallbacks":false`
    expect(rawBody).toContain('"allow_fallbacks":false');
  });
});

// ---------------------------------------------------------------------------
// AC 1: provider field absent when no providerByTier config
// ---------------------------------------------------------------------------

describe('provider field — absent when no providerByTier config (wire-compatible)', () => {
  it('omits provider field when LlmBrainConfig has no providerByTier', async () => {
    const { fetch, calls } = stubFetch({ status: 200, body: contentResponse('done') });
    const brain = new LlmBrain({
      baseUrl: BASE,
      apiKey: KEY,
      modelByTier,
      fetchImpl: fetch,
      // No providerByTier
    });
    const ctx: BrainContext = { tier: 'mid', memories: [] };
    await brain.step(baseGoal, [{ role: 'context', content: 'sys' }], tools, ctx);

    const body = JSON.parse(calls[0]!.options.body as string);
    expect(body.provider).toBeUndefined();
  });

  it('omits provider field when providerByTier exists but does not include the active tier', async () => {
    const { fetch, calls } = stubFetch({ status: 200, body: contentResponse('done') });
    const brain = new LlmBrain({
      baseUrl: BASE,
      apiKey: KEY,
      modelByTier,
      fetchImpl: fetch,
      // Only mid tier configured; using low tier should omit field
      providerByTier: {
        mid: { order: ['DeepSeek'], allow_fallbacks: false },
      },
    });
    const ctx: BrainContext = { tier: 'low', memories: [] };
    await brain.step(baseGoal, [{ role: 'context', content: 'sys' }], tools, ctx);

    const body = JSON.parse(calls[0]!.options.body as string);
    expect(body.provider).toBeUndefined();
  });

  it('omits provider field when using high tier but only mid is configured', async () => {
    const { fetch, calls } = stubFetch({ status: 200, body: contentResponse('done') });
    const brain = new LlmBrain({
      baseUrl: BASE,
      apiKey: KEY,
      modelByTier,
      fetchImpl: fetch,
      providerByTier: {
        mid: { order: ['DeepSeek'], allow_fallbacks: false },
      },
    });
    const ctx: BrainContext = { tier: 'high', memories: [] };
    await brain.step(baseGoal, [{ role: 'context', content: 'sys' }], tools, ctx);

    const body = JSON.parse(calls[0]!.options.body as string);
    expect(body.provider).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Provider field preserved across malformation re-prompt
// ---------------------------------------------------------------------------

describe('provider field — preserved on malformation re-prompt', () => {
  it('re-prompt request also carries provider field when tier config is set', async () => {
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
      { status: 200, body: contentResponse('recovered') },
    );
    const brain = new LlmBrain({
      baseUrl: BASE,
      apiKey: KEY,
      modelByTier,
      fetchImpl: fetch,
      providerByTier: {
        mid: { order: ['DeepSeek'], allow_fallbacks: false },
      },
    });
    const ctx: BrainContext = { tier: 'mid', memories: [] };
    await brain.step(baseGoal, [{ role: 'context', content: 'sys' }], tools, ctx);

    expect(calls).toHaveLength(2);
    // Both the initial call and the re-prompt carry the provider field.
    const initialBody = JSON.parse(calls[0]!.options.body as string);
    const repromptBody = JSON.parse(calls[1]!.options.body as string);
    expect(initialBody.provider).toEqual({ order: ['DeepSeek'], allow_fallbacks: false });
    expect(repromptBody.provider).toEqual({ order: ['DeepSeek'], allow_fallbacks: false });
  });
});
