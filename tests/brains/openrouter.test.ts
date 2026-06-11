/**
 * Tests for openRouterConfig and the typeCatalog integration in LlmBrain.
 * No network calls are made — all LlmBrain tests inject a fetchImpl stub.
 */

import { describe, it, expect, vi } from 'vitest';
import { openRouterConfig } from '../../src/brains/openrouter.js';
import { LlmBrain } from '../../src/brains/llm.js';
import type { Goal } from '../../src/contract/goal.js';
import type { BrainContext } from '../../src/contract/brain.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type FetchCall = { url: string; options: RequestInit };

function stubFetch(...bodies: unknown[]): { fetch: typeof fetch; calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  let idx = 0;
  const mockFetch = vi.fn(async (url: string | URL | Request, options?: RequestInit) => {
    calls.push({ url: String(url), options: options ?? {} });
    const body = bodies[Math.min(idx++, bodies.length - 1)];
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return { fetch: mockFetch, calls };
}

function chatResponse(content: string) {
  return { choices: [{ message: { role: 'assistant', content } }] };
}

const baseGoal: Goal = {
  id: 'g1',
  type: 'deliver-intent',
  parentId: null,
  title: 'Ship a word-count CLI',
  spec: { description: 'wc.mjs that prints word count of its argument' },
  intent: 'production',
  scope: ['out/live/'],
  budget: { attempts: 3, tokens: 50_000, toolCalls: 100, wallClockMs: 60_000 },
  memories: [],
};

const ctxSonnet: BrainContext = { tier: 'sonnet', memories: [] };

// ---------------------------------------------------------------------------
// openRouterConfig — config parsing
// ---------------------------------------------------------------------------

describe('openRouterConfig', () => {
  it('throws a clear, actionable error when OPENROUTER_API_KEY is absent', () => {
    expect(() => openRouterConfig({})).toThrow(/OPENROUTER_API_KEY/);
    // The error message should tell the user what to do.
    expect(() => openRouterConfig({})).toThrow(/export/i);
  });

  it('returns the key from the env when present', () => {
    const cfg = openRouterConfig({ OPENROUTER_API_KEY: 'sk-or-test-key' });
    expect(cfg.apiKey).toBe('sk-or-test-key');
  });

  it('uses OpenRouter baseUrl', () => {
    const cfg = openRouterConfig({ OPENROUTER_API_KEY: 'k' });
    expect(cfg.baseUrl).toBe('https://openrouter.ai/api/v1');
  });

  it('uses default haiku model when override is absent', () => {
    const cfg = openRouterConfig({ OPENROUTER_API_KEY: 'k' });
    expect(cfg.modelByTier['haiku']).toMatch(/anthropic\/claude-haiku/);
  });

  it('uses default sonnet model when override is absent', () => {
    const cfg = openRouterConfig({ OPENROUTER_API_KEY: 'k' });
    expect(cfg.modelByTier['sonnet']).toMatch(/anthropic\/claude-sonnet/);
  });

  it('uses default opus model when override is absent', () => {
    const cfg = openRouterConfig({ OPENROUTER_API_KEY: 'k' });
    expect(cfg.modelByTier['opus']).toMatch(/anthropic\/claude-opus/);
  });

  it('env override wins for haiku tier', () => {
    const cfg = openRouterConfig({
      OPENROUTER_API_KEY: 'k',
      CORELLIA_MODEL_HAIKU: 'anthropic/claude-haiku-custom',
    });
    expect(cfg.modelByTier['haiku']).toBe('anthropic/claude-haiku-custom');
  });

  it('env override wins for sonnet tier', () => {
    const cfg = openRouterConfig({
      OPENROUTER_API_KEY: 'k',
      CORELLIA_MODEL_SONNET: 'anthropic/claude-sonnet-custom',
    });
    expect(cfg.modelByTier['sonnet']).toBe('anthropic/claude-sonnet-custom');
  });

  it('env override wins for opus tier', () => {
    const cfg = openRouterConfig({
      OPENROUTER_API_KEY: 'k',
      CORELLIA_MODEL_OPUS: 'anthropic/claude-opus-custom',
    });
    expect(cfg.modelByTier['opus']).toBe('anthropic/claude-opus-custom');
  });

  it('all three tier overrides can coexist', () => {
    const cfg = openRouterConfig({
      OPENROUTER_API_KEY: 'k',
      CORELLIA_MODEL_HAIKU: 'h-override',
      CORELLIA_MODEL_SONNET: 's-override',
      CORELLIA_MODEL_OPUS: 'o-override',
    });
    expect(cfg.modelByTier).toEqual({
      haiku: 'h-override',
      sonnet: 's-override',
      opus: 'o-override',
    });
  });
});

// ---------------------------------------------------------------------------
// LlmBrain + typeCatalog — catalog appears in decide prompt
// ---------------------------------------------------------------------------

describe('LlmBrain typeCatalog in decide', () => {
  it('includes type names in the user message when typeCatalog is supplied', async () => {
    const { fetch, calls } = stubFetch(chatResponse(JSON.stringify({ kind: 'satisfy' })));
    const cfg = openRouterConfig({ OPENROUTER_API_KEY: 'test-key' });
    const brain = new LlmBrain({ ...cfg, fetchImpl: fetch }, ['implement', 'freeze-contract', 'critique-code']);
    await brain.decide(baseGoal, ctxSonnet);
    const body = JSON.parse(calls[0]?.options.body as string) as { messages: { role: string; content: string }[] };
    const userMsg = body.messages.find((m) => m.role === 'user')?.content ?? '';
    expect(userMsg).toContain('implement');
    expect(userMsg).toContain('freeze-contract');
    expect(userMsg).toContain('critique-code');
  });

  it('notes that children must use catalog types', async () => {
    const { fetch, calls } = stubFetch(chatResponse(JSON.stringify({ kind: 'satisfy' })));
    const cfg = openRouterConfig({ OPENROUTER_API_KEY: 'test-key' });
    const brain = new LlmBrain({ ...cfg, fetchImpl: fetch }, ['implement']);
    await brain.decide(baseGoal, ctxSonnet);
    const body = JSON.parse(calls[0]?.options.body as string) as { messages: { role: string; content: string }[] };
    const userMsg = body.messages.find((m) => m.role === 'user')?.content ?? '';
    // The prompt should tell the model types are constrained.
    expect(userMsg).toMatch(/AVAILABLE GOAL TYPES|must use one of/i);
  });

  it('notes that dependsOn must reference sibling localIds', async () => {
    const { fetch, calls } = stubFetch(chatResponse(JSON.stringify({ kind: 'satisfy' })));
    const cfg = openRouterConfig({ OPENROUTER_API_KEY: 'test-key' });
    const brain = new LlmBrain({ ...cfg, fetchImpl: fetch }, ['implement']);
    await brain.decide(baseGoal, ctxSonnet);
    const body = JSON.parse(calls[0]?.options.body as string) as { messages: { role: string; content: string }[] };
    const userMsg = body.messages.find((m) => m.role === 'user')?.content ?? '';
    expect(userMsg).toContain('dependsOn');
    expect(userMsg).toContain('localId');
  });

  it('does not emit the AVAILABLE GOAL TYPES section when catalog is empty', async () => {
    const { fetch, calls } = stubFetch(chatResponse(JSON.stringify({ kind: 'satisfy' })));
    const cfg = openRouterConfig({ OPENROUTER_API_KEY: 'test-key' });
    const brain = new LlmBrain({ ...cfg, fetchImpl: fetch });
    await brain.decide(baseGoal, ctxSonnet);
    const body = JSON.parse(calls[0]?.options.body as string) as { messages: { role: string; content: string }[] };
    const userMsg = body.messages.find((m) => m.role === 'user')?.content ?? '';
    expect(userMsg).not.toContain('AVAILABLE GOAL TYPES');
  });
});

// ---------------------------------------------------------------------------
// Artifact JSON parsing roundtrip — produce returns parsed file blocks
// ---------------------------------------------------------------------------

describe('LlmBrain produce artifact JSON roundtrip', () => {
  it('parses a single fenced file block into a files artifact', async () => {
    const content = '```out/live/wc.mjs\nconsole.log(0);\n```';
    const { fetch } = stubFetch(chatResponse(content));
    const cfg = openRouterConfig({ OPENROUTER_API_KEY: 'test-key' });
    const brain = new LlmBrain({ ...cfg, fetchImpl: fetch });
    const { value: artifact } = await brain.produce(baseGoal, ctxSonnet);
    expect(artifact.kind).toBe('files');
    expect(artifact.files).toHaveLength(1);
    expect(artifact.files?.[0]?.path).toBe('out/live/wc.mjs');
    expect(artifact.files?.[0]?.content).toContain('console.log(0)');
  });

  it('roundtrips multiple file blocks faithfully', async () => {
    const content =
      '```out/live/wc.mjs\nconsole.log(1);\n```\n' +
      '```out/live/util.mjs\nexport const x = 2;\n```';
    const { fetch } = stubFetch(chatResponse(content));
    const cfg = openRouterConfig({ OPENROUTER_API_KEY: 'test-key' });
    const brain = new LlmBrain({ ...cfg, fetchImpl: fetch });
    const { value: artifact } = await brain.produce(baseGoal, ctxSonnet);
    expect(artifact.kind).toBe('files');
    expect(artifact.files).toHaveLength(2);
    expect(artifact.files?.[0]?.path).toBe('out/live/wc.mjs');
    expect(artifact.files?.[1]?.path).toBe('out/live/util.mjs');
  });

  it('falls back to text artifact when no fenced blocks are present', async () => {
    const { fetch } = stubFetch(chatResponse('word count implementation notes'));
    const cfg = openRouterConfig({ OPENROUTER_API_KEY: 'test-key' });
    const brain = new LlmBrain({ ...cfg, fetchImpl: fetch });
    const { value: artifact } = await brain.produce(baseGoal, ctxSonnet);
    expect(artifact.kind).toBe('text');
    expect(artifact.text).toContain('word count');
  });
});

// ---------------------------------------------------------------------------
// Judge prompt demands explicit Verdict shape
// ---------------------------------------------------------------------------

describe('LlmBrain judge prompt shape', () => {
  it('includes the pass field example in the judge prompt', async () => {
    const verdict = { pass: true, findings: [] };
    const { fetch, calls } = stubFetch(chatResponse(JSON.stringify(verdict)));
    const cfg = openRouterConfig({ OPENROUTER_API_KEY: 'test-key' });
    const brain = new LlmBrain({ ...cfg, fetchImpl: fetch });
    const artifact = { kind: 'files' as const, files: [{ path: 'out/live/wc.mjs', content: 'x' }] };
    await brain.judge(baseGoal, artifact, 'must count words', ctxSonnet);
    const body = JSON.parse(calls[0]?.options.body as string) as { messages: { role: string; content: string }[] };
    const userMsg = body.messages.find((m) => m.role === 'user')?.content ?? '';
    // The prompt should show the JSON shape with "pass", "findings", dimension, severity.
    expect(userMsg).toContain('"pass"');
    expect(userMsg).toContain('"findings"');
    expect(userMsg).toContain('"dimension"');
    expect(userMsg).toContain('"severity"');
    expect(userMsg).toContain('"gating"');
  });

  it('includes file content in the subject section', async () => {
    const verdict = { pass: true, findings: [] };
    const { fetch, calls } = stubFetch(chatResponse(JSON.stringify(verdict)));
    const cfg = openRouterConfig({ OPENROUTER_API_KEY: 'test-key' });
    const brain = new LlmBrain({ ...cfg, fetchImpl: fetch });
    const artifact = { kind: 'files' as const, files: [{ path: 'out/live/wc.mjs', content: 'console.log(42);' }] };
    await brain.judge(baseGoal, artifact, 'rubric', ctxSonnet);
    const body = JSON.parse(calls[0]?.options.body as string) as { messages: { role: string; content: string }[] };
    const userMsg = body.messages.find((m) => m.role === 'user')?.content ?? '';
    // File content should appear in the judge prompt so the model can actually evaluate it.
    expect(userMsg).toContain('console.log(42)');
  });
});
