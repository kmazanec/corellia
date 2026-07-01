/**
 * ADR-029 — comprehension recurses (engine integration tests).
 *
 * Proves the structured integration merge for the comprehend family: a `map-repo`
 * / `deep-dive-region` goal that the brain SPLITS has its children's structured
 * artifacts merged into ONE parent artifact that
 *   (a) passes the same deterministic gate (mapRepoCheck / diveAnchorCheck) a
 *       leaf artifact passes,
 *   (b) lands a single knowledge-written / knowledge-facts-written event via the
 *       same persist path a leaf uses, and
 *   (c) carries generatedAtSha = the parent's HEAD SHA and status 'provisional'.
 *
 * The generic text-join would concatenate child JSON blobs into invalid JSON;
 * these tests are the regression guard that the comprehend branch replaces it.
 *
 * No network, no sandbox: the coverage gate is skipped without an active
 * assembly, so the split runs the children straight through and the merge fires
 * at the integrate edge. Tmp-dir fixtures supply real files for the gate's
 * path/anchor existence checks. The merged artifact's HEAD SHA is supplied by a
 * stub `knowledge.headSha` hook (the same source the leaf path uses).
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
import { mapRepoCheck, diveAnchorCheck } from '../../src/library/knowledge-checks.js';
import { artifactPresent } from '../../src/library/checks.js';
import { writeKnowledge, writeRegionFacts } from '../../src/library/knowledge.js';
import type { KnowledgeArtifact, RegionFacts } from '../../src/contract/knowledge.js';
import type { FactoryEvent } from '../../src/contract/events.js';
import type { Artifact } from '../../src/contract/report.js';
import type { Goal } from '../../src/contract/goal.js';
import type { GoalTypeDef } from '../../src/contract/goal-type.js';
import type { ChildPlan, Decision } from '../../src/contract/decision.js';
import type { EngineOptions } from '../../src/engine/engine.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let tmpDirs: string[] = [];

function makeTmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'corellia-adr029-'));
  tmpDirs.push(d);
  return d;
}

afterEach(() => {
  for (const d of tmpDirs) {
    try { rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
  }
  tmpDirs = [];
});

const PARENT_SHA = 'parent-head-sha';

/**
 * A knowledge wiring stub that supplies the parent HEAD SHA the merge anchors to
 * and the persist hook that lands knowledge events — the same helpers assembly
 * wires in production. Without an active sandbox the coverage gate is skipped, so
 * the rest of the wiring is never consulted.
 */
function stubKnowledge(store: MemoryEventStore): NonNullable<EngineOptions['knowledge']> {
  return {
    query: async () => ({ headSha: PARENT_SHA, artifacts: [], regionFacts: [] }),
    headSha: async () => PARENT_SHA,
    validate: async () => true,
    mintComprehension: () => [],
    persist: async (goal: Goal, artifact: Artifact): Promise<void> => {
      // Mirror assembly's persistLearnArtifact: parse the artifact and route to
      // the right knowledge event by shape.
      if (artifact.kind !== 'text' || !artifact.text) return;
      let parsed: unknown;
      try { parsed = JSON.parse(artifact.text); } catch { return; }
      if (typeof parsed !== 'object' || parsed === null) return;
      const obj = parsed as Record<string, unknown>;
      if (typeof obj['region'] === 'string' && Array.isArray(obj['facts'])) {
        await writeRegionFacts(store, goal.id, parsed as RegionFacts);
      } else if (typeof obj['category'] === 'string' && Array.isArray(obj['pointers'])) {
        await writeKnowledge(store, goal.id, parsed as KnowledgeArtifact);
      }
    },
  };
}

function mapRepoType(): GoalTypeDef {
  return {
    name: 'map-repo',
    kind: 'learn',
    family: 'comprehend',
    leafOnly: false,
    tier: { default: 'mid', ladder: ['mid'] },
    deterministic: [artifactPresent, mapRepoCheck(async () => [])],
    judgeType: null,
    grants: ['fs.read', 'retrieval.api', 'test.run_scoped'],
  };
}

