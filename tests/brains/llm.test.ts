/**
 * Tests for LlmBrain: request shaping, memory quoting, JSON parsing with
 * re-ask retry, and file-block artifact parsing. No network calls are made —
 * all tests inject a fetchImpl stub.
 */

import { describe, it, expect, vi } from 'vitest';
import { LlmBrain } from '../../src/brains/llm.js';
import type { Goal } from '../../src/contract/goal.js';
import type { BrainContext } from '../../src/contract/brain.js';
import type { Artifact } from '../../src/contract/report.js';
import type { Verdict } from '../../src/contract/verdict.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type FetchCall = { url: string; options: RequestInit };

/** Build a stub fetch that returns a pre-canned sequence of JSON response bodies. */
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
  title: 'Write the widget',
  spec: { description: 'a small widget' },
  intent: 'production',
  scope: ['src/'],
  budget: { attempts: 3, tokens: 1000, toolCalls: 10, wallClockMs: 60000 },
  memories: [],
};

const ctxSonnet: BrainContext = { tier: 'sonnet', memories: [] };

const ctxWithMemories: BrainContext = {
  tier: 'sonnet',
  memories: [
    {
      id: 'm1',
      layer: 'type',
      content: 'Always write tests first.',
      provenance: 'trusted',
    },
    {
      id: 'm2',
      layer: 'global',
      content: 'Use kebab-case for file names.',
      provenance: 'provisional',
    },
  ],
};

const ctxWithPriorAttempt: BrainContext = {
  tier: 'opus',
  memories: [],
  priorAttempt: {
    artifact: null,
    verdict: {
      pass: false,
      findings: [
        {
          title: 'Missing export',
          dimension: 'spec',
          severity: 'high',
          gating: true,
          prescription: 'Export the widget function.',
        },
      ],
    },
  },
};

const modelByTier = {
  haiku: 'haiku-model',
  sonnet: 'sonnet-model',
  opus: 'opus-model',
};

// ---------------------------------------------------------------------------
// decide
// ---------------------------------------------------------------------------

