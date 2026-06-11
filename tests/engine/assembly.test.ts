/**
 * Chunk 1 — engine tree-root assembly wiring.
 *
 * Two halves:
 *  - config ABSENT → byte-identical behavior: no worktree events at all.
 *  - config PRESENT → the tree root opens ONE worktree, constructs ONE broker
 *    bound to it, threads a CheckContext into executing checks, enforces the
 *    diff ⊆ scope check at the root emission, collects on success / preserves on
 *    failure, and runs scripts with a scrubbed child env.
 *
 * Real tmp git repos (mkdtemp + git init); zero network.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

import { Engine } from '../../src/engine/engine.js';
import {
  openSandboxAssembly,
  assembleKnowledgeWiring,
  rebindKnowledgeScan,
} from '../../src/engine/assembly.js';
import { starterTypes } from '../../src/library/starter-types.js';
import type { KnowledgeArtifact } from '../../src/contract/knowledge.js';
import { MemoryEventStore, NoopMemoryView, buildRegistry, makeGoal } from './stubs.js';
import type { Brain, BrainContext, StepOutput, StepTranscript } from '../../src/contract/brain.js';
import type { Goal, Metered } from '../../src/contract/goal.js';
import { ZERO_USAGE } from '../../src/contract/goal.js';
import type { Decision } from '../../src/contract/decision.js';
import type { Artifact } from '../../src/contract/report.js';
import type { Verdict } from '../../src/contract/verdict.js';
import type { ToolDef } from '../../src/contract/tool.js';
import type { GoalTypeDef, CheckContext, DeterministicCheck } from '../../src/contract/goal-type.js';

// ── temp repo fixture ────────────────────────────────────────────────────────

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

function makeTempRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'corellia-asm-'));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  execFileSync('git', ['init'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: dir, stdio: 'pipe' });
  writeFileSync(join(dir, 'README.md'), '# test\n');
  execFileSync('git', ['add', 'README.md'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['commit', '-m', 'init'], { cwd: dir, stdio: 'pipe' });
  return dir;
}

// ── a brain that drives the step loop with a fixed plan, classic methods stub ──

/** Step plan entries: a batch of tool calls, then a final artifact. */
function planBrain(steps: StepOutput[]): Brain {
  let i = 0;
  return {
    async decide(): Promise<Metered<Decision>> {
      return { value: { kind: 'satisfy' }, usage: ZERO_USAGE };
    },
    async produce(): Promise<Metered<Artifact>> {
      throw new Error('produce not used (tool-granted leaf)');
    },
    async judge(): Promise<Metered<Verdict>> {
      return { value: { pass: true, findings: [] }, usage: ZERO_USAGE };
    },
    async repair(): Promise<Metered<Artifact>> {
      throw new Error('repair not used');
    },
    async step(
      _goal: Goal,
      _transcript: StepTranscript,
      _tools: ToolDef[],
      _ctx: BrainContext,
    ): Promise<StepOutput> {
      const out = steps[Math.min(i, steps.length - 1)];
      i++;
      if (out === undefined) throw new Error('planBrain: step plan exhausted');
      return out;
    },
  };
}

/** A tool-granted, no-judge implement-like type with the given deterministic checks. */
function implType(checks: DeterministicCheck[]): GoalTypeDef {
  return {
    name: 'implement',
    kind: 'make',
    family: 'build',
    leafOnly: true,
    tier: { default: 'sonnet', ladder: ['sonnet', 'opus'] },
    deterministic: checks,
    judgeType: null,
    grants: ['fs.read', 'fs.write', 'test.run_impacted'],
  };
}

// ───────────────────────────────────────────────────────────────────────────
// config ABSENT
// ───────────────────────────────────────────────────────────────────────────

