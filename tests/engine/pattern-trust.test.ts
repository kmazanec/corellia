import { describe, expect, it } from 'vitest';
import type { Decision } from '../../src/contract/decision.js';
import type { FactoryEvent, EventStore } from '../../src/contract/events.js';
import type { PatternStore, SplitMemo } from '../../src/contract/pattern.js';
import { promotePatternTrust } from '../../src/engine/pattern-trust.js';

const splitDecision: Extract<Decision, { kind: 'split' }> = {
  kind: 'split',
  children: [],
};

class OrderedEventStore implements EventStore {
  readonly events: FactoryEvent[] = [];
  constructor(private readonly order: string[]) {}

  async append(e: FactoryEvent): Promise<void> {
    this.order.push(`append:${e.type}`);
    this.events.push(e);
  }

  async list(): Promise<FactoryEvent[]> {
    return [...this.events];
  }
}

class OrderedPatternStore implements PatternStore {
  private memo: SplitMemo | null = {
    shape: 'shape-a',
    decision: splitDecision,
    status: 'provisional',
    uses: 1,
    successes: 1,
    failures: 0,
  };

  constructor(private readonly order: string[]) {}

  async match(shape: string): Promise<SplitMemo | null> {
    this.order.push(`match:${shape}`);
    return this.memo;
  }

  async record(): Promise<void> {
    throw new Error('not used');
  }

  async promote(shape: string, to: 'provisional' | 'trusted'): Promise<void> {
    this.order.push(`promote:${shape}:${to}`);
    if (this.memo !== null) this.memo = { ...this.memo, status: to };
  }

  async list(): Promise<SplitMemo[]> {
    return this.memo === null ? [] : [this.memo];
  }
}

describe('promotePatternTrust', () => {
  it('appends the trust event before mutating the pattern store', async () => {
    const order: string[] = [];
    const patterns = new OrderedPatternStore(order);
    const store = new OrderedEventStore(order);

    const result = await promotePatternTrust({
      patterns,
      store,
      now: () => 123,
      goalId: 'g1',
      shape: 'shape-a',
      to: 'trusted',
      signer: 'keith',
      rationale: 'human reviewed repeated success',
    });

    expect(result).toEqual({ ok: true, changed: true });
    expect(order).toEqual([
      'match:shape-a',
      'append:pattern-trust-signed',
      'promote:shape-a:trusted',
    ]);
    expect(store.events[0]).toMatchObject({
      type: 'pattern-trust-signed',
      from: 'provisional',
      to: 'trusted',
      signer: 'keith',
    });
  });

  it('does not append an event when the memo is already at the target status', async () => {
    const order: string[] = [];
    const patterns = new OrderedPatternStore(order);
    const store = new OrderedEventStore(order);
    await patterns.promote('shape-a', 'trusted');

    const result = await promotePatternTrust({
      patterns,
      store,
      now: () => 123,
      goalId: 'g1',
      shape: 'shape-a',
      to: 'trusted',
      signer: 'keith',
      rationale: 'already trusted',
    });

    expect(result).toEqual({ ok: true, changed: false });
    expect(store.events).toHaveLength(0);
  });
});
