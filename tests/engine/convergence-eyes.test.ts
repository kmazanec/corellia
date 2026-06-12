/**
 * The scripted full-stack EYES convergence. Drives the WHOLE
 * composed knowledge path with a scripted brain against a real tmp git fixture
 * repo. Zero network.
 *
 * The flow proven by the main test:
 *   - A root split intent on a fixture repo with NO knowledge artifacts.
 *   - The coverage gate fires at the split, finds architecture + stack absent
 *     (and the src region undived), and mints comprehension children
 *     (map-repo x2 + deep-dive-region x1) injected as dependencies of the code
 *     leaf — so the maps complete BEFORE the code fan-out.
 *   - The scripted learn leaves emit valid artifact JSON using REAL paths/SHAs
 *     from the fixture, so the real scanImports-backed validation passes.
 *   - The persist hook lands knowledge-written / knowledge-facts-written events.
 *   - The split proceeds; the code leaf consults the impact() TOOL through the
 *     broker BEFORE its first write_file (asserted by tool-call ordering).
 *   - Tree completes: gate-checked, knowledge events, and cost totals present.
 *
 * Separate focused tests cover: SHA drift mid-run (knowledge-checked + refresh),
 * a phantom architecture pointer CAUGHT by the real scan-backed validation, and
 * a test-scaffold leaf run through the engine (green→emit, red→block-no-judge).
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

import { Engine } from '../../src/engine/engine.js';
import {
  assembleKnowledgeWiring,
  rebindKnowledgeScan,
  type SandboxConfig,
} from '../../src/engine/assembly.js';
import { MemoryEventStore, NoopMemoryView, buildRegistry, makeGoal } from './stubs.js';
import { starterTypes } from '../../src/library/starter-types.js';
import { runScriptCheck } from '../../src/library/checks.js';
import { costSummary } from '../../src/eventlog/projections.js';
import type { Brain, BrainContext, StepOutput, StepTranscript } from '../../src/contract/brain.js';
import type { Goal, Metered, Usage } from '../../src/contract/goal.js';
import { ZERO_USAGE } from '../../src/contract/goal.js';
import type { Decision } from '../../src/contract/decision.js';
import type { Artifact } from '../../src/contract/report.js';
import type { Verdict } from '../../src/contract/verdict.js';
import type { ToolDef } from '../../src/contract/tool.js';
import type { GoalTypeDef } from '../../src/contract/goal-type.js';
import type { KnowledgeArtifact, RegionFacts } from '../../src/contract/knowledge.js';

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

const USAGE: Usage = { promptTokens: 100, completionTokens: 40, costUsd: 0.0021 };

const RIGHT = 'CONVERGED';

/** git rev-parse HEAD for a repo (args-array, no shell). */
function headSha(dir: string): string {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, stdio: ['ignore', 'pipe', 'ignore'] })
    .toString()
    .trim();
}

/**
 * Build the fixture: a git repo with a declared test script, a check.mjs, and
 * two real source files with a real import edge (src/a.ts → src/b.ts) so
 * scanImports yields edges the architecture artifact can anchor against.
 */
function makeFixtureRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'corellia-conv-eyes-'));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  execFileSync('git', ['init'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: dir, stdio: 'pipe' });

  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'src', 'b.ts'), 'export const b = 1;\n');
  writeFileSync(join(dir, 'src', 'a.ts'), "import { b } from './b.js';\nexport const a = b + 1;\n");
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name: 'fixture', version: '0.0.0', scripts: { test: 'node check.mjs' }, dependencies: { left: '1.0.0' } }, null, 2) + '\n',
  );
  writeFileSync(
    join(dir, 'check.mjs'),
    [
      "import { readFileSync } from 'node:fs';",
      'let content = "";',
      'try { content = readFileSync("src/target.txt", "utf8"); } catch { content = ""; }',
      `if (content.trim() === ${JSON.stringify(RIGHT)}) { console.log("ok"); process.exit(0); }`,
      'console.error("target wrong: " + JSON.stringify(content)); process.exit(1);',
    ].join('\n') + '\n',
  );
  execFileSync('git', ['add', '.'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['commit', '-m', 'fixture'], { cwd: dir, stdio: 'pipe' });
  return dir;
}

/**
 * The root splitter type: a non-leaf make goal that decomposes into a code leaf.
 * Its split triggers the coverage gate (root split → architecture + stack).
 */
