import { describe, it, expect, afterEach, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import pg from 'pg';
import { InMemoryEventStore } from '../../src/eventlog/memory-store.js';
import { JsonlEventStore } from '../../src/eventlog/jsonl-store.js';
import { parseFactoryEvent } from '../../src/contract/event-parser.js';
import type { FactoryEvent } from '../../src/contract/events.js';
import type { KnowledgeArtifact, RegionFacts, DiveFact } from '../../src/contract/knowledge.js';

const { Pool } = pg;

// ── Knowledge event fixtures ──────────────────

const diveFact: DiveFact = {
  claim: 'All requests route through middleware',
  anchors: [{ path: 'src/middleware.ts', line: 42 }],
  sha: 'deadbeef',
  confidence: 'high',
};

const knowledgeArtifact: KnowledgeArtifact = {
  repoRoot: '/repo/cats',
  category: 'architecture',
  generatedAtSha: 'deadbeef',
  confidence: 'high',
  status: 'provisional',
  pointers: [{ path: 'src/index.ts', line: 1, note: 'Entry point' }],
  summary: 'Monolith with a single entry point.',
};

const regionFacts: RegionFacts = {
  repoRoot: '/repo/cats',
  region: 'src/core',
  generatedAtSha: 'deadbeef',
  facts: [diveFact],
};

const knowledgeWritten: FactoryEvent = {
  type: 'knowledge-written',
  at: 7000,
  goalId: 'g1',
  artifact: knowledgeArtifact,
};

const knowledgeFactsWritten: FactoryEvent = {
  type: 'knowledge-facts-written',
  at: 7100,
  goalId: 'g1',
  facts: regionFacts,
};

const knowledgeChecked: FactoryEvent = {
  type: 'knowledge-checked',
  at: 7200,
  goalId: 'g1',
  repoRoot: '/repo/cats',
  category: 'architecture',
  sha: 'cafecafe',
  outcome: 'stale-validated',
};

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

// capture-ran fixture (ADR-042)
const captureRan: FactoryEvent = {
  type: 'capture-ran',
  at: 9500,
  goalId: 'g1',
  captureName: 'invoice-total',
  kind: 'render-document',
  ok: true,
  durationMs: 42,
  outputRef: 'fixtures/runtime-capture/rendered.txt',
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

  it('round-trips a capture-ran event with all required fields', async () => {
    const store = new InMemoryEventStore();
    await store.append(captureRan);

    const all = await store.list({ type: 'capture-ran' });
    expect(all).toHaveLength(1);

    const ev = all[0] as Extract<FactoryEvent, { type: 'capture-ran' }>;
    expect(ev.type).toBe('capture-ran');
    expect(ev.captureName).toBe('invoice-total');
    expect(ev.kind).toBe('render-document');
    expect(ev.ok).toBe(true);
    expect(ev.durationMs).toBe(42);
    expect(ev.outputRef).toBe('fixtures/runtime-capture/rendered.txt');
  });

  it('round-trips a knowledge-written event with artifact fields intact', async () => {
    const store = new InMemoryEventStore();
    await store.append(knowledgeWritten);

    const all = await store.list({ type: 'knowledge-written' });
    expect(all).toHaveLength(1);

    const ev = all[0] as Extract<FactoryEvent, { type: 'knowledge-written' }>;
    expect(ev.artifact.repoRoot).toBe('/repo/cats');
    expect(ev.artifact.category).toBe('architecture');
    expect(ev.artifact.generatedAtSha).toBe('deadbeef');
    expect(ev.artifact.confidence).toBe('high');
    expect(ev.artifact.status).toBe('provisional');
    expect(ev.artifact.pointers).toHaveLength(1);
    expect(ev.artifact.pointers[0]?.path).toBe('src/index.ts');
    expect(ev.artifact.pointers[0]?.line).toBe(1);
    expect(ev.artifact.summary).toBe('Monolith with a single entry point.');
  });

  it('round-trips a knowledge-facts-written event with anchors and SHA intact', async () => {
    const store = new InMemoryEventStore();
    await store.append(knowledgeFactsWritten);

    const all = await store.list({ type: 'knowledge-facts-written' });
    expect(all).toHaveLength(1);

    const ev = all[0] as Extract<FactoryEvent, { type: 'knowledge-facts-written' }>;
    expect(ev.facts.repoRoot).toBe('/repo/cats');
    expect(ev.facts.region).toBe('src/core');
    expect(ev.facts.generatedAtSha).toBe('deadbeef');
    expect(ev.facts.facts).toHaveLength(1);
    expect(ev.facts.facts[0]?.claim).toBe('All requests route through middleware');
    expect(ev.facts.facts[0]?.anchors[0]?.path).toBe('src/middleware.ts');
    expect(ev.facts.facts[0]?.anchors[0]?.line).toBe(42);
    expect(ev.facts.facts[0]?.sha).toBe('deadbeef');
  });

  it('round-trips a knowledge-checked event with all outcome fields intact', async () => {
    const store = new InMemoryEventStore();
    await store.append(knowledgeChecked);

    const all = await store.list({ type: 'knowledge-checked' });
    expect(all).toHaveLength(1);

    const ev = all[0] as Extract<FactoryEvent, { type: 'knowledge-checked' }>;
    expect(ev.repoRoot).toBe('/repo/cats');
    expect(ev.category).toBe('architecture');
    expect(ev.sha).toBe('cafecafe');
    expect(ev.outcome).toBe('stale-validated');
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

  it('skips parseable JSON that is not a valid FactoryEvent', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'corellia-test-'));
    const path = join(tmpDir, 'events.jsonl');
    const store = new JsonlEventStore(path);
    await store.append(goalA);

    appendFileSync(path, `${JSON.stringify({ type: 'not-real', at: 1, goalId: 'bad' })}\n`, 'utf8');
    appendFileSync(path, `${JSON.stringify({ type: 'knowledge-written', at: 2, goalId: 'bad' })}\n`, 'utf8');
    appendFileSync(path, `${JSON.stringify({ type: 'script-ran', at: 3, goalId: 'bad', command: 'test' })}\n`, 'utf8');

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

  it('round-trips knowledge-written through JSONL with artifact fields intact', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'corellia-test-'));
    const store = new JsonlEventStore(join(tmpDir, 'events.jsonl'));
    await store.append(knowledgeWritten);

    const all = await store.list({ type: 'knowledge-written' });
    expect(all).toHaveLength(1);

    const ev = all[0] as Extract<FactoryEvent, { type: 'knowledge-written' }>;
    expect(ev.artifact.repoRoot).toBe('/repo/cats');
    expect(ev.artifact.category).toBe('architecture');
    expect(ev.artifact.generatedAtSha).toBe('deadbeef');
    expect(ev.artifact.pointers[0]?.path).toBe('src/index.ts');
    expect(ev.artifact.pointers[0]?.line).toBe(1);
    expect(ev.artifact.summary).toBe('Monolith with a single entry point.');
  });

  it('round-trips knowledge-facts-written through JSONL with anchors and SHA intact', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'corellia-test-'));
    const store = new JsonlEventStore(join(tmpDir, 'events.jsonl'));
    await store.append(knowledgeFactsWritten);

    const all = await store.list({ type: 'knowledge-facts-written' });
    expect(all).toHaveLength(1);

    const ev = all[0] as Extract<FactoryEvent, { type: 'knowledge-facts-written' }>;
    expect(ev.facts.region).toBe('src/core');
    expect(ev.facts.generatedAtSha).toBe('deadbeef');
    expect(ev.facts.facts[0]?.anchors[0]?.path).toBe('src/middleware.ts');
    expect(ev.facts.facts[0]?.anchors[0]?.line).toBe(42);
    expect(ev.facts.facts[0]?.sha).toBe('deadbeef');
  });

  it('round-trips knowledge-checked through JSONL with outcome intact', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'corellia-test-'));
    const store = new JsonlEventStore(join(tmpDir, 'events.jsonl'));
    await store.append(knowledgeChecked);

    const all = await store.list({ type: 'knowledge-checked' });
    expect(all).toHaveLength(1);

    const ev = all[0] as Extract<FactoryEvent, { type: 'knowledge-checked' }>;
    expect(ev.repoRoot).toBe('/repo/cats');
    expect(ev.category).toBe('architecture');
    expect(ev.sha).toBe('cafecafe');
    expect(ev.outcome).toBe('stale-validated');
  });
});

