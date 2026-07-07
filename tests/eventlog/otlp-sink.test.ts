/**
 * The OTLP trace sink: folds the factory's goal tree into OTLP/HTTP JSON spans
 * and POSTs them to a collector, dependency-free. Tests inject fetch and the
 * flush timer so the batching, id shapes, parenthood, status, and failure
 * discipline are all deterministic — no network, no real clock.
 */

import { describe, expect, it, vi } from 'vitest';
import { OtlpSink, type FetchLike, type TimerControl } from '../../src/eventlog/otlp-sink.js';
import type { FactoryEvent } from '../../src/contract/events.js';
import type { Goal } from '../../src/contract/goal.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const goal = (id: string, parentId: string | null, title = id): Goal => ({
  id,
  type: 'deliver-intent',
  parentId,
  title,
  spec: {},
  intent: 'production',
  scope: [],
  budget: { attempts: 1, tokens: 1, toolCalls: 1, wallClockMs: 1 },
  memories: [],
});

const received = (id: string, parentId: string | null, at = 1_000): FactoryEvent => ({
  type: 'goal-received',
  at,
  goalId: id,
  goal: goal(id, parentId),
});

const emitted = (id: string, blockers: string[], at = 2_000): FactoryEvent => ({
  type: 'emitted',
  at,
  goalId: id,
  report: { artifact: null, proof: [], lessons: [], memoriesUsed: [], blockers, findings: [], learned: '' },
});

/** A recording fetch plus a manual timer, wired into a sink with a low batch size. */
function harness(over: { batchSize?: number; fetch?: FetchLike; onError?: (m: string) => void } = {}) {
  const calls: { url: string; body: unknown; headers: Record<string, string> }[] = [];
  const fetchImpl: FetchLike =
    over.fetch ??
    (async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body), headers: init.headers });
      return { ok: true, status: 200 };
    });

  let fire: (() => void) | undefined;
  const timer: TimerControl = {
    set: (cb) => { fire = cb; },
    clear: () => { fire = undefined; },
  };

  const sink = new OtlpSink({
    endpoint: 'https://collector.example.com',
    batchSize: over.batchSize ?? 50,
    flushIntervalMs: 5_000,
    fetch: fetchImpl,
    timer,
    ...(over.onError ? { onError: over.onError } : {}),
  });

  return { sink, calls, tick: () => fire?.() };
}

