/**
 * The notification sink: pushes a compact webhook payload for a small curated set
 * of human-facing events (a decision brief blocking, a park, a resume, a PR, a
 * tree terminal) and ignores everything else. Tests inject fetch so event
 * selection, payload content, header passthrough, and fail-open are deterministic
 * with no network.
 */

import { describe, expect, it } from 'vitest';
import {
  NotificationSink,
  type NotifyFetch,
  type NotificationPayload,
} from '../../src/eventlog/notification-sink.js';
import type { FactoryEvent } from '../../src/contract/events.js';
import type { Goal } from '../../src/contract/goal.js';
import type { DecisionBrief } from '../../src/contract/decision.js';
import type { Report } from '../../src/contract/report.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const goal = (id: string, parentId: string | null): Goal => ({
  id,
  type: 'deliver-intent',
  parentId,
  title: id,
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

const brief = (over: Partial<DecisionBrief> = {}): DecisionBrief => ({
  question: 'Which auth strategy?',
  options: ['oauth', 'session'],
  links: [],
  deadlineMs: 60_000,
  onTimeout: 'park',
  ...over,
});

const report = (over: Partial<Report> = {}): Report => ({
  artifact: null,
  proof: [],
  lessons: [],
  memoriesUsed: [],
  blockers: [],
  findings: [],
  learned: '',
  ...over,
});

/** A recording fetch wired into a sink. `drain` awaits the fire-and-forget POSTs. */
function harness(
  over: { fetch?: NotifyFetch; headers?: Record<string, string>; onError?: (m: string) => void } = {},
) {
  const calls: { url: string; payload: NotificationPayload; headers: Record<string, string> }[] = [];
  const fetchImpl: NotifyFetch =
    over.fetch ??
    (async (url, init) => {
      calls.push({ url, payload: JSON.parse(init.body) as NotificationPayload, headers: init.headers });
      return { ok: true, status: 200 };
    });

  const sink = new NotificationSink({
    webhookUrl: 'https://hooks.example.com/notify',
    fetch: fetchImpl,
    ...(over.headers ? { headers: over.headers } : {}),
    ...(over.onError ? { onError: over.onError } : {}),
  });

  // The POST is fired with `void`; a few microtask ticks settle the recording fetch.
  const drain = async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };

  return { sink, calls, drain };
}

// ── Event selection ─────────────────────────────────────────────────────────

describe('NotificationSink — event selection', () => {
  it('POSTs a brief payload with question, options, deadline, and answer route on blocked', async () => {
    const { sink, calls, drain } = harness();
    sink.emit({ type: 'blocked', at: 5_000, goalId: 'root', brief: brief(), resolution: 'park' });
    await drain();

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://hooks.example.com/notify');
    const p = calls[0]!.payload;
    expect(p.kind).toBe('blocked');
    expect(p.question).toBe('Which auth strategy?');
    expect(p.options).toEqual(['oauth', 'session']);
    expect(p.deadline).toBe(5_000 + 60_000); // event.at + brief.deadlineMs
    expect(p.onTimeout).toBe('park');
    expect(p.resolution).toBe('park');
    expect(p.answerRoute).toBe('/intents/root/answer');
  });

  it('POSTs a park payload with the deadline derived from ttlMs', async () => {
    const { sink, calls, drain } = harness();
    sink.emit({ type: 'parked', at: 7_000, goalId: 'root', brief: brief(), ttlMs: 30_000 });
    await drain();

    const p = calls[0]!.payload;
    expect(p.kind).toBe('parked');
    expect(p.question).toBe('Which auth strategy?');
    expect(p.deadline).toBe(7_000 + 30_000);
    expect(p.answerRoute).toBe('/intents/root/answer');
  });

  it('POSTs a resumed payload carrying the answer', async () => {
    const { sink, calls, drain } = harness();
    sink.emit({ type: 'resumed', at: 8_000, goalId: 'root', answer: 'oauth' });
    await drain();

    expect(calls[0]!.payload.kind).toBe('resumed');
    expect(calls[0]!.payload.answer).toBe('oauth');
  });

  it('POSTs a pr-opened payload with the url and branch', async () => {
    const { sink, calls, drain } = harness();
    sink.emit({
      type: 'pr-opened',
      at: 9_000,
      goalId: 'leaf',
      treeId: 't1',
      branch: 'feat/x',
      url: 'https://github.com/o/r/pull/1',
    });
    await drain();

    const p = calls[0]!.payload;
    expect(p.kind).toBe('pr-opened');
    expect(p.url).toBe('https://github.com/o/r/pull/1');
    expect(p.branch).toBe('feat/x');
  });

  it('ignores irrelevant events — no webhook call', async () => {
    const { sink, calls, drain } = harness();
    sink.emit({ type: 'step', at: 1, goalId: 'root', index: 0, outputKind: 'artifact' });
    sink.emit({ type: 'tool-call', at: 2, goalId: 'root', tool: 'read', callId: 'c1', outcome: 'ran' });
    sink.emit({ type: 'decided', at: 3, goalId: 'root', decision: { kind: 'satisfy' } });
    await drain();

    expect(calls).toHaveLength(0);
  });
});