function diveType(): GoalTypeDef {
  return {
    name: 'deep-dive-region',
    kind: 'learn',
    family: 'comprehend',
    leafOnly: false,
    tier: { default: 'mid', ladder: ['mid'] },
    deterministic: [artifactPresent, diveAnchorCheck()],
    judgeType: null,
    grants: ['fs.read', 'retrieval.api'],
  };
}

// ---------------------------------------------------------------------------
// map-repo split → KnowledgeArtifact merge
// ---------------------------------------------------------------------------

describe('ADR-029 — map-repo split merges children into ONE KnowledgeArtifact', () => {
  it('merges two child KnowledgeArtifacts, passes mapRepoCheck, lands one knowledge-written event', async () => {
    const repoRoot = makeTmp();
    mkdirSync(join(repoRoot, 'src'), { recursive: true });
    mkdirSync(join(repoRoot, 'lib'), { recursive: true });
    writeFileSync(join(repoRoot, 'src', 'a.ts'), 'export {}');
    writeFileSync(join(repoRoot, 'lib', 'b.ts'), 'export {}');

    const childA: KnowledgeArtifact = {
      repoRoot,
      category: 'conventions',
      generatedAtSha: PARENT_SHA,
      confidence: 'high',
      status: 'provisional',
      pointers: [{ path: 'src/a.ts', note: 'src sub-region convention exemplar' }],
      summary: 'src follows the export-{} convention.',
    };
    const childB: KnowledgeArtifact = {
      repoRoot,
      category: 'conventions',
      generatedAtSha: PARENT_SHA,
      confidence: 'medium', // conservative min should win → merged confidence 'medium'
      status: 'provisional',
      pointers: [{ path: 'lib/b.ts', note: 'lib sub-region convention exemplar' }],
      summary: 'lib mirrors the same convention.',
    };

    const splitDecision: Decision = {
      kind: 'split',
      children: [
        childPlan('map-src', 'map-repo', ['src/']),
        childPlan('map-lib', 'map-repo', ['lib/']),
      ],
    };

    const brain = new ScriptedBrain()
      // parent decide → split
      .queueDecide(splitDecision)
      // each child decide → satisfy
      .queueDecide({ kind: 'satisfy' }, { kind: 'satisfy' })
      // each child produce → its artifact
      .queueProduce(
        { kind: 'text', text: JSON.stringify(childA) },
        { kind: 'text', text: JSON.stringify(childB) },
      );

    const store = new MemoryEventStore();
    const registry = buildRegistry([mapRepoType()]);
    const engine = new Engine({
      registry,
      brain,
      store,
      memory: new NoopMemoryView(),
      knowledge: stubKnowledge(store),
      sensitivity: [],
    });

    const goal = makeGoal({
      type: 'map-repo',
      id: 'g-map-split',
      title: 'map conventions across the repo',
      spec: { repoRoot, category: 'conventions' },
      scope: ['src/', 'lib/'],
      budget: { attempts: 4, tokens: 100_000, toolCalls: 50, wallClockMs: 120_000 },
    });

    const report = await engine.run(goal);

    // The split converged with no blockers — the merge passed the gate.
    expect(report.blockers).toHaveLength(0);
    expect(report.artifact).not.toBeNull();
    expect(report.artifact!.kind).toBe('text');

    // The merged artifact is ONE valid KnowledgeArtifact (not concatenated JSON).
    const merged = JSON.parse((report.artifact as { kind: 'text'; text: string }).text) as KnowledgeArtifact;
    expect(merged.category).toBe('conventions');
    expect(merged.status).toBe('provisional');
    expect(merged.generatedAtSha).toBe(PARENT_SHA); // parent's HEAD SHA
    expect(merged.confidence).toBe('medium'); // conservative min across children
    // Union of pointers from both children.
    const paths = merged.pointers.map((p) => p.path).sort();
    expect(paths).toEqual(['lib/b.ts', 'src/a.ts']);
    // Summary concatenates both children.
    expect(merged.summary).toContain('src follows');
    expect(merged.summary).toContain('lib mirrors');

    // Exactly ONE knowledge-written event landed for the PARENT goal — the merged
    // artifact, persisted via the same leaf knowledge path. (Sub-region children
    // persist their own artifacts under their own goalIds; the merge adds the
    // parent's single unified artifact.)
    const kwForParent = (await store.list({ type: 'knowledge-written' }))
      .filter((e) => e.goalId === 'g-map-split');
    expect(kwForParent).toHaveLength(1);
    const kw = kwForParent[0] as Extract<FactoryEvent, { type: 'knowledge-written' }>;
    expect(kw.artifact.category).toBe('conventions');
    expect(kw.artifact.generatedAtSha).toBe(PARENT_SHA);
    expect(kw.artifact.pointers).toHaveLength(2);

    // The merged artifact was gated: a deterministic-checked event for the parent
    // with a passing verdict exists.
    const detEvents = (await store.list({ type: 'deterministic-checked' }))
      .filter((e) => e.goalId === 'g-map-split');
    expect(detEvents.length).toBeGreaterThan(0);
    expect(
      detEvents.some((e) => (e as Extract<FactoryEvent, { type: 'deterministic-checked' }>).verdict.pass),
    ).toBe(true);
  });

  it('falls back gracefully when NO child produces a valid artifact (no parent merge, no parent event)', async () => {
    const repoRoot = makeTmp();
    mkdirSync(join(repoRoot, 'src'), { recursive: true });
    writeFileSync(join(repoRoot, 'src', 'a.ts'), 'export {}');

    // Both children emit invalid (non-JSON) artifacts: each child blocks at its
    // own leaf gate AND the merge sees no parseable child → returns null. The
    // parent must not crash and must land NO knowledge-written event of its own.
    const brain = new ScriptedBrain()
      .queueDecide({
        kind: 'split',
        children: [childPlan('map-a', 'map-repo', ['src/']), childPlan('map-b', 'map-repo', ['src/'])],
      })
      .queueDecide({ kind: 'satisfy' }, { kind: 'satisfy' })
      .queueProduce(
        { kind: 'text', text: 'not-json-at-all' },
        { kind: 'text', text: 'also-not-json' },
      );

    const store = new MemoryEventStore();
    const registry = buildRegistry([mapRepoType()]);
    const engine = new Engine({
      registry,
      brain,
      store,
      memory: new NoopMemoryView(),
      knowledge: stubKnowledge(store),
    });

    const goal = makeGoal({
      type: 'map-repo',
      id: 'g-map-empty',
      spec: { repoRoot, category: 'conventions' },
      scope: ['src/'],
      budget: { attempts: 4, tokens: 100_000, toolCalls: 50, wallClockMs: 120_000 },
    });

    const report = await engine.run(goal);

    // The children blocked at their leaf gates; the parent surfaces those blockers
    // (it did not crash on the empty merge).
    expect(report.blockers.length).toBeGreaterThan(0);
    // The merge produced no parent artifact (graceful empty fallback).
    expect(report.artifact).toBeNull();

    // No knowledge-written event landed at all (no valid child, no parent merge).
    const kwEvents = await store.list({ type: 'knowledge-written' });
    expect(kwEvents).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// repoShapeHint — a LARGE scoped region gets a split-or-die size signal
// ---------------------------------------------------------------------------

describe('repoShapeHint — scoped region size signal (live-self-4b84f2d2)', () => {
  // Reach the private hint + size counter via the established as-unknown seam.
  type HintSeam = {
    _activeAssembly: { worktree: { root: string } } | undefined;
    repoShapeHint(goal: Goal): string | undefined;
  };

  function engineWithRoot(root: string): HintSeam {
    const engine = new Engine({
      registry: buildRegistry([diveType()]),
      brain: new ScriptedBrain(),
      store: new MemoryEventStore(),
      memory: new NoopMemoryView(),
    });
    const seam = engine as unknown as HintSeam;
    seam._activeAssembly = { worktree: { root } };
    return seam;
  }

  it('emits a SPLIT hint for a deep-dive of a large scoped region (docs/ regression)', () => {
    const root = makeTmp();
    mkdirSync(join(root, 'docs', 'adrs'), { recursive: true });
    mkdirSync(join(root, 'docs', 'iterations'), { recursive: true });
    // Many files — like docs/ after the OKF reorg, which blew the dive wall-clock.
    for (let i = 0; i < 60; i++) {
      writeFileSync(join(root, 'docs', 'adrs', `ADR-${i}.md`), 'x\n');
    }
    for (let i = 0; i < 20; i++) {
      writeFileSync(join(root, 'docs', 'iterations', `iter-${i}.md`), 'x\n');
    }

    const seam = engineWithRoot(root);
    const goal = makeGoal({ type: 'deep-dive-region', scope: ['docs/'] });
    const hint = seam.repoShapeHint(goal);

    expect(hint).toBeDefined();
    expect(hint).toMatch(/region size/i);
    expect(hint).toMatch(/SPLIT it/i);
  });

  it('emits a SPLIT hint for FEW-but-HUGE files (under the file bar but over the byte bar)', () => {
    // Run live-self-14794116: tests/engine is 33 files (< the 40-file bar) but
    // ~642KB / ~17K lines — too large to deep-dive in one node, yet the file-count
    // check missed it, so the dive satisfied, ballooned, evicted, and step-loop:failed.
    // The byte bound (~450KB) must catch a few-but-huge region the file count misses.
    const root = makeTmp();
    mkdirSync(join(root, 'tests', 'engine'), { recursive: true });
    const big = 'x'.repeat(60_000) + '\n'; // ~60KB per file
    for (let i = 0; i < 12; i++) {
      writeFileSync(join(root, 'tests', 'engine', `big-${i}.test.ts`), big); // 12 files, ~720KB
    }

    const seam = engineWithRoot(root);
    const goal = makeGoal({ type: 'deep-dive-region', scope: ['tests/engine/'] });
    const hint = seam.repoShapeHint(goal);

    expect(hint).toBeDefined();
    expect(hint).toMatch(/region size/i);
    expect(hint).toMatch(/KB/); // the byte measure is surfaced in the hint
    expect(hint).toMatch(/SPLIT it/i);
  });

  it('stays silent for a moderate region under BOTH bars (few files, modest bytes)', () => {
    // The complement of the byte test: a region below the file bar AND the byte bar
    // (src/engine is 11 files / ~332KB and deep-dives in one node fine) stays silent.
    const root = makeTmp();
    mkdirSync(join(root, 'src', 'engine'), { recursive: true });
    const modest = 'x'.repeat(20_000) + '\n'; // ~20KB per file
    for (let i = 0; i < 10; i++) {
      writeFileSync(join(root, 'src', 'engine', `mod-${i}.ts`), modest); // 10 files, ~200KB
    }

    const seam = engineWithRoot(root);
    const goal = makeGoal({ type: 'deep-dive-region', scope: ['src/engine/'] });
    expect(seam.repoShapeHint(goal)).toBeUndefined();
  });

  it('stays silent for a SMALL scoped region (no needless split pressure)', () => {
    const root = makeTmp();
    mkdirSync(join(root, 'src', 'util'), { recursive: true });
    writeFileSync(join(root, 'src', 'util', 'a.ts'), 'x\n');
    writeFileSync(join(root, 'src', 'util', 'b.ts'), 'x\n');

    const seam = engineWithRoot(root);
    const goal = makeGoal({ type: 'deep-dive-region', scope: ['src/util/'] });
    expect(seam.repoShapeHint(goal)).toBeUndefined();
  });

  it('does not fire for a non-comprehension type even when scoped large', () => {
    const root = makeTmp();
    mkdirSync(join(root, 'docs'), { recursive: true });
    for (let i = 0; i < 60; i++) writeFileSync(join(root, 'docs', `f-${i}.md`), 'x\n');

    const seam = engineWithRoot(root);
    const goal = makeGoal({ type: 'implement', scope: ['docs/'] });
    expect(seam.repoShapeHint(goal)).toBeUndefined();
  });
});

// deep-dive-region split → RegionFacts merge
// ---------------------------------------------------------------------------

describe('ADR-029 — deep-dive-region split merges children into ONE RegionFacts', () => {
  it('merges two child RegionFacts, passes diveAnchorCheck, lands one knowledge-facts-written event', async () => {
    const repoRoot = makeTmp();
    mkdirSync(join(repoRoot, 'src'), { recursive: true });
    writeFileSync(join(repoRoot, 'src', 'auth.ts'), 'l1\nl2\nl3\nl4\nl5\n');
    writeFileSync(join(repoRoot, 'src', 'session.ts'), 'l1\nl2\nl3\n');

    const childA: RegionFacts = {
      repoRoot,
      region: 'src/auth',
      generatedAtSha: PARENT_SHA,
      facts: [
        { claim: 'auth validates at line 3', anchors: [{ path: 'src/auth.ts', line: 3 }], sha: PARENT_SHA, confidence: 'high' },
      ],
    };
    const childB: RegionFacts = {
      repoRoot,
      region: 'src/session',
      generatedAtSha: PARENT_SHA,
      facts: [
        { claim: 'session expires at line 2', anchors: [{ path: 'src/session.ts', line: 2 }], sha: PARENT_SHA, confidence: 'medium' },
      ],
    };

    const brain = new ScriptedBrain()
      .queueDecide({
        kind: 'split',
        children: [childPlan('dive-auth', 'deep-dive-region', ['src/auth']), childPlan('dive-session', 'deep-dive-region', ['src/session'])],
      })
      .queueDecide({ kind: 'satisfy' }, { kind: 'satisfy' })
      .queueProduce(
        { kind: 'text', text: JSON.stringify(childA) },
        { kind: 'text', text: JSON.stringify(childB) },
      );

    const store = new MemoryEventStore();
    const registry = buildRegistry([diveType()]);
    const engine = new Engine({
      registry,
      brain,
      store,
      memory: new NoopMemoryView(),
      knowledge: stubKnowledge(store),
      sensitivity: [],
    });

    const goal = makeGoal({
      type: 'deep-dive-region',
      id: 'g-dive-split',
      title: 'dive the auth subsystem',
      spec: { repoRoot, region: 'src' },
      scope: ['src/'],
      budget: { attempts: 4, tokens: 100_000, toolCalls: 50, wallClockMs: 120_000 },
    });

    const report = await engine.run(goal);

    expect(report.blockers).toHaveLength(0);
    expect(report.artifact).not.toBeNull();

    const merged = JSON.parse((report.artifact as { kind: 'text'; text: string }).text) as RegionFacts;
    expect(merged.generatedAtSha).toBe(PARENT_SHA);
    // Union of anchored facts — every child's facts preserved.
    expect(merged.facts).toHaveLength(2);
    const claims = merged.facts.map((f) => f.claim).sort();
    expect(claims).toEqual(['auth validates at line 3', 'session expires at line 2']);

    // Exactly ONE knowledge-facts-written event landed for the PARENT goal — the
    // merged RegionFacts. (Sub-region children persist their own facts under their
    // own goalIds; the merge adds the parent's single unified RegionFacts.)
    const kfwForParent = (await store.list({ type: 'knowledge-facts-written' }))
      .filter((e) => e.goalId === 'g-dive-split');
    expect(kfwForParent).toHaveLength(1);
    const kfw = kfwForParent[0] as Extract<FactoryEvent, { type: 'knowledge-facts-written' }>;
    expect(kfw.facts.facts).toHaveLength(2);
    expect(kfw.facts.generatedAtSha).toBe(PARENT_SHA);
  });
});

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function childPlan(localId: string, type: string, scope: string[]): ChildPlan {
  return {
    localId,
    type,
    title: `child ${localId}`,
    spec: {},
    dependsOn: [],
    scope,
    budgetShare: 0.5,
  };
}
