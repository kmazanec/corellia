/**
 * Tests for empty-artifact diagnosis and targeted re-ask in produce()
 * (issue design-arch-empty-artifact-block). When a producer completion comes back
 * empty, produce() re-asks the same model once, then falls back to the mid band,
 * and — if all still empty — returns the empty artifact tagged with a diagnosed
 * reason (truncated | refusal | parse-drop | empty-response) plus a raw sample.
 * No network — fetch is stubbed with a per-call body sequence.
 */

import { describe, it, expect, vi } from 'vitest';
import { LlmBrain, diagnoseEmpty } from '../../src/brains/llm.js';
import type { Goal } from '../../src/contract/goal.js';
import type { BrainContext } from '../../src/contract/brain.js';

type FetchCall = { url: string; options: RequestInit };

function stubFetch(...bodies: unknown[]): { fetch: typeof fetch; calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  let idx = 0;
  const fetch = vi.fn(async (url: string | URL | Request, options?: RequestInit) => {
    calls.push({ url: String(url), options: options ?? {} });
    const body = bodies[Math.min(idx++, bodies.length - 1)];
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as unknown as typeof fetch;
  return { fetch, calls };
}

function chatResponse(content: string) {
  return { choices: [{ message: { role: 'assistant', content } }] };
}
function chatResponseTruncated(content: string) {
  return { choices: [{ message: { role: 'assistant', content }, finish_reason: 'length' }] };
}

const modelByTier = { low: 'low-model', mid: 'mid-model', high: 'high-model' };

const baseGoal: Goal = {
  id: 'g1',
  type: 'design-arch',
  parentId: null,
  title: 'ADR: something',
  spec: { description: 'an ADR' },
  intent: 'production',
  scope: ['docs/'],
  budget: { attempts: 3, tokens: 1000, toolCalls: 10, wallClockMs: 60_000 },
  memories: [],
};

const cfg = (fetch: typeof fetch) => ({
  baseUrl: 'https://api.example.com/v1',
  apiKey: 'key',
  modelByTier,
  fetchImpl: fetch,
});

// A tier whose mid fallback is a DIFFERENT model, so the fallback call actually fires.
const ctxHigh: BrainContext = { tier: 'high', memories: [] };
// A tier that already IS the mid model, so no extra fallback call is made.
const ctxMid: BrainContext = { tier: 'mid', memories: [] };

describe('produce() — recovery on empty completion', () => {
  it('returns the recovered artifact when the same-model re-ask succeeds', async () => {
    const { fetch, calls } = stubFetch(chatResponse(''), chatResponse('The full document body.'));
    const brain = new LlmBrain(cfg(fetch));
    const { value } = await brain.produce(baseGoal, ctxMid);
    expect(value.kind).toBe('text');
    expect(value.text).toContain('full document body');
    expect(value.emptyDiagnosis).toBeUndefined();
    expect(calls).toHaveLength(2); // first empty + one same-model re-ask
  });

  it('falls back to the mid band and returns its content when the same model stays empty', async () => {
    const { fetch, calls } = stubFetch(
      chatResponse(''), // high: empty
      chatResponse(''), // high re-ask: still empty
      chatResponse('Recovered by the mid model.'), // mid fallback: content
    );
    const brain = new LlmBrain(cfg(fetch));
    const { value } = await brain.produce(baseGoal, ctxHigh);
    expect(value.text).toContain('Recovered by the mid model');
    expect(value.emptyDiagnosis).toBeUndefined();
    expect(calls).toHaveLength(3);
    // The third call used the mid model, not the high one.
    const thirdBody = JSON.parse(calls[2]!.options.body as string);
    expect(thirdBody.model).toBe('mid-model');
  });

  it('does not make a redundant fallback call when the tier already resolves to mid', async () => {
    const { fetch, calls } = stubFetch(chatResponse(''), chatResponse(''));
    const brain = new LlmBrain(cfg(fetch));
    const { value } = await brain.produce(baseGoal, ctxMid);
    expect(calls).toHaveLength(2); // no third call — mid fallback == current target
    expect(value.emptyDiagnosis).toBeDefined();
  });
});

describe('produce() — diagnosis when all attempts stay empty', () => {
  it("diagnoses 'empty-response' when nothing but whitespace comes back", async () => {
    const { fetch } = stubFetch(chatResponse('   '), chatResponse(''), chatResponse(''));
    const brain = new LlmBrain(cfg(fetch));
    const { value } = await brain.produce(baseGoal, ctxHigh);
    expect(value.emptyDiagnosis?.reason).toBe('empty-response');
  });

  it("diagnoses 'truncated' when the first response was cut off at the length limit", async () => {
    const { fetch } = stubFetch(chatResponseTruncated(''), chatResponse(''), chatResponse(''));
    const brain = new LlmBrain(cfg(fetch));
    const { value } = await brain.produce(baseGoal, ctxHigh);
    expect(value.emptyDiagnosis?.reason).toBe('truncated');
  });

  it("diagnoses 'refusal' when the model persistently refuses (non-empty but not a deliverable)", async () => {
    const { fetch } = stubFetch(
      chatResponse("I can't help with that."),
      chatResponse("I can't help with that."),
      chatResponse("I can't help with that."),
    );
    const brain = new LlmBrain(cfg(fetch));
    const { value } = await brain.produce(baseGoal, ctxHigh);
    // A bare refusal is a non-delivery even though the text is non-empty: it is
    // re-asked, and when it persists the artifact carries the refusal diagnosis so
    // the eventual block names the cause.
    expect(value.emptyDiagnosis?.reason).toBe('refusal');
  });

  it('recovers when a refusal is followed by real content on the re-ask', async () => {
    const { fetch, calls } = stubFetch(
      chatResponse("I'm sorry, I can't."),
      chatResponse('Actually, here is the full ADR body with real content.'),
    );
    const brain = new LlmBrain(cfg(fetch));
    const { value } = await brain.produce(baseGoal, ctxMid);
    expect(value.text).toContain('full ADR body');
    expect(value.emptyDiagnosis).toBeUndefined();
    expect(calls).toHaveLength(2);
  });

  it('diagnoses from the ORIGINAL completion, not a later blank re-ask (truncated first wins)', async () => {
    // First completion was truncated (empty body, length cutoff); the re-asks are plain
    // empty. The diagnosis must reflect the FIRST response's cause ('truncated'), because
    // a later blank re-ask is a symptom, not the original reason.
    const { fetch } = stubFetch(chatResponseTruncated(''), chatResponse(''), chatResponse(''));
    const brain = new LlmBrain(cfg(fetch));
    const { value } = await brain.produce(baseGoal, ctxHigh);
    expect(value.emptyDiagnosis?.reason).toBe('truncated');
  });
});

describe('diagnoseEmpty — unit classification', () => {
  it('truncation wins even if a little text survived', () => {
    expect(diagnoseEmpty('partial', true).reason).toBe('truncated');
  });
  it('empty-response for blank content', () => {
    expect(diagnoseEmpty('   \n ', false).reason).toBe('empty-response');
  });
  it('refusal for a short leading decline', () => {
    expect(diagnoseEmpty('I cannot produce this document.', false).reason).toBe('refusal');
  });
  it('parse-drop for non-empty content that leads a body, not a refusal', () => {
    expect(diagnoseEmpty('```ts\nconst x = 1;\n```', false).reason).toBe('parse-drop');
  });
  it('does not treat a long document mentioning "I cannot" as a refusal', () => {
    const longDoc = 'A'.repeat(500) + ' I cannot stress this enough';
    expect(diagnoseEmpty(longDoc, false).reason).toBe('parse-drop');
  });
  it('bounds the raw sample length', () => {
    const big = 'x'.repeat(1000);
    expect(diagnoseEmpty(big, false).rawSample.length).toBeLessThanOrEqual(200);
  });
});
