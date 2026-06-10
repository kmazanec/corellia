import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { InMemoryEventStore } from '../../src/eventlog/memory-store.js';
import { JsonlEventStore } from '../../src/eventlog/jsonl-store.js';
import type { FactoryEvent } from '../../src/contract/events.js';

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
  report: { kind: 'make', goalId: 'g1', summary: 'done', artifacts: [] },
};

// ──────────────────────────────────────────────
// InMemoryEventStore
// ──────────────────────────────────────────────

describe('InMemoryEventStore', () => {
  it('appends and lists all events in order', () => {
    const store = new InMemoryEventStore();
    store.append(goalA);
    store.append(goalB);
    store.append(emitted);

    const all = store.list();
    expect(all).toHaveLength(3);
    expect(all[0]?.type).toBe('goal-received');
    expect(all[2]?.type).toBe('emitted');
  });

  it('filters by goalId', () => {
    const store = new InMemoryEventStore();
    store.append(goalA);
    store.append(goalB);
    store.append(emitted);

    const g1Only = store.list({ goalId: 'g1' });
    expect(g1Only).toHaveLength(2);
    expect(g1Only.every((e) => e.goalId === 'g1')).toBe(true);
  });

  it('filters by type', () => {
    const store = new InMemoryEventStore();
    store.append(goalA);
    store.append(goalB);
    store.append(emitted);

    const received = store.list({ type: 'goal-received' });
    expect(received).toHaveLength(2);
  });

  it('filters by goalId AND type together', () => {
    const store = new InMemoryEventStore();
    store.append(goalA);
    store.append(goalB);
    store.append(emitted);

    const hits = store.list({ goalId: 'g1', type: 'emitted' });
    expect(hits).toHaveLength(1);
    expect(hits[0]?.type).toBe('emitted');
  });

  it('returns copies so mutations do not affect the log', () => {
    const store = new InMemoryEventStore();
    store.append(goalA);

    const [copy] = store.list();
    // Mutate the copy; the log should not reflect the change.
    (copy as Record<string, unknown>)['at'] = 99999;

    expect(store.list()[0]?.at).toBe(1000);
  });

  it('returns empty array when no events match', () => {
    const store = new InMemoryEventStore();
    store.append(goalA);
    expect(store.list({ goalId: 'nonexistent' })).toHaveLength(0);
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

  it('appends and reads back in order', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'corellia-test-'));
    const store = new JsonlEventStore(join(tmpDir, 'events.jsonl'));

    store.append(goalA);
    store.append(goalB);
    store.append(emitted);

    const all = store.list();
    expect(all).toHaveLength(3);
    expect(all[0]?.type).toBe('goal-received');
    expect(all[2]?.type).toBe('emitted');
  });

  it('creates parent directories if they do not exist', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'corellia-test-'));
    const nested = join(tmpDir, 'deep', 'nested', 'events.jsonl');
    const store = new JsonlEventStore(nested);
    store.append(goalA);

    expect(store.list()).toHaveLength(1);
  });

  it('filters by goalId', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'corellia-test-'));
    const store = new JsonlEventStore(join(tmpDir, 'events.jsonl'));
    store.append(goalA);
    store.append(goalB);
    store.append(emitted);

    expect(store.list({ goalId: 'g2' })).toHaveLength(1);
  });

  it('filters by type', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'corellia-test-'));
    const store = new JsonlEventStore(join(tmpDir, 'events.jsonl'));
    store.append(goalA);
    store.append(goalB);
    store.append(emitted);

    expect(store.list({ type: 'emitted' })).toHaveLength(1);
  });

  it('tolerates a trailing partial line', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'corellia-test-'));
    const path = join(tmpDir, 'events.jsonl');
    const store = new JsonlEventStore(path);
    store.append(goalA);

    // Append a corrupt partial line to simulate a crash mid-write.
    appendFileSync(path, '{"type":"goal-receiv', 'utf8');

    const all = store.list();
    expect(all).toHaveLength(1);
    expect(all[0]?.type).toBe('goal-received');
  });

  it('returns empty array when file does not exist', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'corellia-test-'));
    const store = new JsonlEventStore(join(tmpDir, 'missing.jsonl'));
    expect(store.list()).toHaveLength(0);
  });
});
