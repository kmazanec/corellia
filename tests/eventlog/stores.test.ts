import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { InMemoryEventStore } from '../../src/eventlog/memory-store.js';
import { JsonlEventStore } from '../../src/eventlog/jsonl-store.js';
import type { FactoryEvent } from '../../src/contract/events.js';

// script-ran fixture
const scriptRan: FactoryEvent = {
  type: 'script-ran',
  at: 9000,
  goalId: 'g1',
  command: 'test',
  exitStatus: 0,
  durationMs: 123,
  outputRef: 'g1:test:9000',
};

// Minimal valid FactoryEvent fixtures — no engine or brain imports.
const goalA: FactoryEvent = {
  type: 'goal-received',
  at: 1000,
  goalId: 'g1',
  goal: {
    id: 'g1',
    type: 'feature',
    parentId: null,
    title: 'Build login',
    spec: {},
    intent: 'production',
    scope: ['src/auth.ts'],
    budget: { attempts: 3, tokens: 5000, toolCalls: 20, wallClockMs: 60000 },
    memories: [],
  },
};

const goalB: FactoryEvent = {
  type: 'goal-received',
  at: 2000,
  goalId: 'g2',
  goal: {
    id: 'g2',
    type: 'test',
    parentId: 'g1',
    title: 'Write login tests',
    spec: {},
    intent: 'production',
    scope: ['tests/auth.test.ts'],
    budget: { attempts: 2, tokens: 2000, toolCalls: 10, wallClockMs: 30000 },
    memories: [],
  },
};

const emitted: FactoryEvent = {
  type: 'emitted',
  at: 3000,
  goalId: 'g1',
  report: {
    artifact: null,
    proof: [],
    lessons: [],
    memoriesUsed: [],
    blockers: [],
    findings: [],
    learned: 'Login was built.',
  },
};

// ──────────────────────────────────────────────
// InMemoryEventStore
// ──────────────────────────────────────────────

describe('InMemoryEventStore', () => {
  it('appends and lists all events in order', async () => {
    const store = new InMemoryEventStore();
    await store.append(goalA);
    await store.append(goalB);
    await store.append(emitted);

    const all = await store.list();
    expect(all).toHaveLength(3);
    expect(all[0]?.type).toBe('goal-received');
    expect(all[2]?.type).toBe('emitted');
  });

  it('filters by goalId', async () => {
    const store = new InMemoryEventStore();
    await store.append(goalA);
    await store.append(goalB);
    await store.append(emitted);

    const g1Only = await store.list({ goalId: 'g1' });
    expect(g1Only).toHaveLength(2);
    expect(g1Only.every((e) => e.goalId === 'g1')).toBe(true);
  });

  it('filters by type', async () => {
    const store = new InMemoryEventStore();
    await store.append(goalA);
    await store.append(goalB);
    await store.append(emitted);

    const received = await store.list({ type: 'goal-received' });
    expect(received).toHaveLength(2);
  });

  it('filters by goalId AND type together', async () => {
    const store = new InMemoryEventStore();
    await store.append(goalA);
    await store.append(goalB);
    await store.append(emitted);

    const hits = await store.list({ goalId: 'g1', type: 'emitted' });
    expect(hits).toHaveLength(1);
    expect(hits[0]?.type).toBe('emitted');
  });

  it('returns copies so mutations do not affect the log', async () => {
    const store = new InMemoryEventStore();
    await store.append(goalA);

    const [copy] = await store.list();
    // Mutate the copy; the log should not reflect the change.
    (copy as Record<string, unknown>)['at'] = 99999;

    expect((await store.list())[0]?.at).toBe(1000);
  });

  it('returns empty array when no events match', async () => {
    const store = new InMemoryEventStore();
    await store.append(goalA);
    expect(await store.list({ goalId: 'nonexistent' })).toHaveLength(0);
  });

  it('round-trips a script-ran event with all required fields', async () => {
    const store = new InMemoryEventStore();
    await store.append(scriptRan);

    const all = await store.list({ type: 'script-ran' });
    expect(all).toHaveLength(1);

    const ev = all[0] as Extract<FactoryEvent, { type: 'script-ran' }>;
    expect(ev.type).toBe('script-ran');
    expect(ev.goalId).toBe('g1');
    expect(ev.command).toBe('test');
    expect(ev.exitStatus).toBe(0);
    expect(ev.durationMs).toBe(123);
    expect(ev.outputRef).toBe('g1:test:9000');
  });
});

// ──────────────────────────────────────────────
// JsonlEventStore
// ──────────────────────────────────────────────

describe('JsonlEventStore', () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  it('appends and reads back in order', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'corellia-test-'));
    const store = new JsonlEventStore(join(tmpDir, 'events.jsonl'));

    await store.append(goalA);
    await store.append(goalB);
    await store.append(emitted);

    const all = await store.list();
    expect(all).toHaveLength(3);
    expect(all[0]?.type).toBe('goal-received');
    expect(all[2]?.type).toBe('emitted');
  });

  it('creates parent directories if they do not exist', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'corellia-test-'));
    const nested = join(tmpDir, 'deep', 'nested', 'events.jsonl');
    const store = new JsonlEventStore(nested);
    await store.append(goalA);

    expect(await store.list()).toHaveLength(1);
  });

  it('filters by goalId', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'corellia-test-'));
    const store = new JsonlEventStore(join(tmpDir, 'events.jsonl'));
    await store.append(goalA);
    await store.append(goalB);
    await store.append(emitted);

    expect(await store.list({ goalId: 'g2' })).toHaveLength(1);
  });

  it('filters by type', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'corellia-test-'));
    const store = new JsonlEventStore(join(tmpDir, 'events.jsonl'));
    await store.append(goalA);
    await store.append(goalB);
    await store.append(emitted);

    expect(await store.list({ type: 'emitted' })).toHaveLength(1);
  });

  it('tolerates a trailing partial line', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'corellia-test-'));
    const path = join(tmpDir, 'events.jsonl');
    const store = new JsonlEventStore(path);
    await store.append(goalA);

    // Append a corrupt partial line to simulate a crash mid-write.
    appendFileSync(path, '{"type":"goal-receiv', 'utf8');

    const all = await store.list();
    expect(all).toHaveLength(1);
    expect(all[0]?.type).toBe('goal-received');
  });

  it('returns empty array when file does not exist', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'corellia-test-'));
    const store = new JsonlEventStore(join(tmpDir, 'missing.jsonl'));
    expect(await store.list()).toHaveLength(0);
  });

  it('round-trips a script-ran event through JSONL with all required fields', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'corellia-test-'));
    const store = new JsonlEventStore(join(tmpDir, 'events.jsonl'));
    await store.append(scriptRan);

    const all = await store.list({ type: 'script-ran' });
    expect(all).toHaveLength(1);

    const ev = all[0] as Extract<FactoryEvent, { type: 'script-ran' }>;
    expect(ev.type).toBe('script-ran');
    expect(ev.goalId).toBe('g1');
    expect(ev.command).toBe('test');
    expect(ev.exitStatus).toBe(0);
    expect(ev.durationMs).toBe(123);
    expect(ev.outputRef).toBe('g1:test:9000');
  });
});