describe('LlmBrain.decide', () => {
  it('sends a POST to the correct URL', async () => {
    const { fetch, calls } = stubFetch(chatResponse(JSON.stringify({ kind: 'satisfy' })));
    const brain = new LlmBrain({ baseUrl: 'https://api.example.com/v1', apiKey: 'key', modelByTier, fetchImpl: fetch });
    await brain.decide(baseGoal, ctxSonnet);
    expect(calls[0]?.url).toBe('https://api.example.com/v1/chat/completions');
  });

  it('uses the model matching the context tier', async () => {
    const { fetch, calls } = stubFetch(chatResponse(JSON.stringify({ kind: 'satisfy' })));
    const brain = new LlmBrain({ baseUrl: 'https://api.example.com/v1', apiKey: 'key', modelByTier, fetchImpl: fetch });
    await brain.decide(baseGoal, { tier: 'opus', memories: [] });
    const body = JSON.parse(calls[0]?.options.body as string);
    expect(body.model).toBe('opus-model');
  });

  it('sends Authorization header with Bearer token', async () => {
    const { fetch, calls } = stubFetch(chatResponse(JSON.stringify({ kind: 'satisfy' })));
    const brain = new LlmBrain({ baseUrl: 'https://api.example.com/v1', apiKey: 'my-api-key', modelByTier, fetchImpl: fetch });
    await brain.decide(baseGoal, ctxSonnet);
    const headers = calls[0]?.options.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer my-api-key');
  });

  it('includes extra headers when provided', async () => {
    const { fetch, calls } = stubFetch(chatResponse(JSON.stringify({ kind: 'satisfy' })));
    const brain = new LlmBrain({
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'key',
      modelByTier,
      headers: { 'X-Custom': 'value' },
      fetchImpl: fetch,
    });
    await brain.decide(baseGoal, ctxSonnet);
    const headers = calls[0]?.options.headers as Record<string, string>;
    expect(headers['X-Custom']).toBe('value');
  });

  it('parses a satisfy decision', async () => {
    const { fetch } = stubFetch(chatResponse(JSON.stringify({ kind: 'satisfy' })));
    const brain = new LlmBrain({ baseUrl: 'https://x', apiKey: 'k', modelByTier, fetchImpl: fetch });
    const result = await brain.decide(baseGoal, ctxSonnet);
    expect(result.value.kind).toBe('satisfy');
  });

  it('parses a split decision', async () => {
    const { fetch } = stubFetch(
      chatResponse(JSON.stringify({ kind: 'split', children: [{ localId: 'c1', type: 'implement', title: 'sub', spec: {}, dependsOn: [], scope: ['src/'], budgetShare: 1 }] })),
    );
    const brain = new LlmBrain({ baseUrl: 'https://x', apiKey: 'k', modelByTier, fetchImpl: fetch });
    const result = await brain.decide(baseGoal, ctxSonnet);
    expect(result.value.kind).toBe('split');
  });

  it('retries once on JSON parse failure and succeeds on second attempt', async () => {
    const { fetch, calls } = stubFetch(
      chatResponse('not json at all'),
      chatResponse(JSON.stringify({ kind: 'satisfy' })),
    );
    const brain = new LlmBrain({ baseUrl: 'https://x', apiKey: 'k', modelByTier, fetchImpl: fetch });
    const result = await brain.decide(baseGoal, ctxSonnet);
    expect(result.value.kind).toBe('satisfy');
    expect(calls).toHaveLength(2);
  });

  it('throws after two consecutive parse failures', async () => {
    const { fetch } = stubFetch(
      chatResponse('bad json #1'),
      chatResponse('bad json #2'),
    );
    const brain = new LlmBrain({ baseUrl: 'https://x', apiKey: 'k', modelByTier, fetchImpl: fetch });
    await expect(brain.decide(baseGoal, ctxSonnet)).rejects.toThrow();
  });

  it('includes memories quoted as data in the user message', async () => {
    const { fetch, calls } = stubFetch(chatResponse(JSON.stringify({ kind: 'satisfy' })));
    const brain = new LlmBrain({ baseUrl: 'https://x', apiKey: 'k', modelByTier, fetchImpl: fetch });
    await brain.decide(baseGoal, ctxWithMemories);
    const body = JSON.parse(calls[0]?.options.body as string);
    const userMsg: string = body.messages.find((m: { role: string }) => m.role === 'user').content;
    // Memories are injected as quoted data (id and content visible).
    expect(userMsg).toContain('m1');
    expect(userMsg).toContain('Always write tests first.');
    expect(userMsg).toContain('m2');
    expect(userMsg).toContain('Use kebab-case for file names.');
    // Evidence framing is present.
    expect(userMsg).toContain('evidence');
  });

  it('includes prior attempt verdict in the user message when present', async () => {
    const { fetch, calls } = stubFetch(chatResponse(JSON.stringify({ kind: 'satisfy' })));
    const brain = new LlmBrain({ baseUrl: 'https://x', apiKey: 'k', modelByTier, fetchImpl: fetch });
    await brain.decide(baseGoal, ctxWithPriorAttempt);
    const body = JSON.parse(calls[0]?.options.body as string);
    const userMsg: string = body.messages.find((m: { role: string }) => m.role === 'user').content;
    expect(userMsg).toContain('PRIOR ATTEMPT');
    expect(userMsg).toContain('Missing export');
    expect(userMsg).toContain('Export the widget function.');
  });

  it('goal title, type and scope appear in the request', async () => {
    const { fetch, calls } = stubFetch(chatResponse(JSON.stringify({ kind: 'satisfy' })));
    const brain = new LlmBrain({ baseUrl: 'https://x', apiKey: 'k', modelByTier, fetchImpl: fetch });
    await brain.decide(baseGoal, ctxSonnet);
    const body = JSON.parse(calls[0]?.options.body as string);
    const userMsg: string = body.messages.find((m: { role: string }) => m.role === 'user').content;
    expect(userMsg).toContain('Write the widget');
    expect(userMsg).toContain('implement');
    expect(userMsg).toContain('src/');
  });
});

// ---------------------------------------------------------------------------
// produce
// ---------------------------------------------------------------------------

