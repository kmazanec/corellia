/**
 * Tests for Anthropic-direct provider selection:
 *  - the catalog rewrite (applyAnthropicDirect): key present → Anthropic-family
 *    rows route direct; key absent → everything unchanged.
 *  - the id translation and row-matching rules.
 *  - end-to-end through openRouterConfig + LlmBrain with an injected fetch: an
 *    Anthropic-family call hits api.anthropic.com with x-api-key when the key is
 *    set, and hits OpenRouter with a bearer token when it is not.
 * No network — fetch is stubbed everywhere.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  applyAnthropicDirect,
  isAnthropicRow,
  directModelId,
  ANTHROPIC_DIRECT_BASE_URL,
} from '../../src/brains/anthropic-provider.js';
import type { AssembledCatalog, ModelSpec } from '../../src/brains/model-catalog.js';
import { openRouterConfig } from '../../src/brains/openrouter.js';
import { LlmBrain } from '../../src/brains/llm.js';
import type { Goal } from '../../src/contract/goal.js';
import type { BrainContext } from '../../src/contract/brain.js';

function baseSpec(overrides: Partial<ModelSpec> & { id: string }): ModelSpec {
  return {
    capability: 5,
    costInPerMtok: 1,
    costOutPerMtok: 1,
    context: 200_000,
    vision: false,
    toolCalling: 'strong',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// id translation + row matching
// ---------------------------------------------------------------------------

describe('directModelId', () => {
  it('strips the anthropic/ namespace and turns version dots into dashes', () => {
    expect(directModelId('anthropic/claude-opus-4.8')).toBe('claude-opus-4-8');
    expect(directModelId('anthropic/claude-haiku-4.5')).toBe('claude-haiku-4-5');
    expect(directModelId('anthropic/claude-sonnet-4.5')).toBe('claude-sonnet-4-5');
  });
});

describe('isAnthropicRow', () => {
  it('matches an anthropic/-namespaced row with no endpoint or wire override', () => {
    expect(isAnthropicRow(baseSpec({ id: 'anthropic/claude-opus-4.8' }))).toBe(true);
  });

  it('does not match a non-anthropic row', () => {
    expect(isAnthropicRow(baseSpec({ id: 'deepseek/deepseek-v4-pro' }))).toBe(false);
    expect(isAnthropicRow(baseSpec({ id: 'z-ai/glm-5.2' }))).toBe(false);
  });

  it('leaves an operator override (explicit endpoint or wire) untouched', () => {
    expect(
      isAnthropicRow(baseSpec({ id: 'anthropic/claude-opus-4.8', endpoint: { baseUrl: 'http://local' } })),
    ).toBe(false);
    expect(isAnthropicRow(baseSpec({ id: 'anthropic/claude-opus-4.8', wire: 'openai' }))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// applyAnthropicDirect — the catalog rewrite
// ---------------------------------------------------------------------------

function assembled(catalog: ModelSpec[], pins: AssembledCatalog['pins']): AssembledCatalog {
  return { catalog, pins };
}

describe('applyAnthropicDirect', () => {
  it('is a no-op when ANTHROPIC_API_KEY is absent', () => {
    const input = assembled(
      [baseSpec({ id: 'anthropic/claude-opus-4.8' }), baseSpec({ id: 'z-ai/glm-5.2' })],
      { low: 'z-ai/glm-5.2', mid: 'z-ai/glm-5.2', high: 'z-ai/glm-5.2' },
    );
    const out = applyAnthropicDirect(input, {});
    expect(out).toBe(input); // same reference — untouched
  });

  it('is a no-op when ANTHROPIC_API_KEY is empty', () => {
    const input = assembled([baseSpec({ id: 'anthropic/claude-opus-4.8' })], {
      low: 'anthropic/claude-opus-4.8',
      mid: 'anthropic/claude-opus-4.8',
      high: 'anthropic/claude-opus-4.8',
    });
    expect(applyAnthropicDirect(input, { ANTHROPIC_API_KEY: '' })).toBe(input);
  });

  it('rewrites anthropic rows to the direct wire + endpoint when the key is set', () => {
    const input = assembled(
      [baseSpec({ id: 'anthropic/claude-opus-4.8' }), baseSpec({ id: 'z-ai/glm-5.2' })],
      { low: 'z-ai/glm-5.2', mid: 'z-ai/glm-5.2', high: 'z-ai/glm-5.2' },
    );
    const { catalog } = applyAnthropicDirect(input, { ANTHROPIC_API_KEY: 'sk-ant' });

    const opus = catalog.find((s) => s.id === 'claude-opus-4-8');
    expect(opus).toBeDefined();
    expect(opus?.wire).toBe('anthropic');
    expect(opus?.endpoint).toEqual({ baseUrl: ANTHROPIC_DIRECT_BASE_URL, apiKeyEnv: 'ANTHROPIC_API_KEY' });

    // The non-anthropic row is untouched.
    const glm = catalog.find((s) => s.id === 'z-ai/glm-5.2');
    expect(glm?.wire).toBeUndefined();
    expect(glm?.endpoint).toBeUndefined();
  });

  it('preserves the cost/capability/vision tags of a rewritten row', () => {
    const input = assembled(
      [baseSpec({ id: 'anthropic/claude-opus-4.8', capability: 10, costInPerMtok: 5, costOutPerMtok: 25, vision: true })],
      { low: 'x', mid: 'x', high: 'anthropic/claude-opus-4.8' },
    );
    const { catalog } = applyAnthropicDirect(input, { ANTHROPIC_API_KEY: 'k' });
    const opus = catalog.find((s) => s.id === 'claude-opus-4-8');
    expect(opus?.capability).toBe(10);
    expect(opus?.costInPerMtok).toBe(5);
    expect(opus?.costOutPerMtok).toBe(25);
    expect(opus?.vision).toBe(true);
  });

  it('remaps a pin that named a rewritten anthropic id to the direct id', () => {
    const input = assembled([baseSpec({ id: 'anthropic/claude-opus-4.8' })], {
      low: 'x',
      mid: 'x',
      high: 'anthropic/claude-opus-4.8',
    });
    const { pins } = applyAnthropicDirect(input, { ANTHROPIC_API_KEY: 'k' });
    expect(pins.high).toBe('claude-opus-4-8');
    expect(pins.low).toBe('x'); // unrelated pin unchanged
  });
});

// ---------------------------------------------------------------------------
// End-to-end through openRouterConfig + LlmBrain (injected fetch)
// ---------------------------------------------------------------------------

type FetchCall = { url: string; options: RequestInit };

function stubFetch(...bodies: unknown[]): { fetch: typeof fetch; calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  let idx = 0;
  const fetch = vi.fn(async (url: string | URL | Request, options?: RequestInit) => {
    calls.push({ url: String(url), options: options ?? {} });
    const body = bodies[Math.min(idx++, bodies.length - 1)];
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return { fetch, calls };
}

/** An Anthropic Messages API response carrying a plain text block. */
function anthropicText(text: string) {
  return { content: [{ type: 'text', text }], stop_reason: 'end_turn', usage: { input_tokens: 5, output_tokens: 3 } };
}

