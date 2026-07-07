import { describe, it, expect } from 'vitest';
import {
  parseTrustArgs,
  runTrust,
  runPatternsList,
  promotionCandidates,
  OPERATOR_GOAL_ID,
} from '../../src/eventlog/patterns-cli.js';
import { InMemoryPatternStore } from '../../src/substrate/memory-pattern-store.js';
import { InMemoryEventStore } from '../../src/eventlog/memory-store.js';
import type { LogsConsole } from '../../src/eventlog/logs-cli.js';
import type { Decision } from '../../src/contract/decision.js';

const splitDecision: Extract<Decision, { kind: 'split' }> = { kind: 'split', children: [] };

function captureIo(): { io: LogsConsole; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return { io: { log: (l) => out.push(l), error: (l) => err.push(l) }, out, err };
}

async function seededStore(): Promise<InMemoryPatternStore> {
  const patterns = new InMemoryPatternStore();
  await patterns.record('shape-a', splitDecision, 'success');
  await patterns.record('shape-a', splitDecision, 'success');
  return patterns;
}

describe('parseTrustArgs', () => {
  it('reads the shape positionally and --by / --rationale flags', () => {
    expect(parseTrustArgs(['shape-a', '--by', 'keith', '--rationale', 'proved out'])).toEqual({
      shape: 'shape-a',
      by: 'keith',
      rationale: 'proved out',
    });
  });

  it('leaves by/rationale undefined when absent', () => {
    expect(parseTrustArgs(['shape-a'])).toEqual({ shape: 'shape-a', by: undefined, rationale: undefined });
  });
});

describe('runTrust — promotion (the authority gap)', () => {
  it('appends a pattern-trust-signed event with signer provenance and promotes the memo', async () => {
    const patterns = await seededStore();
    const store = new InMemoryEventStore();
    const { io, out } = captureIo();

    const code = await runTrust(
      'trusted',
      { shape: 'shape-a', by: 'keith', rationale: 'reviewed the recurrence' },
      patterns,
      store,
      io,
      () => 42,
    );

    expect(code).toBe(0);

    const signed = await store.list({ type: 'pattern-trust-signed' });
    expect(signed).toHaveLength(1);
    expect(signed[0]).toMatchObject({
      type: 'pattern-trust-signed',
      shape: 'shape-a',
      from: 'provisional',
      to: 'trusted',
      signer: 'keith',
      rationale: 'reviewed the recurrence',
      goalId: OPERATOR_GOAL_ID,
    });

    // Store actually promoted.
    expect((await patterns.match('shape-a'))?.status).toBe('trusted');
    expect(out.join('\n')).toContain('signed off by keith');
  });

  it('refuses an anonymous promotion — --by is required', async () => {
    const patterns = await seededStore();
    const store = new InMemoryEventStore();
    const { io, err } = captureIo();

    const code = await runTrust('trusted', { shape: 'shape-a', by: undefined, rationale: undefined }, patterns, store, io);

    expect(code).toBe(2);
    expect(err.join('\n')).toContain('--by');
    expect(await store.list({ type: 'pattern-trust-signed' })).toHaveLength(0);
  });

  it('reports a clear error when the shape is unknown, appending nothing', async () => {
    const patterns = new InMemoryPatternStore(); // empty
    const store = new InMemoryEventStore();
    const { io, err } = captureIo();

    const code = await runTrust('trusted', { shape: 'ghost', by: 'keith', rationale: undefined }, patterns, store, io);

    expect(code).toBe(1);
    expect(err.join('\n')).toContain('No split memo recorded');
    expect(await store.list({ type: 'pattern-trust-signed' })).toHaveLength(0);
  });

  it('is a no-op (no event) when the memo is already at the target plane', async () => {
    const patterns = await seededStore();
    await patterns.promote('shape-a', 'trusted');
    const store = new InMemoryEventStore();
    const { io, out } = captureIo();

    const code = await runTrust('trusted', { shape: 'shape-a', by: 'keith', rationale: undefined }, patterns, store, io);

    expect(code).toBe(0);
    expect(await store.list({ type: 'pattern-trust-signed' })).toHaveLength(0);
    expect(out.join('\n')).toContain('already trusted');
  });
});

describe('runTrust — demotion mirrors promotion', () => {
  it('demotes a trusted memo back to provisional with signed provenance', async () => {
    const patterns = await seededStore();
    await patterns.promote('shape-a', 'trusted');
    const store = new InMemoryEventStore();
    const { io } = captureIo();

    const code = await runTrust('provisional', { shape: 'shape-a', by: 'keith', rationale: 'golden divergence' }, patterns, store, io, () => 7);

    expect(code).toBe(0);
    expect((await patterns.match('shape-a'))?.status).toBe('provisional');
    const signed = await store.list({ type: 'pattern-trust-signed' });
    expect(signed[0]).toMatchObject({ from: 'trusted', to: 'provisional', signer: 'keith' });
  });
});

describe('runPatternsList', () => {
  it('lists recorded memos with their stats and trust plane', async () => {
    const patterns = await seededStore();
    const { io, out } = captureIo();

    const code = await runPatternsList(patterns, io);

    expect(code).toBe(0);
    const text = out.join('\n');
    expect(text).toContain('shape-a');
    expect(text).toContain('provisional');
    expect(text).toContain('1 split memo');
  });

  it('reports emptiness cleanly', async () => {
    const { io, out } = captureIo();
    const code = await runPatternsList(new InMemoryPatternStore(), io);
    expect(code).toBe(0);
    expect(out.join('\n')).toContain('No split memos recorded');
  });
});

describe('promotionCandidates', () => {
  it('shortlists provisional memos that have recurred, excluding trusted ones', () => {
    const candidates = promotionCandidates([
      { shape: 'a', decision: splitDecision, status: 'provisional', uses: 3, successes: 3, failures: 0 },
      { shape: 'b', decision: splitDecision, status: 'provisional', uses: 1, successes: 1, failures: 0 },
      { shape: 'c', decision: splitDecision, status: 'trusted', uses: 9, successes: 9, failures: 0 },
    ]);

    expect(candidates.map((c) => c.shape)).toEqual(['a']);
    expect(candidates[0]?.uses).toBe(3);
  });
});
