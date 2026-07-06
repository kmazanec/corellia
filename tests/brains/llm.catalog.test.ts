/**
 * Tests for the catalog seam in LlmBrain (ADR-044): a call resolves
 * `(tier, needs) → ModelSpec` and uses the spec's id, endpoint (baseUrl/apiKey),
 * and provider pin at the fetch site. Also verifies the legacy `modelByTier`-only
 * config still works (synthetic catalog). No network — fetch is stubbed.
 */

import { describe, it, expect, vi } from 'vitest';
import { LlmBrain, type LlmBrainConfig } from '../../src/brains/llm.js';
import type { ModelSpec } from '../../src/brains/model-catalog.js';
import type { Goal } from '../../src/contract/goal.js';
import type { BrainContext } from '../../src/contract/brain.js';
import type { ToolDef } from '../../src/contract/tool.js';

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

function chatResponse(content: string) {
  return { choices: [{ message: { role: 'assistant', content } }] };
}

const baseGoal: Goal = {
  id: 'g1',
  type: 'implement',
  parentId: null,
  title: 'Build something',
  spec: {},
  intent: 'production',
  scope: ['src/'],
  budget: { attempts: 3, tokens: 10_000, toolCalls: 20, wallClockMs: 120_000 },
  memories: [],
};

const tools: ToolDef[] = [
  {
    name: 'read_file',
    description: 'Read a file',
    parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
  },
];

function catalog(...specs: ModelSpec[]): ModelSpec[] {
  return specs;
}

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

const cfg = (over: Partial<LlmBrainConfig>): LlmBrainConfig => ({
  baseUrl: 'https://default.test/v1',
  apiKey: 'default-key',
  modelByTier: { low: 'legacy-low', mid: 'legacy-mid', high: 'legacy-high' },
  ...over,
});

describe('LlmBrain catalog resolution — pin precedence', () => {
  it('a pin present in the catalog and satisfying needs wins over cheapest-in-band', async () => {
    const { fetch, calls } = stubFetch(chatResponse('done'));
    const brain = new LlmBrain(
      cfg({
        fetchImpl: fetch,
        // modelByTier.mid pins 'mid/dear'; 'mid/cheap' is cheaper in the same band.
        modelByTier: { low: 'legacy-low', mid: 'mid/dear', high: 'legacy-high' },
        catalog: catalog(
          baseSpec({ id: 'mid/cheap', capability: 5, costInPerMtok: 0.1, costOutPerMtok: 0.1 }),
          baseSpec({ id: 'mid/dear', capability: 5, costInPerMtok: 9, costOutPerMtok: 9 }),
        ),
      }),
    );
    await brain.produce(baseGoal, { tier: 'mid', memories: [] });
    const body = JSON.parse(calls[0]!.options.body as string);
    expect(body.model).toBe('mid/dear'); // the pin, not the cheaper model
  });

  it('a needs-violating pin falls through to catalog resolution', async () => {
    const { fetch, calls } = stubFetch(chatResponse(JSON.stringify({ pass: true, findings: [] })));
    const brain = new LlmBrain(
      cfg({
        fetchImpl: fetch,
        // Pin a NON-vision model; a vision need must bypass it, not honour it.
        modelByTier: { low: 'legacy-low', mid: 'mid/blind-pin', high: 'legacy-high' },
        catalog: catalog(
          baseSpec({ id: 'mid/blind-pin', capability: 5, vision: false }),
          baseSpec({ id: 'high/sees', capability: 8, vision: true }),
        ),
      }),
    );
    const ctx: BrainContext = { tier: 'mid', memories: [], needs: { vision: true } };
    const artifact = { kind: 'files' as const, files: [{ path: 'x', content: 'y' }] };
    await brain.judge(baseGoal, artifact, 'rubric', ctx);
    const body = JSON.parse(calls[0]!.options.body as string);
    expect(body.model).toBe('high/sees'); // pin failed needs → resolveModel took over
  });

  it('falls through to cheapest-in-band when the pin is not a catalog entry', async () => {
    const { fetch, calls } = stubFetch(chatResponse('done'));
    const brain = new LlmBrain(
      cfg({
        fetchImpl: fetch,
        // modelByTier.mid ('legacy-mid') is absent from the catalog → no pin to honour.
        catalog: catalog(
          baseSpec({ id: 'mid/pick', capability: 5 }),
          baseSpec({ id: 'high/pick', capability: 9 }),
        ),
      }),
    );
    await brain.produce(baseGoal, { tier: 'mid', memories: [] });
    const body = JSON.parse(calls[0]!.options.body as string);
    expect(body.model).toBe('mid/pick');
  });
});