/** An OpenAI chat-completions response carrying plain text. */
function openAiText(content: string) {
  return { choices: [{ message: { role: 'assistant', content } }] };
}

const baseGoal: Goal = {
  id: 'g1',
  type: 'deliver-intent',
  parentId: null,
  title: 'Ship a CLI',
  spec: { description: 'a small CLI' },
  intent: 'production',
  scope: ['out/live/'],
  budget: { attempts: 3, tokens: 50_000, toolCalls: 100, wallClockMs: 60_000 },
  memories: [],
};

const ctxHigh: BrainContext = { tier: 'high', memories: [] };

describe('openRouterConfig + LlmBrain: Anthropic-direct routing', () => {
  it('with ANTHROPIC_API_KEY set, a high-band Anthropic pin resolves to api.anthropic.com with x-api-key', async () => {
    const { fetch, calls } = stubFetch(anthropicText('ok'));
    // Pin the high band to the Anthropic opus row; with the direct key set, the
    // config rewrites that row to the direct wire + endpoint.
    const cfg = openRouterConfig({
      OPENROUTER_API_KEY: 'sk-or',
      ANTHROPIC_API_KEY: 'sk-ant-secret',
      CORELLIA_MODEL_HIGH: 'anthropic/claude-opus-4.8',
    });
    // The endpoint's apiKeyEnv is read from process.env at the fetch site.
    process.env['ANTHROPIC_API_KEY'] = 'sk-ant-secret';
    const brain = new LlmBrain({ ...cfg, fetchImpl: fetch });
    await brain.produce(baseGoal, ctxHigh);
    delete process.env['ANTHROPIC_API_KEY'];

    expect(calls[0]!.url).toBe('https://api.anthropic.com/v1/messages');
    const headers = calls[0]!.options.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('sk-ant-secret');
    expect(headers['anthropic-version']).toBeDefined();
    expect(headers['Authorization']).toBeUndefined();

    const body = JSON.parse(calls[0]!.options.body as string) as { model: string; max_tokens: number };
    expect(body.model).toBe('claude-opus-4-8'); // direct id, not anthropic/…
    expect(body.max_tokens).toBeGreaterThan(0);
  });

  it('without ANTHROPIC_API_KEY, the same Anthropic pin routes through OpenRouter with a bearer token', async () => {
    const { fetch, calls } = stubFetch(openAiText('ok'));
    const cfg = openRouterConfig({
      OPENROUTER_API_KEY: 'sk-or-key',
      CORELLIA_MODEL_HIGH: 'anthropic/claude-opus-4.8',
    });
    const brain = new LlmBrain({ ...cfg, fetchImpl: fetch });
    await brain.produce(baseGoal, ctxHigh);

    expect(calls[0]!.url).toBe('https://openrouter.ai/api/v1/chat/completions');
    const headers = calls[0]!.options.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer sk-or-key');
    expect(headers['x-api-key']).toBeUndefined();

    const body = JSON.parse(calls[0]!.options.body as string) as { model: string };
    expect(body.model).toBe('anthropic/claude-opus-4.8'); // OpenRouter id, unchanged
  });

  it('a non-Anthropic band always routes through OpenRouter even with the direct key set', async () => {
    const { fetch, calls } = stubFetch(openAiText('ok'));
    // Default high band is glm-5.2 (non-anthropic); the direct key must not affect it.
    const cfg = openRouterConfig({ OPENROUTER_API_KEY: 'sk-or', ANTHROPIC_API_KEY: 'sk-ant' });
    const brain = new LlmBrain({ ...cfg, fetchImpl: fetch });
    await brain.produce(baseGoal, ctxHigh);

    expect(calls[0]!.url).toBe('https://openrouter.ai/api/v1/chat/completions');
    const body = JSON.parse(calls[0]!.options.body as string) as { model: string };
    expect(body.model).toBe('z-ai/glm-5.2');
  });
});