/** The single span from the most recent export call. */
function lastSpans(calls: { body: unknown }[]): any[] {
  const body = calls.at(-1)!.body as any;
  return body.resourceSpans[0].scopeSpans[0].spans;
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('OtlpSink — span shape and lifecycle', () => {
  it('appends /v1/traces to the endpoint and sets the service.name resource', async () => {
    const { sink, calls } = harness({ batchSize: 1 });
    sink.emit(received('root', null));
    sink.emit(emitted('root', []));

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://collector.example.com/v1/traces');
    const resource = (calls[0]!.body as any).resourceSpans[0].resource;
    expect(resource.attributes).toContainEqual({ key: 'service.name', value: { stringValue: 'corellia' } });
  });

  it('emits a well-formed span only once the goal is closed', async () => {
    const { sink, calls, tick } = harness();
    sink.emit(received('root', null, 1_000));
    tick(); // Timer fires but nothing is closed yet.
    expect(calls).toHaveLength(0);

    sink.emit(emitted('root', [], 2_000));
    tick();

    const spans = lastSpans(calls);
    expect(spans).toHaveLength(1);
    const span = spans[0];
    // 16-byte trace id (32 hex), 8-byte span id (16 hex).
    expect(span.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(span.spanId).toMatch(/^[0-9a-f]{16}$/);
    expect(span.parentSpanId).toBeUndefined();
    expect(span.name).toBe('root');
    expect(span.startTimeUnixNano).toBe('1000000000'); // 1000 ms → ns
    expect(span.endTimeUnixNano).toBe('2000000000');
    expect(span.status).toEqual({ code: 0 }); // UNSET — no blockers.
  });

  it('nests a child span under its parent and shares the root trace id', async () => {
    const { sink, calls, tick } = harness();
    sink.emit(received('root', null));
    sink.emit(received('root/child', 'root'));
    sink.emit(emitted('root/child', []));
    sink.emit(emitted('root', []));
    tick();

    const spans = lastSpans(calls);
    const root = spans.find((s) => s.name === 'root');
    const child = spans.find((s) => s.name === 'root/child');
    expect(child.parentSpanId).toBe(root.spanId);
    // Both spans belong to the same trace (rooted at the top goal).
    expect(child.traceId).toBe(root.traceId);
  });

  it('closes a blocked goal with an OTLP error status carrying the reason', async () => {
    const { sink, calls, tick } = harness();
    sink.emit(received('root', null));
    sink.emit({
      type: 'blocked',
      at: 3_000,
      goalId: 'root',
      resolution: 'park',
      brief: { question: 'need a key', options: [], links: [], deadlineMs: 1, onTimeout: 'park' },
    });
    tick();

    const span = lastSpans(calls)[0];
    expect(span.status.code).toBe(2); // STATUS_ERROR
    expect(span.status.message).toContain('need a key');
    expect(span.attributes).toContainEqual({ key: 'corellia.block.resolution', value: { stringValue: 'park' } });
  });

  it('closes with error status when emitted carries blockers', async () => {
    const { sink, calls, tick } = harness();
    sink.emit(received('root', null));
    sink.emit(emitted('root', ['dep failed', 'scope']));
    tick();

    const span = lastSpans(calls)[0];
    expect(span.status.code).toBe(2);
    expect(span.status.message).toBe('dep failed | scope');
  });

  it('folds step events onto the span and accumulates usage tokens as attributes', async () => {
    const { sink, calls, tick } = harness();
    sink.emit(received('root', null));
    sink.emit({ type: 'tool-call', at: 1_100, goalId: 'root', tool: 'write_file', callId: 'c1', outcome: 'ran' });
    sink.emit({ type: 'step', at: 1_200, goalId: 'root', index: 0, outputKind: 'artifact', usage: { promptTokens: 10, completionTokens: 5 } });
    sink.emit({ type: 'produced', at: 1_300, goalId: 'root', usage: { promptTokens: 20, completionTokens: 7, costUsd: 0.01 } });
    sink.emit(emitted('root', []));
    tick();

    const span = lastSpans(calls)[0];
    const eventNames = span.events.map((e: any) => e.name);
    expect(eventNames).toContain('tool-call');
    expect(eventNames).toContain('step');
    const attrsByKey = Object.fromEntries(span.attributes.map((a: any) => [a.key, a.value]));
    expect(attrsByKey['corellia.usage.prompt_tokens']).toEqual({ intValue: '30' });
    expect(attrsByKey['corellia.usage.completion_tokens']).toEqual({ intValue: '12' });
    expect(attrsByKey['corellia.usage.cost_usd']).toEqual({ doubleValue: 0.01 });
  });

  it('records the child-spawned edge as a span event carrying dependsOn', async () => {
    const { sink, calls, tick } = harness();
    sink.emit(received('root', null));
    sink.emit({ type: 'child-spawned', at: 1_050, goalId: 'root', childId: 'root/a', childType: 'leaf', dependsOn: ['root/b'] });
    sink.emit(emitted('root', []));
    tick();

    const span = lastSpans(calls)[0];
    const spawn = span.events.find((e: any) => e.name === 'child-spawned');
    expect(spawn.attributes).toContainEqual({ key: 'corellia.child.id', value: { stringValue: 'root/a' } });
    expect(spawn.attributes).toContainEqual({ key: 'corellia.child.dependsOn', value: { stringValue: 'root/b' } });
  });
});

describe('OtlpSink — batching and flush', () => {
  it('exports as soon as the batch size is reached, without waiting for the timer', async () => {
    const { sink, calls } = harness({ batchSize: 2 });
    sink.emit(received('a', null));
    sink.emit(received('b', null));
    sink.emit(emitted('a', [])); // 1 closed — below threshold.
    expect(calls).toHaveLength(0);
    sink.emit(emitted('b', [])); // 2 closed — triggers export.

    await Promise.resolve(); // let the fire-and-forget export settle
    expect(calls).toHaveLength(1);
    expect(lastSpans(calls)).toHaveLength(2);
  });

  it('flush() drains closed spans and marks still-open spans factory.incomplete', async () => {
    const { sink, calls } = harness();
    sink.emit(received('done', null));
    sink.emit(emitted('done', []));
    sink.emit(received('open', null)); // never closed

    await sink.flush();

    const spans = lastSpans(calls);
    expect(spans).toHaveLength(2);
    const open = spans.find((s) => s.name === 'open');
    expect(open.attributes).toContainEqual({ key: 'factory.incomplete', value: { boolValue: true } });
    // An incomplete span still gets an end time (falls back to its start).
    expect(open.endTimeUnixNano).toBe(open.startTimeUnixNano);
  });

  it('flush() with nothing buffered does not POST', async () => {
    const { sink, calls } = harness();
    await sink.flush();
    expect(calls).toHaveLength(0);
  });
});

describe('OtlpSink — failure discipline', () => {
  it('does not throw when fetch rejects, and logs at most once per burst', async () => {
    const errors: string[] = [];
    const failing: FetchLike = () => Promise.reject(new Error('collector down'));
    const { sink } = harness({ batchSize: 1, fetch: failing, onError: (m) => errors.push(m) });

    sink.emit(received('a', null));
    expect(() => sink.emit(emitted('a', []))).not.toThrow();
    sink.emit(received('b', null));
    sink.emit(emitted('b', []));
    await Promise.resolve();
    await Promise.resolve();

    // Two failing bursts, but the log is throttled to one until a success re-arms it.
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain('export failed');
  });

  it('logs a non-ok HTTP response once', async () => {
    const errors: string[] = [];
    const rejecting: FetchLike = async () => ({ ok: false, status: 429 });
    const { sink } = harness({ batchSize: 1, fetch: rejecting, onError: (m) => errors.push(m) });

    sink.emit(received('a', null));
    sink.emit(emitted('a', []));
    await Promise.resolve();

    expect(errors[0]).toContain('HTTP 429');
  });
});
