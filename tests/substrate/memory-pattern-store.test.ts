/**
 * Unit tests for InMemoryPatternStore.
 *
 * Covers the full PatternStore contract: record/match/promote/list semantics,
 * counter accumulation, trust-plane promotion, and no-op promote on unknown shape.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryPatternStore } from '../../src/substrate/memory-pattern-store.js';
import type { Decision } from '../../src/contract/decision.js';

const SPLIT_DECISION: Extract<Decision, { kind: 'split' }> = {
  kind: 'split',
  children: [
    {
      localId: 'a',
      type: 'write-code',
      title: 'Write the thing',
      spec: { file: 'foo.ts' },
      dependsOn: [],
      scope: ['foo.ts'],
      budgetShare: 1,
    },
  ],
};

const SPLIT_B: Extract<Decision, { kind: 'split' }> = {
  kind: 'split',
  children: [
    {
      localId: 'b',
      type: 'review-code',
      title: 'Review it',
      spec: {},
      dependsOn: [],
      scope: [],
      budgetShare: 1,
    },
  ],
};

describe('InMemoryPatternStore', () => {
  let store: InMemoryPatternStore;

  beforeEach(() => {
    store = new InMemoryPatternStore();
  });

  it('returns null for an unknown shape', async () => {
    expect(await store.match('unknown-shape')).toBeNull();
  });

  it('creates a provisional memo on first record (success)', async () => {
    await store.record('shape-a', SPLIT_DECISION, 'success');
    const memo = await store.match('shape-a');
    expect(memo).not.toBeNull();
    expect(memo!.status).toBe('provisional');
    expect(memo!.uses).toBe(1);
    expect(memo!.successes).toBe(1);
    expect(memo!.failures).toBe(0);
    expect(memo!.decision).toEqual(SPLIT_DECISION);
  });

  it('creates a provisional memo on first record (failure)', async () => {
    await store.record('shape-b', SPLIT_DECISION, 'failure');
    const memo = await store.match('shape-b');
    expect(memo!.status).toBe('provisional');
    expect(memo!.uses).toBe(1);
    expect(memo!.successes).toBe(0);
    expect(memo!.failures).toBe(1);
  });

  it('accumulates uses, successes, failures across records', async () => {
    await store.record('shape-c', SPLIT_DECISION, 'success');
    await store.record('shape-c', SPLIT_DECISION, 'success');
    await store.record('shape-c', SPLIT_DECISION, 'failure');
    const memo = await store.match('shape-c');
    expect(memo!.uses).toBe(3);
    expect(memo!.successes).toBe(2);
    expect(memo!.failures).toBe(1);
  });

  it('promotes to trusted', async () => {
    await store.record('shape-d', SPLIT_DECISION, 'success');
    await store.promote('shape-d', 'trusted');
    const memo = await store.match('shape-d');
    expect(memo!.status).toBe('trusted');
  });

  it('demotes from trusted back to provisional', async () => {
    await store.record('shape-d2', SPLIT_DECISION, 'success');
    await store.promote('shape-d2', 'trusted');
    await store.promote('shape-d2', 'provisional');
    const memo = await store.match('shape-d2');
    expect(memo!.status).toBe('provisional');
  });

  it('promote on unknown shape is a no-op', async () => {
    await store.promote('never-recorded', 'trusted');
    expect(await store.match('never-recorded')).toBeNull();
  });

  it('list returns all recorded memos', async () => {
    await store.record('s1', SPLIT_DECISION, 'success');
    await store.record('s2', SPLIT_B, 'failure');
    const all = await store.list();
    expect(all).toHaveLength(2);
    const shapes = all.map((m) => m.shape).sort();
    expect(shapes).toEqual(['s1', 's2']);
  });

  it('list returns empty array when nothing recorded', async () => {
    expect(await store.list()).toEqual([]);
  });

  it('accumulates independently per shape', async () => {
    await store.record('x', SPLIT_DECISION, 'success');
    await store.record('y', SPLIT_B, 'failure');
    const x = await store.match('x');
    const y = await store.match('y');
    expect(x!.successes).toBe(1);
    expect(y!.failures).toBe(1);
    expect(x!.failures).toBe(0);
    expect(y!.successes).toBe(0);
  });

  it('preserves the decision shape after multiple records', async () => {
    await store.record('shape-e', SPLIT_DECISION, 'success');
    await store.record('shape-e', SPLIT_DECISION, 'success');
    const memo = await store.match('shape-e');
    expect(memo!.decision).toEqual(SPLIT_DECISION);
  });
});
