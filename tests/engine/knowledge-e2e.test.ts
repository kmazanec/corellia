/**
 * End-to-end engine path tests for map-repo and deep-dive-region goal types.
 *
 * These tests drive the goals through the engine's existing leaf path using a
 * scripted brain and real deterministic checks (from knowledge-checks.ts).
 * They prove:
 *   1. A valid artifact passes the deterministic gate and the engine emits.
 *   2. An invalid artifact (bad pointers / bad anchors) blocks at the gate —
 *      the judge is never consulted.
 *   3. A knowledge-written event can be appended after a successful run via the
 *      inline write helper matching F-41's frozen signature.
 *      (Integration with F-41's full assembly machinery happens at assembly;
 *      this test uses a local inline helper to prove the event contract.)
 *
 * No network. No real import scanner (synthetic scan fns). Tmp-dir fixture
 * repos with real files for the path-existence checks.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Engine } from '../../src/engine/engine.js';
import {
  MemoryEventStore,
  NoopMemoryView,
  ScriptedBrain,
  buildRegistry,
  makeGoal,
} from './stubs.js';
import { leafTypeDef } from './stubs.js';
import { mapRepoCheck, diveAnchorCheck } from '../../src/library/knowledge-checks.js';
import { artifactPresent } from '../../src/library/checks.js';
import type { KnowledgeArtifact, RegionFacts } from '../../src/contract/knowledge.js';
import type { FactoryEvent, EventStore } from '../../src/contract/events.js';
import type { Artifact } from '../../src/contract/report.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let tmpDirs: string[] = [];

function makeTmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'corellia-ke2e-'));
  tmpDirs.push(d);
  return d;
}

afterEach(() => {
  for (const d of tmpDirs) {
    try { rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
  }
  tmpDirs = [];
});

function knowledgeArtifactText(repoRoot: string, overrides: Partial<KnowledgeArtifact> = {}): Artifact {
  const ka: KnowledgeArtifact = {
    repoRoot,
    category: 'architecture',
    generatedAtSha: 'deadbeef',
    confidence: 'high',
    status: 'provisional',
    pointers: [],
    summary: 'Test architecture knowledge',
    ...overrides,
  };
  return { kind: 'text', text: JSON.stringify(ka) };
}

function regionFactsText(repoRoot: string, overrides: Partial<RegionFacts> = {}): Artifact {
  const rf: RegionFacts = {
    repoRoot,
    region: 'src/auth',
    generatedAtSha: 'deadbeef',
    facts: [],
    ...overrides,
  };
  return { kind: 'text', text: JSON.stringify(rf) };
}

/**
 * Inline helper that appends a knowledge-written event to the store.
 * Matches F-41's frozen signature: { type: 'knowledge-written', at, goalId, artifact }.
 * Integration with F-41's full assembly machinery happens at assembly;
 * this helper is the test stand-in.
 */
async function writeKnowledge(
  store: EventStore,
  goalId: string,
  artifact: KnowledgeArtifact,
  at = Date.now(),
): Promise<void> {
  const event: FactoryEvent = {
    type: 'knowledge-written',
    at,
    goalId,
    artifact,
  };
  await store.append(event);
}

/**
 * Inline helper that appends a knowledge-facts-written event.
 * Matches the frozen signature from contract/events.ts.
 */
async function writeKnowledgeFacts(
  store: EventStore,
  goalId: string,
  facts: RegionFacts,
  at = Date.now(),
): Promise<void> {
  const event: FactoryEvent = {
    type: 'knowledge-facts-written',
    at,
    goalId,
    facts,
  };
  await store.append(event);
}

// ---------------------------------------------------------------------------
// map-repo: valid artifact → gate passes → engine emits
// ---------------------------------------------------------------------------

