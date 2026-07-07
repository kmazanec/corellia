/**
 * `corellia label` — the exogenous ground-truth ingestion command. Parses argv
 * and appends one `golden-label` event to an injected store (never the real
 * filesystem), so the projection can join the outcome to a tree's candidates.
 */

import { describe, it, expect } from 'vitest';
import { parseLabelArgs, runLabel } from '../../src/eventlog/label-cli.js';
import { MemoryEventStore } from '../engine/stubs.js';
import type { FactoryEvent } from '../../src/contract/events.js';

function io() {
  const out: string[] = [];
  const err: string[] = [];
  return { log: (l: string) => out.push(l), error: (l: string) => err.push(l), out, err };
}

describe('parseLabelArgs', () => {
  it('parses tree, outcome, source, and note', () => {
    const args = parseLabelArgs(['tree-1', 'merged', '--source', 'pr-listener', '--note', 'shipped clean']);
    expect(args.tree).toBe('tree-1');
    expect(args.outcome).toBe('merged');
    expect(args.source).toBe('pr-listener');
    expect(args.note).toBe('shipped clean');
    expect(args.error).toBeUndefined();
  });

  it('defaults source to operator', () => {
    const args = parseLabelArgs(['tree-1', 'rejected']);
    expect(args.source).toBe('operator');
  });

  it('errors on an unknown outcome', () => {
    const args = parseLabelArgs(['tree-1', 'bogus']);
    expect(args.error).toMatch(/unknown outcome/);
  });

  it('errors when tree or outcome is missing', () => {
    expect(parseLabelArgs([]).error).toMatch(/usage/);
    expect(parseLabelArgs(['tree-1']).error).toMatch(/usage/);
  });
});

describe('runLabel', () => {
  it('appends a golden-label event with a deterministic clock', async () => {
    const store = new MemoryEventStore();
    const c = io();
    const { code } = await runLabel(
      parseLabelArgs(['tree-1', 'merged', '--note', 'ok']),
      c,
      {},
      { now: () => 4242, makeStore: () => store },
    );
    expect(code).toBe(0);
    const events = (await store.list()) as FactoryEvent[];
    expect(events).toHaveLength(1);
    const e = events[0]!;
    expect(e).toMatchObject({ type: 'golden-label', at: 4242, goalId: 'tree-1', outcome: 'merged', source: 'operator', note: 'ok' });
    expect(c.out[0]).toContain('labeled tree-1 → merged');
  });

  it('omits note when absent', async () => {
    const store = new MemoryEventStore();
    await runLabel(parseLabelArgs(['tree-1', 'refuted']), io(), {}, { now: () => 1, makeStore: () => store });
    const e = (await store.list())[0] as { note?: string };
    expect(e.note).toBeUndefined();
  });

  it('returns exit code 2 on a malformed invocation', async () => {
    const c = io();
    const { code } = await runLabel(parseLabelArgs(['tree-1', 'bogus']), c, {}, { makeStore: () => new MemoryEventStore() });
    expect(code).toBe(2);
    expect(c.err[0]).toMatch(/unknown outcome/);
  });
});