describe('LlmBrain catalog resolution — model id on the wire', () => {
  it('routes a vision need to the vision-capable model even when it bands above', async () => {
    const { fetch, calls } = stubFetch(chatResponse(JSON.stringify({ pass: true, findings: [] })));
    const brain = new LlmBrain(
      cfg({
        fetchImpl: fetch,
        catalog: catalog(
          baseSpec({ id: 'mid/blind', capability: 5, vision: false }),
          baseSpec({ id: 'high/sees', capability: 8, vision: true }),
        ),
      }),
    );
    const ctx: BrainContext = { tier: 'mid', memories: [], needs: { vision: true } };
    const artifact = { kind: 'files' as const, files: [{ path: 'x', content: 'y' }] };
    await brain.judge(baseGoal, artifact, 'rubric', ctx);
    const body = JSON.parse(calls[0]!.options.body as string);
    expect(body.model).toBe('high/sees');
  });
});

describe('LlmBrain catalog resolution — per-model endpoint override', () => {
  it('a step on a model with its own endpoint hits that baseUrl with its own key', async () => {
    const { fetch, calls } = stubFetch(chatResponse('done'));
    const brain = new LlmBrain(
      cfg({
        fetchImpl: fetch,
        catalog: catalog(
          baseSpec({
            id: 'local/llama',
            capability: 5,
            endpoint: { baseUrl: 'http://localhost:11434/v1', apiKeyEnv: 'LOCAL_KEY' },
          }),
        ),
      }),
    );
    process.env['LOCAL_KEY'] = 'local-secret';
    const ctx: BrainContext = { tier: 'mid', memories: [] };
    await brain.step(baseGoal, [{ role: 'context', content: 'sys' }], tools, ctx);
    delete process.env['LOCAL_KEY'];

    expect(calls[0]!.url).toBe('http://localhost:11434/v1/chat/completions');
    const auth = (calls[0]!.options.headers as Record<string, string>)['Authorization'];
    expect(auth).toBe('Bearer local-secret');
  });

  it('a model without an endpoint override uses the brain default baseUrl and key', async () => {
    const { fetch, calls } = stubFetch(chatResponse('done'));
    const brain = new LlmBrain(
      cfg({ fetchImpl: fetch, catalog: catalog(baseSpec({ id: 'default/model', capability: 5 })) }),
    );
    const ctx: BrainContext = { tier: 'mid', memories: [] };
    await brain.step(baseGoal, [{ role: 'context', content: 'sys' }], tools, ctx);
    expect(calls[0]!.url).toBe('https://default.test/v1/chat/completions');
    const auth = (calls[0]!.options.headers as Record<string, string>)['Authorization'];
    expect(auth).toBe('Bearer default-key');
  });
});

describe('LlmBrain catalog resolution — provider pin from the spec', () => {
  it("a step includes the spec's provider pin on the wire", async () => {
    const { fetch, calls } = stubFetch(chatResponse('done'));
    const brain = new LlmBrain(
      cfg({
        fetchImpl: fetch,
        catalog: catalog(
          baseSpec({ id: 'pinned/model', capability: 5, provider: { order: ['DeepSeek'], allow_fallbacks: false } }),
        ),
      }),
    );
    const ctx: BrainContext = { tier: 'mid', memories: [] };
    await brain.step(baseGoal, [{ role: 'context', content: 'sys' }], tools, ctx);
    const body = JSON.parse(calls[0]!.options.body as string);
    expect(body.provider).toEqual({ order: ['DeepSeek'], allow_fallbacks: false });
  });

  it('falls back to providerByTier when the spec pins no provider', async () => {
    const { fetch, calls } = stubFetch(chatResponse('done'));
    const brain = new LlmBrain(
      cfg({
        fetchImpl: fetch,
        catalog: catalog(baseSpec({ id: 'unpinned/model', capability: 5 })),
        providerByTier: { mid: { order: ['Anthropic'], allow_fallbacks: true } },
      }),
    );
    const ctx: BrainContext = { tier: 'mid', memories: [] };
    await brain.step(baseGoal, [{ role: 'context', content: 'sys' }], tools, ctx);
    const body = JSON.parse(calls[0]!.options.body as string);
    expect(body.provider).toEqual({ order: ['Anthropic'], allow_fallbacks: true });
  });
});

describe('LlmBrain legacy modelByTier-only config (no catalog)', () => {
  it('resolves each tier to its modelByTier entry via the synthetic catalog', async () => {
    const { fetch, calls } = stubFetch(chatResponse('done'));
    const brain = new LlmBrain(cfg({ fetchImpl: fetch })); // no catalog
    await brain.produce(baseGoal, { tier: 'high', memories: [] });
    const body = JSON.parse(calls[0]!.options.body as string);
    expect(body.model).toBe('legacy-high');
  });
});