describe('assembly — sandbox config absent', () => {
  it('emits no worktree events (byte-identical to a plain run)', async () => {
    const store = new MemoryEventStore();
    // No broker and no sandbox → the classic produce path runs unchanged.
    const brain: Brain = {
      ...planBrain([]),
      async produce(): Promise<Metered<Artifact>> {
        return { value: { kind: 'text', text: 'done' }, usage: ZERO_USAGE };
      },
    };
    const registry = buildRegistry([implType([])]);
    const engine = new Engine({ registry, brain, store, memory: new NoopMemoryView() });

    const goal = makeGoal({ type: 'implement', scope: ['src/'] });
    const report = await engine.run(goal);

    expect(report.blockers).toHaveLength(0);
    const types = store.types();
    expect(types).not.toContain('worktree-created');
    expect(types).not.toContain('worktree-collected');
    expect(types).not.toContain('worktree-preserved');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// config PRESENT
// ───────────────────────────────────────────────────────────────────────────

describe('assembly — sandbox config present', () => {
  it('opens one worktree, threads ctx to checks, collects on success', async () => {
    const repo = makeTempRepo();
    const store = new MemoryEventStore();

    // A deterministic check that records the ctx it receives.
    let seenCtx: CheckContext | undefined;
    const ctxRecorder: DeterministicCheck = {
      name: 'ctx-recorder',
      async run(_g, _a, ctx) {
        seenCtx = ctx;
        return { ok: true, detail: '' };
      },
    };

    // The leaf writes one in-scope file, then emits.
    const brain = planBrain([
      {
        kind: 'tool-calls',
        calls: [{ id: 'c1', name: 'write_file', args: { path: 'src/out.txt', content: 'hi' } }],
        usage: ZERO_USAGE,
      },
      { kind: 'artifact', artifact: { kind: 'files', files: [{ path: 'src/out.txt', content: 'hi' }] }, usage: ZERO_USAGE },
    ]);

    const registry = buildRegistry([implType([ctxRecorder])]);
    const engine = new Engine({
      registry,
      brain,
      store,
      memory: new NoopMemoryView(),
      sandbox: { repoRoot: repo, declaredScripts: {} },
    });

    const goal = makeGoal({ id: 'root-asm', type: 'implement', scope: ['src/'] });
    const report = await engine.run(goal);

    expect(report.blockers).toHaveLength(0);

    // One worktree-created and exactly one collected; no preserved.
    const created = await store.list({ type: 'worktree-created' });
    const collected = await store.list({ type: 'worktree-collected' });
    const preserved = await store.list({ type: 'worktree-preserved' });
    expect(created).toHaveLength(1);
    expect(collected).toHaveLength(1);
    expect(preserved).toHaveLength(0);

    // The collected tree carries a commit (the leaf's write).
    const collectedEvent = collected[0];
    expect(collectedEvent?.type).toBe('worktree-collected');
    if (collectedEvent?.type === 'worktree-collected') {
      expect(collectedEvent.commits.length).toBeGreaterThan(0);
    }

    // The CheckContext reached the check, carrying the worktree sandbox root.
    expect(seenCtx).toBeDefined();
    expect(seenCtx?.sandboxRoot).toBe(created[0]?.type === 'worktree-created' ? created[0].path : undefined);
    expect(typeof seenCtx?.runScript).toBe('function');
  });

  it('preserves the worktree (not collects) when the tree blocks', async () => {
    const repo = makeTempRepo();
    const store = new MemoryEventStore();

    // A deterministic check that always fails → the leaf cannot pass → block.
    const alwaysFail: DeterministicCheck = {
      name: 'always-fail',
      async run() {
        return { ok: false, detail: 'nope' };
      },
    };

    const brain = planBrain([
      { kind: 'artifact', artifact: { kind: 'files', files: [{ path: 'src/out.txt', content: 'hi' }] }, usage: ZERO_USAGE },
    ]);
    const registry = buildRegistry([implType([alwaysFail])]);
    const engine = new Engine({
      registry,
      brain,
      store,
      memory: new NoopMemoryView(),
      // attempts:1 so failure blocks fast.
      sandbox: { repoRoot: repo, declaredScripts: {} },
    });

    const goal = makeGoal({ id: 'root-block', type: 'implement', scope: ['src/'], budget: { attempts: 1, tokens: 1000, toolCalls: 50, wallClockMs: 60_000 } });
    const report = await engine.run(goal);

    expect(report.blockers.length).toBeGreaterThan(0);
    const collected = await store.list({ type: 'worktree-collected' });
    const preserved = await store.list({ type: 'worktree-preserved' });
    expect(collected).toHaveLength(0);
    expect(preserved).toHaveLength(1);
  });

  it('blocks with scope-insufficiency when the worktree diff exceeds the root scope', async () => {
    const repo = makeTempRepo();
    const store = new MemoryEventStore();

    // The leaf's own scope (and the root's) is src/, but it writes via a path the
    // broker would refuse. To force a root-level diff escape we widen the LEAF
    // scope to allow the write while keeping the ROOT scope narrow: a child whose
    // scope is broader than the root's parent scope produces a tree diff outside
    // the root scope. We simulate by giving the leaf goal a wider scope than the
    // diff-check target (which is the root goal.scope passed to run()).
    //
    // Single-goal tree: the goal IS the root, so its scope is both leaf and root.
    // To exercise the root diff check independently we declare scope ['src/'] but
    // have the brain write to 'lib/out.txt' — the broker refuses it (per-leaf),
    // and nothing lands, so the diff is empty and ok. Instead, we let the leaf
    // write in-scope but ALSO drop an out-of-scope file directly on disk to model
    // an escape the per-leaf check missed, proving the tree-level guard catches it.
    const brain = planBrain([
      {
        kind: 'tool-calls',
        calls: [{ id: 'c1', name: 'write_file', args: { path: 'src/ok.txt', content: 'hi' } }],
        usage: ZERO_USAGE,
      },
      { kind: 'artifact', artifact: { kind: 'files', files: [{ path: 'src/ok.txt', content: 'hi' }] }, usage: ZERO_USAGE },
    ]);

    // A check that writes a stray out-of-scope file into the worktree, modeling a
    // side-effect the per-leaf artifact-path check cannot see. The tree-level
    // diff ⊆ scope guard at root emission must catch it.
    const strayWriter: DeterministicCheck = {
      name: 'stray-writer',
      async run(_g, _a, ctx) {
        if (ctx?.sandboxRoot) {
          writeFileSync(join(ctx.sandboxRoot, 'lib-escape.txt'), 'stray\n');
        }
        return { ok: true, detail: '' };
      },
    };

    const registry = buildRegistry([implType([strayWriter])]);
    const engine = new Engine({
      registry,
      brain,
      store,
      memory: new NoopMemoryView(),
      sandbox: { repoRoot: repo, declaredScripts: {} },
    });

    const goal = makeGoal({ id: 'root-escape', type: 'implement', scope: ['src/'] });
    const report = await engine.run(goal);

    expect(report.blockers.length).toBeGreaterThan(0);
    expect(report.blockers[0]).toMatch(/scope insufficiency/i);
    // A scope escape preserves the tree (it is not a clean success).
    const preserved = await store.list({ type: 'worktree-preserved' });
    expect(preserved).toHaveLength(1);
  });

  it('runs declared scripts with a scrubbed child env (secrets removed)', async () => {
    const repo = makeTempRepo();
    const store = new MemoryEventStore();

    // A declared script that exits 0 IFF OPENROUTER_API_KEY is absent AND
    // PATH is present (non-empty) — i.e. the scrub removed the secret but kept
    // the benign toolchain env.
    const scriptRel = 'check-env.mjs';
    writeFileSync(
      join(repo, scriptRel),
      [
        'const leaked = process.env.OPENROUTER_API_KEY;',
        'if (leaked) { console.error("LEAKED: " + leaked); process.exit(1); }',
        // Also assert PATH survived — over-scrubbing is caught here.
        'if (!process.env.PATH) { console.error("PATH missing after scrub"); process.exit(1); }',
        'console.log("clean"); process.exit(0);',
      ].join('\n'),
    );
    execFileSync('git', ['add', scriptRel], { cwd: repo, stdio: 'pipe' });
    execFileSync('git', ['commit', '-m', 'add env check script'], { cwd: repo, stdio: 'pipe' });

    // Set the secret in the factory's own env; the scrub must strip it.
    const prior = process.env.OPENROUTER_API_KEY;
    process.env.OPENROUTER_API_KEY = 'sk-or-secret';
    cleanups.push(() => {
      if (prior === undefined) delete process.env.OPENROUTER_API_KEY;
      else process.env.OPENROUTER_API_KEY = prior;
    });

    // A check that runs the declared script through ctx.runScript and gates on it.
    const envCheck: DeterministicCheck = {
      name: 'env-check',
      async run(_g, _a, ctx) {
        if (!ctx?.runScript) return { ok: false, detail: 'no exec context' };
        const r = await ctx.runScript('checkenv');
        return { ok: r.ok, detail: r.output };
      },
    };

    const brain = planBrain([
      { kind: 'artifact', artifact: { kind: 'files', files: [{ path: 'src/out.txt', content: 'x' }] }, usage: ZERO_USAGE },
    ]);
    const registry = buildRegistry([implType([envCheck])]);
    const engine = new Engine({
      registry,
      brain,
      store,
      memory: new NoopMemoryView(),
      sandbox: { repoRoot: repo, declaredScripts: { checkenv: scriptRel } },
    });

    const goal = makeGoal({ id: 'root-env', type: 'implement', scope: ['src/'] });
    const report = await engine.run(goal);

    // The script exited 0 → the secret was scrubbed → the check passed → success.
    expect(report.blockers).toHaveLength(0);
    // The run was logged against the executing leaf goal's id.
    const scriptRan = await store.list({ type: 'script-ran' });
    expect(scriptRan).toHaveLength(1);
    expect(scriptRan[0]?.goalId).toBe('root-env');
    if (scriptRan[0]?.type === 'script-ran') {
      expect(scriptRan[0].exitStatus).toBe(0);
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
// KNOWLEDGE / EYES WIRING (AC-1)
// ───────────────────────────────────────────────────────────────────────────

describe('assembly — knowledge wiring (AC-1)', () => {
  it('registers the five retrieval tools in the broker only when knowledge wiring is on', async () => {
    const repo = makeTempRepo();
    const store = new MemoryEventStore();
    const registry = buildRegistry([implType([])]);

    const off = await openSandboxAssembly(
      { repoRoot: repo, declaredScripts: {} },
      'g-off',
      registry,
      store,
    );
    const offDefs = (off.broker as unknown as { defs(): { name: string }[] }).defs().map((d) => d.name);
    expect(offDefs).not.toContain('find_symbol');
    expect(offDefs).not.toContain('impact');

    const on = await openSandboxAssembly(
      { repoRoot: repo, declaredScripts: {}, knowledge: true },
      'g-on',
      registry,
      store,
    );
    const onDefs = (on.broker as unknown as { defs(): { name: string }[] }).defs().map((d) => d.name);
    for (const name of ['find_symbol', 'find_exemplar', 'conventions_for', 'stack_versions', 'impact']) {
      expect(onDefs).toContain(name);
    }
  });

  it('rebindKnowledgeScan replaces the no-op map-repo scanner with a real one', () => {
    const before = starterTypes().find((t) => t.name === 'map-repo')!;
    const beforeCheck = before.deterministic.find((c) => c.name === 'knowledge:map-repo')!;

    const rebound = rebindKnowledgeScan(starterTypes()).find((t) => t.name === 'map-repo')!;
    const afterCheck = rebound.deterministic.find((c) => c.name === 'knowledge:map-repo')!;

    // Same check identity (name preserved) but a distinct instance — the no-op
    // closure was swapped for the real scanImports-backed one.
    expect(afterCheck.name).toBe('knowledge:map-repo');
    expect(afterCheck).not.toBe(beforeCheck);
    // Other types are untouched (referentially identical where unchanged).
    expect(rebindKnowledgeScan(starterTypes()).find((t) => t.name === 'implement')!.name).toBe('implement');
  });

  it('assembleKnowledgeWiring builds query/headSha/validate/mint/persist over the real parts', async () => {
    const repo = makeTempRepo();
    const store = new MemoryEventStore();
    const registry = buildRegistry(rebindKnowledgeScan(starterTypes()));
    const wiring = assembleKnowledgeWiring({ repoRoot: repo, declaredScripts: {}, knowledge: true }, store, registry);

    // headSha reads the fixture's real HEAD (40-hex git sha).
    const head = await wiring.headSha(repo);
    expect(head).toMatch(/^[0-9a-f]{7,40}$/);

    // query over an empty log → no artifacts, headSha threaded through.
    const empty = await wiring.query(repo);
    expect(empty.artifacts).toHaveLength(0);
    expect(empty.headSha).toBe(head);

    // mintComprehension turns a category miss into a map-repo child (deps stripped).
    const minted = wiring.mintComprehension!([
      { category: 'architecture', reason: 'absent' },
    ]);
    expect(minted).toHaveLength(1);
    expect(minted[0]?.type).toBe('map-repo');
    expect(minted[0]?.dependsOn).toEqual([]);

    // persist parses a learn leaf's artifact JSON and appends a knowledge-written event.
    const ka: KnowledgeArtifact = {
      repoRoot: repo,
      category: 'conventions',
      generatedAtSha: head,
      confidence: 'medium',
      status: 'provisional',
      pointers: [],
      summary: 'wiring test',
    };
    const learnGoal = makeGoal({ id: 'g-learn', type: 'map-repo' });
    await wiring.persist!(learnGoal, { kind: 'text', text: JSON.stringify(ka) });
    const written = await store.list({ type: 'knowledge-written' });
    expect(written).toHaveLength(1);

    // query now sees the written artifact for this repo.
    const after = await wiring.query(repo);
    expect(after.artifacts.map((a) => a.category)).toContain('conventions');
  });

  it('persist is a no-op for non-learn goals and malformed artifacts', async () => {
    const repo = makeTempRepo();
    const store = new MemoryEventStore();
    const registry = buildRegistry(rebindKnowledgeScan(starterTypes()));
    const wiring = assembleKnowledgeWiring({ repoRoot: repo, declaredScripts: {}, knowledge: true }, store, registry);

    // make-kind goal → not persisted.
    await wiring.persist!(makeGoal({ id: 'g-make', type: 'implement' }), { kind: 'text', text: '{}' });
    // learn goal but unparseable text → not persisted.
    await wiring.persist!(makeGoal({ id: 'g-bad', type: 'map-repo' }), { kind: 'text', text: 'not json' });

    expect(await store.list({ type: 'knowledge-written' })).toHaveLength(0);
    expect(await store.list({ type: 'knowledge-facts-written' })).toHaveLength(0);
  });

  it('knowledge wiring absent → byte-identical iteration-03 broker (no retrieval tools, no knowledge events)', async () => {
    const repo = makeTempRepo();
    const store = new MemoryEventStore();
    const brain = planBrain([
      { kind: 'artifact', artifact: { kind: 'files', files: [{ path: 'src/out.txt', content: 'x' }] }, usage: ZERO_USAGE },
    ]);
    const registry = buildRegistry([implType([])]);
    // No knowledge in EngineOptions, knowledge:false (default) in sandbox.
    const engine = new Engine({
      registry,
      brain,
      store,
      memory: new NoopMemoryView(),
      sandbox: { repoRoot: repo, declaredScripts: {} },
    });
    const report = await engine.run(makeGoal({ id: 'root-no-k', type: 'implement', scope: ['src/'] }));
    expect(report.blockers).toHaveLength(0);

    const types = store.types();
    expect(types).not.toContain('gate-checked');
    expect(types).not.toContain('knowledge-written');
    expect(types).not.toContain('knowledge-checked');
  });
});