function rootSplitterType(): GoalTypeDef {
  return {
    name: 'deliver-intent',
    kind: 'make',
    family: 'deliver',
    leafOnly: false,
    tier: { default: 'high', ladder: ['high'] },
    deterministic: [],
    judgeType: null,
    grants: ['retrieval.api', 'spawn'],
  };
}

/** The code leaf: tool-granted (impact + write), gated on the declared test. */
function codeLeafType(): GoalTypeDef {
  return {
    name: 'implement',
    kind: 'make',
    family: 'build',
    leafOnly: true,
    tier: { default: 'mid', ladder: ['mid', 'high'] },
    deterministic: [runScriptCheck('test')],
    judgeType: null,
    grants: ['fs.read', 'fs.write', 'test.run_impacted', 'knowledge.impact', 'retrieval.api'],
  };
}

/**
 * A scripted brain dispatching by goal type. Each goal id gets its own step
 * cursor so concurrent leaves don't share state. Learn leaves emit the artifact
 * JSON the test supplies; the code leaf runs a fixed tool plan.
 */
function dispatchBrain(plans: {
  rootDecision: () => Decision;
  stepFor: (goal: Goal, transcript: StepTranscript) => StepOutput;
}): Brain {
  return {
    async decide(goal: Goal): Promise<Metered<Decision>> {
      if (goal.type === 'deliver-intent') return { value: plans.rootDecision(), usage: USAGE };
      return { value: { kind: 'satisfy' }, usage: ZERO_USAGE };
    },
    async produce(): Promise<Metered<Artifact>> {
      throw new Error('produce not used (all leaves tool-granted)');
    },
    async judge(): Promise<Metered<Verdict>> {
      return { value: { pass: true, findings: [] }, usage: USAGE };
    },
    async repair(): Promise<Metered<Artifact>> {
      throw new Error('repair not used');
    },
    async step(goal: Goal, transcript: StepTranscript): Promise<StepOutput> {
      return plans.stepFor(goal, transcript);
    },
  };
}

// Per-goal step cursors so a learn leaf and the code leaf each advance their own
// scripted plan independently.
function makeCursors() {
  const counts = new Map<string, number>();
  return {
    next(id: string): number {
      const n = counts.get(id) ?? 0;
      counts.set(id, n + 1);
      return n;
    },
  };
}

// ───────────────────────────────────────────────────────────────────────────
// 1. Full convergence: JIT maps → knowledge written → split → impact-before-write
// ───────────────────────────────────────────────────────────────────────────