// ── Tree terminal (root-only) ─────────────────────────────────────────────────

describe('NotificationSink — tree terminal outcomes', () => {
  it('notifies tree-done on a root emit with no blockers', async () => {
    const { sink, calls, drain } = harness();
    sink.emit(received('root', null));
    sink.emit({ type: 'emitted', at: 2_000, goalId: 'root', report: report() });
    await drain();

    expect(calls).toHaveLength(1);
    expect(calls[0]!.payload.kind).toBe('tree-done');
  });

  it('notifies tree-failed on a root emit carrying blockers', async () => {
    const { sink, calls, drain } = harness();
    sink.emit(received('root', null));
    sink.emit({ type: 'emitted', at: 2_000, goalId: 'root', report: report({ blockers: ['db down'] }) });
    await drain();

    expect(calls[0]!.payload.kind).toBe('tree-failed');
    expect(calls[0]!.payload.blockers).toEqual(['db down']);
  });

  it('does NOT notify on a child emit — only the tree root is terminal', async () => {
    const { sink, calls, drain } = harness();
    sink.emit(received('child', 'root')); // child has a parent, so it is not a root
    sink.emit({ type: 'emitted', at: 2_000, goalId: 'child', report: report() });
    await drain();

    expect(calls).toHaveLength(0);
  });

  it('notifies tree-partial on partial-delivered with the blocked modules', async () => {
    const { sink, calls, drain } = harness();
    sink.emit({
      type: 'partial-delivered',
      at: 3_000,
      goalId: 'root',
      blockedModules: [{ goalId: 'm1', title: 'billing', blocker: 'no key' }],
    });
    await drain();

    const p = calls[0]!.payload;
    expect(p.kind).toBe('tree-partial');
    expect(p.blockedModules).toEqual([{ goalId: 'm1', title: 'billing', blocker: 'no key' }]);
  });
});

// ── Headers & failure discipline ──────────────────────────────────────────────

describe('NotificationSink — headers and fail-open', () => {
  it('passes configured headers through alongside content-type', async () => {
    const { sink, calls, drain } = harness({ headers: { authorization: 'Bearer secret' } });
    sink.emit({ type: 'resumed', at: 1, goalId: 'root', answer: 'yes' });
    await drain();

    expect(calls[0]!.headers['authorization']).toBe('Bearer secret');
    expect(calls[0]!.headers['content-type']).toBe('application/json');
  });

  it('fails open on a network error — never throws, logs once', async () => {
    const errors: string[] = [];
    const failing: NotifyFetch = () => Promise.reject(new Error('ECONNREFUSED'));
    const { sink, drain } = harness({ fetch: failing, onError: (m) => errors.push(m) });

    expect(() => sink.emit({ type: 'resumed', at: 1, goalId: 'root', answer: 'yes' })).not.toThrow();
    await drain();

    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('delivery failed');
  });

  it('logs at most once per burst and re-arms after a success', async () => {
    const errors: string[] = [];
    let ok = false;
    const flaky: NotifyFetch = () =>
      ok ? Promise.resolve({ ok: true, status: 200 }) : Promise.reject(new Error('down'));
    const { sink, drain } = harness({ fetch: flaky, onError: (m) => errors.push(m) });

    sink.emit({ type: 'resumed', at: 1, goalId: 'root', answer: 'a' });
    await drain();
    sink.emit({ type: 'resumed', at: 2, goalId: 'root', answer: 'b' });
    await drain();
    expect(errors).toHaveLength(1); // second failure in the same burst is not re-logged

    ok = true;
    sink.emit({ type: 'resumed', at: 3, goalId: 'root', answer: 'c' });
    await drain();
    ok = false;
    sink.emit({ type: 'resumed', at: 4, goalId: 'root', answer: 'd' });
    await drain();
    expect(errors).toHaveLength(2); // the success re-armed one more log
  });

  it('logs once on a non-ok HTTP status', async () => {
    const errors: string[] = [];
    const rejecting: NotifyFetch = () => Promise.resolve({ ok: false, status: 500 });
    const { sink, drain } = harness({ fetch: rejecting, onError: (m) => errors.push(m) });

    sink.emit({ type: 'resumed', at: 1, goalId: 'root', answer: 'yes' });
    await drain();

    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('HTTP 500');
  });
});
