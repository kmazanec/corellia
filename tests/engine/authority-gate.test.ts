import { describe, expect, it } from 'vitest';
import { runAuthorityGate } from '../../src/engine/authority-gate.js';
import { MemoryEventStore, makeGoal } from './stubs.js';

describe('authority gate helper', () => {
  it('does nothing when the gate is not required', async () => {
    const store = new MemoryEventStore();

    const report = await runAuthorityGate({
      shouldGate: false,
      goal: makeGoal(),
      risk: 'low',
      typeGated: false,
      store,
      now: () => 1,
      onGate: undefined,
      onBrief: undefined,
      deniedMessage: () => 'denied',
    });

    expect(report).toBeNull();
    expect(await store.list()).toEqual([]);
  });

  it('records granted gates without blocking', async () => {
    const store = new MemoryEventStore();

    const report = await runAuthorityGate({
      shouldGate: true,
      goal: makeGoal({ id: 'g' }),
      risk: 'high',
      typeGated: false,
      store,
      now: () => 2,
      onGate: async () => 'granted',
      onBrief: undefined,
      deniedMessage: () => 'denied',
    });

    expect(report).toBeNull();
    expect(await store.list({ type: 'gate-decision' })).toMatchObject([
      { goalId: 'g', resolution: 'granted' },
    ]);
    expect(await store.list({ type: 'blocked' })).toEqual([]);
  });

  it('fails safe to denied when no gate handler is configured', async () => {
    const store = new MemoryEventStore();

    const report = await runAuthorityGate({
      shouldGate: true,
      goal: makeGoal({ id: 'g' }),
      risk: 'high',
      typeGated: true,
      store,
      now: () => 3,
      onGate: undefined,
      onBrief: undefined,
      deniedMessage: (brief) => `Authority gate denied: ${brief.question}`,
    });

    expect(report?.blockers[0]).toContain('Authority gate denied');
    expect(await store.list({ type: 'gate-decision' })).toMatchObject([
      { goalId: 'g', resolution: 'denied' },
    ]);
    expect(await store.list({ type: 'blocked' })).toHaveLength(1);
    expect(await store.list({ type: 'emitted' })).toHaveLength(1);
  });
});