describe('LlmBrain.produce', () => {
  it('parses fenced file blocks into a files artifact', async () => {
    const rawContent = '```src/widget.ts\nexport const x = 1;\n```';
    const { fetch } = stubFetch(chatResponse(rawContent));
    const brain = new LlmBrain({ baseUrl: 'https://x', apiKey: 'k', modelByTier, fetchImpl: fetch });
    const result = await brain.produce(baseGoal, ctxSonnet);
    expect(result.value.kind).toBe('files');
    expect(result.value.files).toHaveLength(1);
    expect(result.value.files?.[0]?.path).toBe('src/widget.ts');
    expect(result.value.files?.[0]?.content).toContain('export const x = 1;');
  });

  it('falls back to text artifact when no file blocks are present', async () => {
    const { fetch } = stubFetch(chatResponse('Here is the plain text answer.'));
    const brain = new LlmBrain({ baseUrl: 'https://x', apiKey: 'k', modelByTier, fetchImpl: fetch });
    const result = await brain.produce(baseGoal, ctxSonnet);
    expect(result.value.kind).toBe('text');
    expect(result.value.text).toContain('plain text answer');
  });

  it('parses multiple file blocks', async () => {
    const rawContent =
      '```src/a.ts\nexport const a = 1;\n```\n```src/b.ts\nexport const b = 2;\n```';
    const { fetch } = stubFetch(chatResponse(rawContent));
    const brain = new LlmBrain({ baseUrl: 'https://x', apiKey: 'k', modelByTier, fetchImpl: fetch });
    const result = await brain.produce(baseGoal, ctxSonnet);
    expect(result.value.kind).toBe('files');
    expect(result.value.files).toHaveLength(2);
  });

  it('uses json_object=false for produce (plain text mode)', async () => {
    const { fetch, calls } = stubFetch(chatResponse('plain'));
    const brain = new LlmBrain({ baseUrl: 'https://x', apiKey: 'k', modelByTier, fetchImpl: fetch });
    await brain.produce(baseGoal, ctxSonnet);
    const body = JSON.parse(calls[0]?.options.body as string);
    expect(body.response_format).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// judge
// ---------------------------------------------------------------------------

describe('LlmBrain.judge', () => {
  const subject: Artifact = {
    kind: 'files',
    files: [{ path: 'src/widget.ts', content: 'export const x = 1;' }],
  };

  it('parses a passing verdict', async () => {
    const verdict: Verdict = { pass: true, findings: [] };
    const { fetch } = stubFetch(chatResponse(JSON.stringify(verdict)));
    const brain = new LlmBrain({ baseUrl: 'https://x', apiKey: 'k', modelByTier, fetchImpl: fetch });
    const result = await brain.judge(baseGoal, subject, 'Be strict.', ctxSonnet);
    expect(result.value.pass).toBe(true);
    expect(result.value.findings).toHaveLength(0);
  });

  it('parses a failing verdict with findings', async () => {
    const verdict = {
      pass: false,
      findings: [{ title: 'Bad name', dimension: 'convention', severity: 'low', gating: false }],
    };
    const { fetch } = stubFetch(chatResponse(JSON.stringify(verdict)));
    const brain = new LlmBrain({ baseUrl: 'https://x', apiKey: 'k', modelByTier, fetchImpl: fetch });
    const result = await brain.judge(baseGoal, subject, 'Be strict.', ctxSonnet);
    expect(result.value.pass).toBe(false);
    expect(result.value.findings[0]?.title).toBe('Bad name');
    expect(result.value.findings[0]?.dimension).toBe('convention');
  });

  it('includes failureSignature when present', async () => {
    const verdict = { pass: false, findings: [], failureSignature: 'sig-abc' };
    const { fetch } = stubFetch(chatResponse(JSON.stringify(verdict)));
    const brain = new LlmBrain({ baseUrl: 'https://x', apiKey: 'k', modelByTier, fetchImpl: fetch });
    const result = await brain.judge(baseGoal, subject, 'rubric', ctxSonnet);
    expect(result.value.failureSignature).toBe('sig-abc');
  });

  it('retries on parse failure and succeeds', async () => {
    const good = { pass: true, findings: [] };
    const { fetch, calls } = stubFetch(
      chatResponse('not valid json'),
      chatResponse(JSON.stringify(good)),
    );
    const brain = new LlmBrain({ baseUrl: 'https://x', apiKey: 'k', modelByTier, fetchImpl: fetch });
    const result = await brain.judge(baseGoal, subject, 'rubric', ctxSonnet);
    expect(result.value.pass).toBe(true);
    expect(calls).toHaveLength(2);
  });

  it('throws after two consecutive parse failures', async () => {
    const { fetch } = stubFetch(chatResponse('bad'), chatResponse('also bad'));
    const brain = new LlmBrain({ baseUrl: 'https://x', apiKey: 'k', modelByTier, fetchImpl: fetch });
    await expect(brain.judge(baseGoal, subject, 'rubric', ctxSonnet)).rejects.toThrow();
  });

  it('includes the rubric in the request', async () => {
    const { fetch, calls } = stubFetch(chatResponse(JSON.stringify({ pass: true, findings: [] })));
    const brain = new LlmBrain({ baseUrl: 'https://x', apiKey: 'k', modelByTier, fetchImpl: fetch });
    await brain.judge(baseGoal, subject, 'CUSTOM RUBRIC TEXT', ctxSonnet);
    const body = JSON.parse(calls[0]?.options.body as string);
    const userMsg: string = body.messages.find((m: { role: string }) => m.role === 'user').content;
    expect(userMsg).toContain('CUSTOM RUBRIC TEXT');
  });

  it('includes memories as evidence data in the judge request', async () => {
    const { fetch, calls } = stubFetch(chatResponse(JSON.stringify({ pass: true, findings: [] })));
    const brain = new LlmBrain({ baseUrl: 'https://x', apiKey: 'k', modelByTier, fetchImpl: fetch });
    await brain.judge(baseGoal, subject, 'rubric', ctxWithMemories);
    const body = JSON.parse(calls[0]?.options.body as string);
    const userMsg: string = body.messages.find((m: { role: string }) => m.role === 'user').content;
    expect(userMsg).toContain('Always write tests first.');
    expect(userMsg).toContain('evidence');
  });
});

// ---------------------------------------------------------------------------
// repair
// ---------------------------------------------------------------------------

describe('LlmBrain.repair', () => {
  const artifact: Artifact = {
    kind: 'files',
    files: [{ path: 'src/widget.ts', content: 'export const x = 1;' }],
  };

  it('returns repaired files from fenced blocks', async () => {
    const rawContent = '```src/widget.ts\nexport const x = 2; // fixed\n```';
    const { fetch } = stubFetch(chatResponse(rawContent));
    const brain = new LlmBrain({ baseUrl: 'https://x', apiKey: 'k', modelByTier, fetchImpl: fetch });
    const result = await brain.repair(baseGoal, artifact, ['Use 2 instead of 1.'], ctxSonnet);
    expect(result.value.kind).toBe('files');
    expect(result.value.files?.[0]?.content).toContain('// fixed');
  });

  it('includes prescriptions in the user message', async () => {
    const { fetch, calls } = stubFetch(chatResponse('```src/x.ts\n```'));
    const brain = new LlmBrain({ baseUrl: 'https://x', apiKey: 'k', modelByTier, fetchImpl: fetch });
    await brain.repair(baseGoal, artifact, ['Fix the export.', 'Add strict mode.'], ctxSonnet);
    const body = JSON.parse(calls[0]?.options.body as string);
    const userMsg: string = body.messages.find((m: { role: string }) => m.role === 'user').content;
    expect(userMsg).toContain('Fix the export.');
    expect(userMsg).toContain('Add strict mode.');
  });
});

// ---------------------------------------------------------------------------
// Real usage parsing (ADR-017)
// ---------------------------------------------------------------------------

function chatResponseWithUsage(content: string, usage: { prompt_tokens: number; completion_tokens: number; cost?: number }) {
  return { choices: [{ message: { role: 'assistant', content } }], usage };
}

describe('LlmBrain usage parsing', () => {
  it('decide surfaces promptTokens and completionTokens from the response usage block', async () => {
    const { fetch } = stubFetch(
      chatResponseWithUsage(JSON.stringify({ kind: 'satisfy' }), { prompt_tokens: 100, completion_tokens: 50 }),
    );
    const brain = new LlmBrain({ baseUrl: 'https://x', apiKey: 'k', modelByTier, fetchImpl: fetch });
    const result = await brain.decide(baseGoal, ctxSonnet);
    expect(result.usage.promptTokens).toBe(100);
    expect(result.usage.completionTokens).toBe(50);
  });

  it('decide surfaces costUsd when the endpoint reports cost', async () => {
    const { fetch } = stubFetch(
      chatResponseWithUsage(JSON.stringify({ kind: 'satisfy' }), { prompt_tokens: 200, completion_tokens: 80, cost: 0.0042 }),
    );
    const brain = new LlmBrain({ baseUrl: 'https://x', apiKey: 'k', modelByTier, fetchImpl: fetch });
    const result = await brain.decide(baseGoal, ctxSonnet);
    expect(result.usage.costUsd).toBeCloseTo(0.0042);
  });

  it('decide returns undefined costUsd when cost is absent from the usage block', async () => {
    const { fetch } = stubFetch(
      chatResponseWithUsage(JSON.stringify({ kind: 'satisfy' }), { prompt_tokens: 100, completion_tokens: 30 }),
    );
    const brain = new LlmBrain({ baseUrl: 'https://x', apiKey: 'k', modelByTier, fetchImpl: fetch });
    const result = await brain.decide(baseGoal, ctxSonnet);
    expect(result.usage.costUsd).toBeUndefined();
  });

  it('decide returns zero usage when the response carries no usage block', async () => {
    const { fetch } = stubFetch(chatResponse(JSON.stringify({ kind: 'satisfy' })));
    const brain = new LlmBrain({ baseUrl: 'https://x', apiKey: 'k', modelByTier, fetchImpl: fetch });
    const result = await brain.decide(baseGoal, ctxSonnet);
    expect(result.usage.promptTokens).toBe(0);
    expect(result.usage.completionTokens).toBe(0);
    expect(result.usage.costUsd).toBeUndefined();
  });

  it('produce surfaces usage from the response', async () => {
    const { fetch } = stubFetch(
      chatResponseWithUsage('plain text answer', { prompt_tokens: 60, completion_tokens: 20, cost: 0.001 }),
    );
    const brain = new LlmBrain({ baseUrl: 'https://x', apiKey: 'k', modelByTier, fetchImpl: fetch });
    const result = await brain.produce(baseGoal, ctxSonnet);
    expect(result.usage.promptTokens).toBe(60);
    expect(result.usage.completionTokens).toBe(20);
    expect(result.usage.costUsd).toBeCloseTo(0.001);
  });

  it('judge surfaces usage from the response', async () => {
    const { fetch } = stubFetch(
      chatResponseWithUsage(JSON.stringify({ pass: true, findings: [] }), { prompt_tokens: 150, completion_tokens: 40, cost: 0.002 }),
    );
    const brain = new LlmBrain({ baseUrl: 'https://x', apiKey: 'k', modelByTier, fetchImpl: fetch });
    const result = await brain.judge(baseGoal, { kind: 'text', text: 'x' }, 'rubric', ctxSonnet);
    expect(result.usage.promptTokens).toBe(150);
    expect(result.usage.completionTokens).toBe(40);
  });

  it('repair surfaces usage from the response', async () => {
    const { fetch } = stubFetch(
      chatResponseWithUsage('```src/x.ts\nfixed\n```', { prompt_tokens: 75, completion_tokens: 15 }),
    );
    const brain = new LlmBrain({ baseUrl: 'https://x', apiKey: 'k', modelByTier, fetchImpl: fetch });
    const result = await brain.repair(baseGoal, { kind: 'text', text: 'old' }, ['fix it'], ctxSonnet);
    expect(result.usage.promptTokens).toBe(75);
    expect(result.usage.completionTokens).toBe(15);
  });

  it('decide accumulates usage from both calls on a re-ask retry', async () => {
    const { fetch } = stubFetch(
      chatResponseWithUsage('not json at all', { prompt_tokens: 50, completion_tokens: 10 }),
      chatResponseWithUsage(JSON.stringify({ kind: 'satisfy' }), { prompt_tokens: 60, completion_tokens: 5, cost: 0.001 }),
    );
    const brain = new LlmBrain({ baseUrl: 'https://x', apiKey: 'k', modelByTier, fetchImpl: fetch });
    const result = await brain.decide(baseGoal, ctxSonnet);
    expect(result.usage.promptTokens).toBe(110);
    expect(result.usage.completionTokens).toBe(15);
    expect(result.usage.costUsd).toBeCloseTo(0.001);
  });
});