describe('map-repo leaf — valid artifact', () => {
  it('engine emits when artifact passes the deterministic gate', async () => {
    const repoRoot = makeTmp();
    mkdirSync(join(repoRoot, 'src'), { recursive: true });
    writeFileSync(join(repoRoot, 'src', 'index.ts'), 'export {}');

    const artifact = knowledgeArtifactText(repoRoot, {
      category: 'architecture',
      pointers: [{ path: 'src/index.ts', note: 'entry point' }],
    });

    const store = new MemoryEventStore();
    const brain = new ScriptedBrain().queueProduce(artifact);
    const registry = buildRegistry([
      leafTypeDef({
        name: 'map-repo',
        kind: 'learn',
        family: 'comprehend',
        leafOnly: true,
        tier: { default: 'haiku', ladder: ['haiku', 'sonnet'] },
        deterministic: [artifactPresent, mapRepoCheck(async () => [])],
        judgeType: null,
        grants: ['fs.read', 'retrieval.api', 'test.run_scoped'],
      }),
    ]);

    const engine = new Engine({ registry, brain, store, memory: new NoopMemoryView() });
    const goal = makeGoal({ type: 'map-repo', id: 'g-map-repo' });
    const report = await engine.run(goal);

    // Gate passed: engine emits with no blockers
    expect(report.blockers).toHaveLength(0);
    expect(report.artifact).toEqual(artifact);

    // deterministic-checked event emitted
    const detEvents = await store.list({ type: 'deterministic-checked' });
    expect(detEvents.length).toBeGreaterThan(0);
    const det = detEvents[0] as Extract<FactoryEvent, { type: 'deterministic-checked' }>;
    expect(det.verdict.pass).toBe(true);

    // No judge-verdict event (learn type has no judge)
    const judgeEvents = await store.list({ type: 'judge-verdict' });
    expect(judgeEvents).toHaveLength(0);
  });

  it('appends a knowledge-written event after engine emits (inline write helper)', async () => {
    const repoRoot = makeTmp();
    writeFileSync(join(repoRoot, 'readme.md'), '# Repo');

    const ka: KnowledgeArtifact = {
      repoRoot,
      category: 'conventions',
      generatedAtSha: 'sha123',
      confidence: 'medium',
      status: 'provisional',
      pointers: [{ path: 'readme.md', note: 'naming conventions reference' }],
      summary: 'Conventions artifact',
    };
    const artifact: Artifact = { kind: 'text', text: JSON.stringify(ka) };

    const store = new MemoryEventStore();
    const brain = new ScriptedBrain().queueProduce(artifact);
    const registry = buildRegistry([
      leafTypeDef({
        name: 'map-repo',
        kind: 'learn',
        family: 'comprehend',
        leafOnly: true,
        tier: { default: 'haiku', ladder: ['haiku', 'sonnet'] },
        deterministic: [artifactPresent, mapRepoCheck(async () => [])],
        judgeType: null,
        grants: ['fs.read', 'retrieval.api', 'test.run_scoped'],
      }),
    ]);

    const engine = new Engine({ registry, brain, store, memory: new NoopMemoryView() });
    const goal = makeGoal({ type: 'map-repo', id: 'g-conventions' });
    const report = await engine.run(goal);

    // Gate passed
    expect(report.blockers).toHaveLength(0);

    // Write the knowledge-written event (integration-at-assembly: F-41 does this in production)
    await writeKnowledge(store, goal.id, ka);

    // Verify the event is in the log with the correct frozen shape
    const kwEvents = await store.list({ type: 'knowledge-written' });
    expect(kwEvents).toHaveLength(1);
    const kw = kwEvents[0] as Extract<FactoryEvent, { type: 'knowledge-written' }>;
    expect(kw.goalId).toBe(goal.id);
    expect(kw.artifact.category).toBe('conventions');
    expect(kw.artifact.repoRoot).toBe(repoRoot);
    expect(kw.artifact.pointers).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// map-repo: invalid artifact → gate blocks → judge never called
// ---------------------------------------------------------------------------

describe('map-repo leaf — invalid artifact (deterministic gate blocks)', () => {
  it('engine blocks when pointer paths are missing from disk', async () => {
    const repoRoot = makeTmp();

    // Artifact claims a pointer path that does not exist
    const artifact = knowledgeArtifactText(repoRoot, {
      category: 'architecture',
      pointers: [{ path: 'missing-module.ts', note: 'does not exist' }],
    });

    const store = new MemoryEventStore();
    // Brain produces the bad artifact repeatedly (single-rung ladder → exhausts after 1 attempt)
    const brain = new ScriptedBrain().queueProduce(artifact);
    const registry = buildRegistry([
      leafTypeDef({
        name: 'map-repo',
        kind: 'learn',
        family: 'comprehend',
        leafOnly: true,
        tier: { default: 'haiku', ladder: ['haiku'] },
        deterministic: [artifactPresent, mapRepoCheck(async () => [])],
        judgeType: null,
        grants: ['fs.read', 'retrieval.api', 'test.run_scoped'],
      }),
    ]);

    const engine = new Engine({ registry, brain, store, memory: new NoopMemoryView() });
    const goal = makeGoal({
      type: 'map-repo',
      id: 'g-bad-arch',
      budget: { attempts: 1, tokens: 1000, toolCalls: 50, wallClockMs: 60000 },
    });
    const report = await engine.run(goal);

    // Gate blocked: report has blockers
    expect(report.blockers.length).toBeGreaterThan(0);

    // Deterministic check failed
    const detEvents = await store.list({ type: 'deterministic-checked' });
    expect(detEvents.length).toBeGreaterThan(0);
    const det = detEvents[0] as Extract<FactoryEvent, { type: 'deterministic-checked' }>;
    expect(det.verdict.pass).toBe(false);
    expect(det.verdict.findings[0]?.title).toContain('missing-module.ts');

    // Judge was never consulted
    const judgeEvents = await store.list({ type: 'judge-verdict' });
    expect(judgeEvents).toHaveLength(0);
  });

  it('engine blocks when artifact is not valid JSON', async () => {
    const store = new MemoryEventStore();
    const brain = new ScriptedBrain().queueProduce({ kind: 'text', text: 'not-json-at-all' });
    const registry = buildRegistry([
      leafTypeDef({
        name: 'map-repo',
        kind: 'learn',
        family: 'comprehend',
        leafOnly: true,
        tier: { default: 'haiku', ladder: ['haiku'] },
        deterministic: [artifactPresent, mapRepoCheck(async () => [])],
        judgeType: null,
        grants: ['fs.read', 'retrieval.api', 'test.run_scoped'],
      }),
    ]);

    const engine = new Engine({ registry, brain, store, memory: new NoopMemoryView() });
    const goal = makeGoal({
      type: 'map-repo',
      id: 'g-bad-json',
      budget: { attempts: 1, tokens: 1000, toolCalls: 50, wallClockMs: 60000 },
    });
    const report = await engine.run(goal);

    expect(report.blockers.length).toBeGreaterThan(0);

    const judgeEvents = await store.list({ type: 'judge-verdict' });
    expect(judgeEvents).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// deep-dive-region: valid facts → gate passes → knowledge-facts-written event
// ---------------------------------------------------------------------------

describe('deep-dive-region leaf — valid facts', () => {
  it('engine emits when all anchors exist and lines are valid', async () => {
    const repoRoot = makeTmp();
    mkdirSync(join(repoRoot, 'src'), { recursive: true });
    writeFileSync(join(repoRoot, 'src', 'auth.ts'), 'line1\nline2\nline3\nline4\nline5\n');

    const rf: RegionFacts = {
      repoRoot,
      region: 'src/auth',
      generatedAtSha: 'sha456',
      facts: [
        {
          claim: 'auth module exports middleware at line 3',
          anchors: [{ path: 'src/auth.ts', line: 3 }],
          sha: 'sha456',
          confidence: 'high',
        },
      ],
    };
    const artifact: Artifact = { kind: 'text', text: JSON.stringify(rf) };

    const store = new MemoryEventStore();
    const brain = new ScriptedBrain().queueProduce(artifact);
    const registry = buildRegistry([
      leafTypeDef({
        name: 'deep-dive-region',
        kind: 'learn',
        family: 'comprehend',
        leafOnly: true,
        tier: { default: 'sonnet', ladder: ['sonnet', 'opus'] },
        deterministic: [artifactPresent, diveAnchorCheck()],
        judgeType: null,
        grants: ['fs.read', 'retrieval.api'],
      }),
    ]);

    const engine = new Engine({ registry, brain, store, memory: new NoopMemoryView() });
    const goal = makeGoal({ type: 'deep-dive-region', id: 'g-dive' });
    const report = await engine.run(goal);

    // Gate passed
    expect(report.blockers).toHaveLength(0);
    expect(report.artifact).toEqual(artifact);

    // Append the knowledge-facts-written event (integration-at-assembly)
    await writeKnowledgeFacts(store, goal.id, rf);

    const kfwEvents = await store.list({ type: 'knowledge-facts-written' });
    expect(kfwEvents).toHaveLength(1);
    const kfw = kfwEvents[0] as Extract<FactoryEvent, { type: 'knowledge-facts-written' }>;
    expect(kfw.goalId).toBe(goal.id);
    expect(kfw.facts.region).toBe('src/auth');
    expect(kfw.facts.facts).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// deep-dive-region: bad anchors → gate blocks
// ---------------------------------------------------------------------------

describe('deep-dive-region leaf — invalid anchors (deterministic gate blocks)', () => {
  it('engine blocks when an anchor path does not exist on disk', async () => {
    const repoRoot = makeTmp();

    const rf: RegionFacts = {
      repoRoot,
      region: 'src/auth',
      generatedAtSha: 'sha456',
      facts: [
        {
          claim: 'claim about a deleted file',
          anchors: [{ path: 'src/deleted-auth.ts', line: 1 }],
          sha: 'sha456',
          confidence: 'high',
        },
      ],
    };
    const artifact: Artifact = { kind: 'text', text: JSON.stringify(rf) };

    const store = new MemoryEventStore();
    const brain = new ScriptedBrain().queueProduce(artifact);
    const registry = buildRegistry([
      leafTypeDef({
        name: 'deep-dive-region',
        kind: 'learn',
        family: 'comprehend',
        leafOnly: true,
        tier: { default: 'sonnet', ladder: ['sonnet'] },
        deterministic: [artifactPresent, diveAnchorCheck()],
        judgeType: null,
        grants: ['fs.read', 'retrieval.api'],
      }),
    ]);

    const engine = new Engine({ registry, brain, store, memory: new NoopMemoryView() });
    const goal = makeGoal({
      type: 'deep-dive-region',
      id: 'g-bad-dive',
      budget: { attempts: 1, tokens: 1000, toolCalls: 50, wallClockMs: 60000 },
    });
    const report = await engine.run(goal);

    // Gate blocked
    expect(report.blockers.length).toBeGreaterThan(0);

    const detEvents = await store.list({ type: 'deterministic-checked' });
    const det = detEvents[0] as Extract<FactoryEvent, { type: 'deterministic-checked' }>;
    expect(det.verdict.pass).toBe(false);
    expect(det.verdict.findings[0]?.title).toContain('deleted-auth.ts');

    // Judge never called
    const judgeEvents = await store.list({ type: 'judge-verdict' });
    expect(judgeEvents).toHaveLength(0);
  });

  it('engine blocks when anchor line exceeds file line count', async () => {
    const repoRoot = makeTmp();
    writeFileSync(join(repoRoot, 'tiny.ts'), 'only one line');

    const rf: RegionFacts = {
      repoRoot,
      region: 'root',
      generatedAtSha: 'sha789',
      facts: [
        {
          claim: 'claim at line 999',
          anchors: [{ path: 'tiny.ts', line: 999 }],
          sha: 'sha789',
          confidence: 'low',
        },
      ],
    };
    const artifact: Artifact = { kind: 'text', text: JSON.stringify(rf) };

    const store = new MemoryEventStore();
    const brain = new ScriptedBrain().queueProduce(artifact);
    const registry = buildRegistry([
      leafTypeDef({
        name: 'deep-dive-region',
        kind: 'learn',
        family: 'comprehend',
        leafOnly: true,
        tier: { default: 'sonnet', ladder: ['sonnet'] },
        deterministic: [artifactPresent, diveAnchorCheck()],
        judgeType: null,
        grants: ['fs.read', 'retrieval.api'],
      }),
    ]);

    const engine = new Engine({ registry, brain, store, memory: new NoopMemoryView() });
    const goal = makeGoal({
      type: 'deep-dive-region',
      id: 'g-bad-line',
      budget: { attempts: 1, tokens: 1000, toolCalls: 50, wallClockMs: 60000 },
    });
    const report = await engine.run(goal);

    expect(report.blockers.length).toBeGreaterThan(0);

    const judgeEvents = await store.list({ type: 'judge-verdict' });
    expect(judgeEvents).toHaveLength(0);
  });
});