describe('convergence-eyes — full-stack scripted path', () => {
  it('maps as deps before fan-out, lands knowledge, and the code leaf calls impact before write', async () => {
    const repo = makeFixtureRepo();
    const sha = headSha(repo);
    const store = new MemoryEventStore();
    const cursors = makeCursors();

    const sandbox: SandboxConfig = { repoRoot: repo, declaredScripts: { test: 'check.mjs' }, knowledge: true };
    const registry = buildRegistry([
      rootSplitterType(),
      ...rebindKnowledgeScan(starterTypes()),
      codeLeafType(),
    ]);

    // The scripted learn-leaf artifacts use REAL fixture paths + the REAL SHA so
    // the scanImports-backed architecture check and the dive anchor check pass.
    const archArtifact: KnowledgeArtifact = {
      repoRoot: repo,
      category: 'architecture',
      generatedAtSha: sha,
      confidence: 'high',
      status: 'provisional',
      pointers: [{ path: 'src/a.ts', note: 'entry — imports b' }],
      summary: 'two-module fixture',
    };
    const conventionsArtifact: KnowledgeArtifact = {
      repoRoot: repo,
      category: 'conventions',
      generatedAtSha: sha,
      confidence: 'high',
      status: 'provisional',
      pointers: [{ path: 'src/a.ts', note: 'imports use .js extension' }],
      summary: 'esm with .js specifiers',
    };
    const diveFacts: RegionFacts = {
      repoRoot: repo,
      region: 'src',
      generatedAtSha: sha,
      facts: [{ claim: 'a imports b', anchors: [{ path: 'src/a.ts', line: 1 }], sha, confidence: 'high' }],
    };

    const brain = dispatchBrain({
      rootDecision: () => ({
        kind: 'split',
        children: [
          {
            localId: 'code',
            type: 'implement',
            title: 'write the target',
            spec: {},
            scope: ['src/'],
            budgetShare: 0.4,
            dependsOn: [],
          },
        ],
      }),
      stepFor: (goal, _transcript) => {
        const i = cursors.next(goal.id);
        if (goal.type === 'map-repo') {
          const cat = (goal.spec as { category?: string }).category;
          const ka = cat === 'conventions' ? conventionsArtifact : archArtifact;
          return { kind: 'artifact', artifact: { kind: 'text', text: JSON.stringify(ka) }, usage: USAGE };
        }
        if (goal.type === 'deep-dive-region') {
          return { kind: 'artifact', artifact: { kind: 'text', text: JSON.stringify(diveFacts) }, usage: USAGE };
        }
        // implement code leaf: step 0 = impact (BEFORE any write), step 1 =
        // write the fix + run the test (green), step 2 = emit.
        if (i === 0) {
          return { kind: 'tool-calls', calls: [{ id: 'imp', name: 'impact', args: { files: ['src/b.ts'] } }], usage: USAGE };
        }
        if (i === 1) {
          return {
            kind: 'tool-calls',
            calls: [
              { id: 'w', name: 'write_file', args: { path: 'src/target.txt', content: RIGHT } },
              { id: 't', name: 'run_script', args: { script: 'test' } },
            ],
            usage: USAGE,
          };
        }
        return { kind: 'artifact', artifact: { kind: 'files', files: [{ path: 'src/target.txt', content: RIGHT }] }, usage: USAGE };
      },
    });

    const engine = new Engine({
      registry,
      brain,
      store,
      memory: new NoopMemoryView(),
      sandbox,
      knowledge: assembleKnowledgeWiring(sandbox, store, registry),
    });

    const goal = makeGoal({
      id: 'conv',
      type: 'deliver-intent',
      title: 'deliver the intent',
      scope: ['src/'],
      budget: { attempts: 6, tokens: 500_000, toolCalls: 60, wallClockMs: 120_000 },
    });

    const report = await engine.run(goal);
    const events = await store.list();

    // ── converged ──────────────────────────────────────────────────────────
    expect(report.blockers).toHaveLength(0);

    // ── coverage gate fired with misses, then mints comprehension children ──
    const gateChecked = events.filter((e) => e.type === 'gate-checked');
    expect(gateChecked.length).toBeGreaterThanOrEqual(1);
    const rootGate = gateChecked.find((e) => e.goalId === 'conv');
    expect(rootGate?.type === 'gate-checked' && rootGate.ok).toBe(false);
    // The code-leaf child carries scope, so the gate evaluates code-leaf coverage
    // (architecture + conventions) plus a region dive for the touched src region.
    expect(rootGate?.type === 'gate-checked' && rootGate.missing).toEqual(
      expect.arrayContaining(['architecture', 'conventions', 'architecture:src']),
    );

    // ── comprehension children spawned as DEPENDENCIES of the code leaf ──────
    const spawned = events.filter((e) => e.type === 'child-spawned');
    const mapChildren = spawned.filter((e) => e.type === 'child-spawned' && e.childType === 'map-repo');
    const diveChildren = spawned.filter((e) => e.type === 'child-spawned' && e.childType === 'deep-dive-region');
    expect(mapChildren).toHaveLength(2);
    expect(diveChildren).toHaveLength(1);
    const codeSpawn = spawned.find((e) => e.type === 'child-spawned' && e.childType === 'implement');
    // The code leaf depends on all three comprehension children (maps before fan-out).
    expect(codeSpawn?.type === 'child-spawned' && codeSpawn.dependsOn.length).toBe(3);

    // ── knowledge events landed (persist hook over helpers) ─────────────
    const kWritten = events.filter((e) => e.type === 'knowledge-written');
    const kFacts = events.filter((e) => e.type === 'knowledge-facts-written');
    expect(kWritten).toHaveLength(2);
    expect(kFacts).toHaveLength(1);

    // ── SEQUENCING: every knowledge-written precedes the code leaf's first write ─
    const firstWriteIdx = events.findIndex(
      (e) => e.type === 'tool-call' && e.tool === 'write_file',
    );
    const lastKnowledgeIdx = Math.max(
      ...events.map((e, i) => (e.type === 'knowledge-written' || e.type === 'knowledge-facts-written' ? i : -1)),
    );
    expect(lastKnowledgeIdx).toBeGreaterThanOrEqual(0);
    expect(lastKnowledgeIdx).toBeLessThan(firstWriteIdx);

    // ── the code leaf consulted impact() BEFORE its first write_file ─────────
    const codeToolCalls = events.filter((e) => e.type === 'tool-call' && e.goalId === 'conv/code');
    const impactIdx = codeToolCalls.findIndex((e) => e.type === 'tool-call' && e.tool === 'impact');
    const writeIdx = codeToolCalls.findIndex((e) => e.type === 'tool-call' && e.tool === 'write_file');
    expect(impactIdx).toBeGreaterThanOrEqual(0);
    expect(writeIdx).toBeGreaterThan(impactIdx);

    // ── cost totals present and non-zero ─────────────────────────────────────
    const cost = costSummary(events);
    expect(cost.tree.costUsd).toBeGreaterThan(0);
    expect(cost.tree.promptTokens).toBeGreaterThan(0);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 2. SHA drift mid-run → knowledge-checked + refresh path
// ───────────────────────────────────────────────────────────────────────────

describe('convergence-eyes — SHA drift triggers verify-on-read', () => {
  it('a stale architecture artifact that fails self-validation spawns a refresh child', async () => {
    const repo = makeFixtureRepo();
    const store = new MemoryEventStore();
    const cursors = makeCursors();
    const sandbox: SandboxConfig = { repoRoot: repo, declaredScripts: { test: 'check.mjs' }, knowledge: true };
    const registry = buildRegistry([
      rootSplitterType(),
      ...rebindKnowledgeScan(starterTypes()),
      codeLeafType(),
    ]);

    // Pre-seed a STALE architecture artifact (old SHA) whose single pointer no
    // longer exists on disk — so verify-on-read self-validation FAILS → invalid
    // → refresh child. Also pre-seed a fresh stack so only architecture refreshes.
    const staleArch: KnowledgeArtifact = {
      repoRoot: repo,
      category: 'architecture',
      generatedAtSha: 'staaale0',
      confidence: 'high',
      status: 'provisional',
      pointers: [{ path: 'src/gone.ts', note: 'deleted module' }],
      summary: 'stale',
    };
    await store.append({ type: 'knowledge-written', at: Date.now(), goalId: 'seed', artifact: staleArch });

    const sha = headSha(repo);
    const freshArch: KnowledgeArtifact = {
      repoRoot: repo,
      category: 'architecture',
      generatedAtSha: sha,
      confidence: 'high',
      status: 'provisional',
      pointers: [{ path: 'src/a.ts', note: 'entry' }],
      summary: 'fresh',
    };
    const freshConventions: KnowledgeArtifact = {
      repoRoot: repo,
      category: 'conventions',
      generatedAtSha: sha,
      confidence: 'high',
      status: 'provisional',
      pointers: [{ path: 'src/a.ts', note: 'esm conventions' }],
      summary: 'conventions',
    };
    const diveFacts: RegionFacts = {
      repoRoot: repo,
      region: 'src',
      generatedAtSha: sha,
      facts: [{ claim: 'a', anchors: [{ path: 'src/a.ts', line: 1 }], sha, confidence: 'high' }],
    };

    const brain = dispatchBrain({
      rootDecision: () => ({
        kind: 'split',
        children: [
          { localId: 'code', type: 'implement', title: 'code', spec: {}, scope: ['src/'], budgetShare: 0.3, dependsOn: [] },
        ],
      }),
      stepFor: (goal) => {
        const i = cursors.next(goal.id);
        if (goal.type === 'map-repo') {
          const cat = (goal.spec as { category?: string }).category;
          return {
            kind: 'artifact',
            artifact: { kind: 'text', text: JSON.stringify(cat === 'conventions' ? freshConventions : freshArch) },
            usage: USAGE,
          };
        }
        if (goal.type === 'deep-dive-region') {
          return { kind: 'artifact', artifact: { kind: 'text', text: JSON.stringify(diveFacts) }, usage: USAGE };
        }
        if (i === 0) {
          return {
            kind: 'tool-calls',
            calls: [
              { id: 'w', name: 'write_file', args: { path: 'src/target.txt', content: RIGHT } },
              { id: 't', name: 'run_script', args: { script: 'test' } },
            ],
            usage: USAGE,
          };
        }
        return { kind: 'artifact', artifact: { kind: 'files', files: [{ path: 'src/target.txt', content: RIGHT }] }, usage: USAGE };
      },
    });

    const engine = new Engine({
      registry,
      brain,
      store,
      memory: new NoopMemoryView(),
      sandbox,
      knowledge: assembleKnowledgeWiring(sandbox, store, registry),
    });

    const goal = makeGoal({
      id: 'drift',
      type: 'deliver-intent',
      title: 'deliver',
      scope: ['src/'],
      budget: { attempts: 6, tokens: 500_000, toolCalls: 60, wallClockMs: 120_000 },
    });

    const report = await engine.run(goal);
    const events = await store.list();

    expect(report.blockers).toHaveLength(0);

    // verify-on-read fired: the stale architecture artifact was checked + invalid.
    const checked = events.filter((e) => e.type === 'knowledge-checked');
    expect(checked.length).toBeGreaterThanOrEqual(1);
    const invalid = checked.find((e) => e.type === 'knowledge-checked' && e.category === 'architecture');
    expect(invalid?.type === 'knowledge-checked' && invalid.outcome).toBe('invalid');

    // a refresh map-repo child for architecture was spawned and re-wrote it fresh.
    const mapChildren = events.filter((e) => e.type === 'child-spawned' && e.childType === 'map-repo');
    expect(mapChildren.length).toBeGreaterThanOrEqual(1);
    const written = events.filter((e) => e.type === 'knowledge-written');
    expect(written.some((e) => e.type === 'knowledge-written' && e.artifact.generatedAtSha === sha)).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 3. Phantom pointer in an architecture artifact CAUGHT by real scan validation
// ───────────────────────────────────────────────────────────────────────────

describe('convergence-eyes — phantom pointer caught by the real scan', () => {
  it('a map-repo leaf claiming a nonexistent module blocks at the deterministic gate', async () => {
    const repo = makeFixtureRepo();
    const sha = headSha(repo);
    const store = new MemoryEventStore();
    const cursors = makeCursors();
    const sandbox: SandboxConfig = { repoRoot: repo, declaredScripts: { test: 'check.mjs' }, knowledge: true };
    const registry = buildRegistry([...rebindKnowledgeScan(starterTypes())]);

    // A map-repo leaf whose architecture pointer names a file that does not exist
    // in the fixture: the real scanImports-backed architectureCheck must catch it.
    const phantom: KnowledgeArtifact = {
      repoRoot: repo,
      category: 'architecture',
      generatedAtSha: sha,
      confidence: 'high',
      status: 'provisional',
      pointers: [{ path: 'src/phantom.ts', note: 'does not exist' }],
      summary: 'phantom',
    };

    const brain = dispatchBrain({
      rootDecision: () => ({ kind: 'satisfy' }),
      stepFor: (goal) => {
        cursors.next(goal.id);
        return { kind: 'artifact', artifact: { kind: 'text', text: JSON.stringify(phantom) }, usage: USAGE };
      },
    });

    const engine = new Engine({
      registry,
      brain,
      store,
      memory: new NoopMemoryView(),
      sandbox,
      knowledge: assembleKnowledgeWiring(sandbox, store, registry),
    });

    const goal = makeGoal({
      id: 'phantom',
      type: 'map-repo',
      title: 'map architecture',
      scope: [],
      budget: { attempts: 1, tokens: 100_000, toolCalls: 30, wallClockMs: 60_000 },
    });

    const report = await engine.run(goal);
    const events = await store.list();

    // The phantom pointer was caught: leaf blocks, no knowledge written.
    expect(report.blockers.length).toBeGreaterThan(0);
    const det = events.filter((e) => e.type === 'deterministic-checked');
    expect(det.some((e) => e.type === 'deterministic-checked' && !e.verdict.pass)).toBe(true);
    expect(events.filter((e) => e.type === 'knowledge-written')).toHaveLength(0);
    // No judge: learn leaves have no judgeType.
    expect(events.filter((e) => e.type === 'judge-verdict')).toHaveLength(0);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 4. test-scaffold through the engine: green→emit, red→block-no-judge
// ───────────────────────────────────────────────────────────────────────────

describe('convergence-eyes — test-scaffold through the engine CheckContext', () => {
  it('green declared script → the test-scaffold leaf emits', async () => {
    const repo = makeFixtureRepo();
    const sha = headSha(repo);
    // Make the declared test GREEN by committing the target into HEAD.
    writeFileSync(join(repo, 'src', 'target.txt'), RIGHT + '\n');
    execFileSync('git', ['add', '.'], { cwd: repo, stdio: 'pipe' });
    execFileSync('git', ['commit', '-m', 'green'], { cwd: repo, stdio: 'pipe' });
    const greenSha = headSha(repo);

    const store = new MemoryEventStore();
    const cursors = makeCursors();
    const sandbox: SandboxConfig = { repoRoot: repo, declaredScripts: { test: 'check.mjs' }, knowledge: true };
    const registry = buildRegistry([...rebindKnowledgeScan(starterTypes())]);

    const scaffold: KnowledgeArtifact = {
      repoRoot: repo,
      category: 'test-scaffold',
      generatedAtSha: greenSha,
      confidence: 'high',
      status: 'provisional',
      pointers: [{ path: 'check.mjs', note: 'script:test' }],
      summary: 'runs node check.mjs',
    };

    const brain = dispatchBrain({
      rootDecision: () => ({ kind: 'satisfy' }),
      stepFor: (goal) => {
        cursors.next(goal.id);
        return { kind: 'artifact', artifact: { kind: 'text', text: JSON.stringify(scaffold) }, usage: USAGE };
      },
    });

    const engine = new Engine({
      registry,
      brain,
      store,
      memory: new NoopMemoryView(),
      sandbox,
      knowledge: assembleKnowledgeWiring(sandbox, store, registry),
    });

    const goal = makeGoal({
      id: 'scaffold-green',
      type: 'map-repo',
      title: 'map test-scaffold',
      scope: [],
      budget: { attempts: 1, tokens: 100_000, toolCalls: 30, wallClockMs: 60_000 },
    });

    void sha;
    const report = await engine.run(goal);
    const events = await store.list();

    expect(report.blockers).toHaveLength(0);
    // The declared script ran green via the engine-supplied CheckContext.
    const scriptRan = events.filter((e) => e.type === 'script-ran');
    expect(scriptRan.some((e) => e.type === 'script-ran' && e.exitStatus === 0)).toBe(true);
    // Knowledge written for the scaffold category.
    expect(events.filter((e) => e.type === 'knowledge-written')).toHaveLength(1);
  });

  it('red declared script → the test-scaffold leaf blocks at the gate, no judge', async () => {
    const repo = makeFixtureRepo(); // target.txt absent → check.mjs exits 1
    const sha = headSha(repo);
    const store = new MemoryEventStore();
    const cursors = makeCursors();
    const sandbox: SandboxConfig = { repoRoot: repo, declaredScripts: { test: 'check.mjs' }, knowledge: true };
    const registry = buildRegistry([...rebindKnowledgeScan(starterTypes())]);

    const scaffold: KnowledgeArtifact = {
      repoRoot: repo,
      category: 'test-scaffold',
      generatedAtSha: sha,
      confidence: 'high',
      status: 'provisional',
      pointers: [{ path: 'check.mjs', note: 'script:test' }],
      summary: 'runs node check.mjs',
    };

    const brain = dispatchBrain({
      rootDecision: () => ({ kind: 'satisfy' }),
      stepFor: (goal) => {
        cursors.next(goal.id);
        return { kind: 'artifact', artifact: { kind: 'text', text: JSON.stringify(scaffold) }, usage: USAGE };
      },
    });

    const engine = new Engine({
      registry,
      brain,
      store,
      memory: new NoopMemoryView(),
      sandbox,
      knowledge: assembleKnowledgeWiring(sandbox, store, registry),
    });

    const goal = makeGoal({
      id: 'scaffold-red',
      type: 'map-repo',
      title: 'map test-scaffold',
      scope: [],
      budget: { attempts: 1, tokens: 100_000, toolCalls: 30, wallClockMs: 60_000 },
    });

    const report = await engine.run(goal);
    const events = await store.list();

    expect(report.blockers.length).toBeGreaterThan(0);
    const det = events.filter((e) => e.type === 'deterministic-checked');
    expect(det.some((e) => e.type === 'deterministic-checked' && !e.verdict.pass)).toBe(true);
    // No judge consulted; no knowledge written for a failed scaffold.
    expect(events.filter((e) => e.type === 'judge-verdict')).toHaveLength(0);
    expect(events.filter((e) => e.type === 'knowledge-written')).toHaveLength(0);
  });
});