describe('parseFactoryEvent', () => {
  it('accepts a valid event', () => {
    expect(parseFactoryEvent(scriptRan)).toEqual(scriptRan);
  });

  it('rejects unknown discriminants and missing required payload fields', () => {
    expect(parseFactoryEvent({ type: 'unknown', at: 1, goalId: 'g1' })).toBeNull();
    expect(parseFactoryEvent({ type: 'knowledge-written', at: 1, goalId: 'g1' })).toBeNull();
    expect(parseFactoryEvent({ type: 'script-ran', at: 1, goalId: 'g1', command: 'test' })).toBeNull();
  });
});

// ──────────────────────────────────────────────
// PgEventStore (skipped without DATABASE_URL)
// ──────────────────────────────────────────────

describe.skipIf(!process.env['DATABASE_URL'])('PgEventStore — knowledge events', () => {
  let PgEventStore: typeof import('../../src/substrate/pg-event-store.js').PgEventStore;
  let pool: pg.Pool;
  let store: InstanceType<typeof PgEventStore>;

  beforeAll(async () => {
    const mod = await import('../../src/substrate/pg-event-store.js');
    PgEventStore = mod.PgEventStore;
    pool = new Pool({ connectionString: process.env['DATABASE_URL']! });
    store = new PgEventStore(pool);
    await store.ensureSchema();
    // Clean out any leftover rows from a prior run so assertions stay exact.
    await pool.query(`DELETE FROM corellia_events WHERE goal_id = 'g1'`);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('round-trips knowledge-written through pg with artifact fields intact', async () => {
    await store.append(knowledgeWritten);

    const all = await store.list({ type: 'knowledge-written', goalId: 'g1' });
    const ev = all.at(-1) as Extract<FactoryEvent, { type: 'knowledge-written' }>;
    expect(ev.artifact.repoRoot).toBe('/repo/cats');
    expect(ev.artifact.category).toBe('architecture');
    expect(ev.artifact.generatedAtSha).toBe('deadbeef');
    expect(ev.artifact.pointers[0]?.path).toBe('src/index.ts');
  });

  it('round-trips knowledge-facts-written through pg with anchors intact', async () => {
    await store.append(knowledgeFactsWritten);

    const all = await store.list({ type: 'knowledge-facts-written', goalId: 'g1' });
    const ev = all.at(-1) as Extract<FactoryEvent, { type: 'knowledge-facts-written' }>;
    expect(ev.facts.region).toBe('src/core');
    expect(ev.facts.facts[0]?.anchors[0]?.line).toBe(42);
  });

  it('round-trips knowledge-checked through pg with outcome intact', async () => {
    await store.append(knowledgeChecked);

    const all = await store.list({ type: 'knowledge-checked', goalId: 'g1' });
    const ev = all.at(-1) as Extract<FactoryEvent, { type: 'knowledge-checked' }>;
    expect(ev.outcome).toBe('stale-validated');
    expect(ev.sha).toBe('cafecafe');
  });
});
