/**
 * Chunk 2 — the scripted full-stack convergence test (the iteration's done-when,
 * minus "live"). Drives the WHOLE composed path with a scripted brain against a
 * real tmp git fixture repo. Zero network.
 *
 * The fixture declares a `test` script (node check.mjs) that exits 1 while the
 * target file is wrong and 0 once it is fixed. The scripted implement leaf:
 *   1. writes WRONG content to the in-scope target,
 *   2. runs the test (RED),
 *   3. attempts one OUT-OF-SCOPE write (refused — refusal is data),
 *   4. writes the FIX,
 *   5. runs the test (GREEN),
 *   6. emits the artifact.
 * The type's executing deterministic check is runScriptCheck('test') with the
 * engine-supplied CheckContext; it gates on the real exit status.
 *
 * Collectively this pins: the broker mediates real fs + run_script tools bound
 * to the worktree, scope enforcement refuses out-of-scope writes, the executing
 * check runs the declared script with the LEAF goal's id on its script-ran
 * events, usage-bearing events feed a non-zero cost projection, diff ⊆ scope is
 * enforced at root emission, and the worktree is collected with commits on the
 * tree branch.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

import { Engine } from '../../src/engine/engine.js';
import { MemoryEventStore, NoopMemoryView, buildRegistry, makeGoal } from './stubs.js';
import { runScriptCheck } from '../../src/library/checks.js';
import { costSummary } from '../../src/eventlog/projections.js';
import type { Brain, BrainContext, StepOutput, StepTranscript } from '../../src/contract/brain.js';
import type { Goal, Metered, Usage } from '../../src/contract/goal.js';
import { ZERO_USAGE } from '../../src/contract/goal.js';
import type { Decision, ChildPlan } from '../../src/contract/decision.js';
import type { Artifact } from '../../src/contract/report.js';
import type { Verdict } from '../../src/contract/verdict.js';
import type { ToolDef } from '../../src/contract/tool.js';
import type { GoalTypeDef } from '../../src/contract/goal-type.js';

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

const RIGHT = 'CONVERGED';

/**
 * Build the fixture repo: package.json declaring a "test" script, and a check
 * script (check.mjs) that exits 0 iff src/target.txt contains the right marker.
 * The check.mjs and package.json live in HEAD (committed) so they do not appear
 * in the worktree diff; only the leaf's src/ write counts toward the diff.
 */
function makeFixtureRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'corellia-conv-'));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  execFileSync('git', ['init'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: dir, stdio: 'pipe' });

  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name: 'fixture', version: '0.0.0', scripts: { test: 'node check.mjs' } }, null, 2) + '\n',
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
  execFileSync('git', ['add', 'package.json', 'check.mjs'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['commit', '-m', 'fixture'], { cwd: dir, stdio: 'pipe' });
  return dir;
}

const USAGE: Usage = { promptTokens: 100, completionTokens: 40, costUsd: 0.0021 };

/** Drive the step loop with a fixed plan; classic methods unused for the leaf. */
function planBrain(steps: StepOutput[]): Brain {
  let i = 0;
  return {
    async decide(): Promise<Metered<Decision>> {
      return { value: { kind: 'satisfy' }, usage: ZERO_USAGE };
    },
    async produce(): Promise<Metered<Artifact>> {
      throw new Error('produce not used');
    },
    async judge(): Promise<Metered<Verdict>> {
      // If consulted, record a pass — but the test asserts it is NOT consulted
      // while the script is red.
      return { value: { pass: true, findings: [] }, usage: USAGE };
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

function implType(): GoalTypeDef {
  return {
    name: 'implement',
    kind: 'make',
    family: 'build',
    leafOnly: true,
    tier: { default: 'sonnet', ladder: ['sonnet', 'opus'] },
    // The executing check: run the declared "test" script via the engine ctx.
    deterministic: [runScriptCheck('test')],
    judgeType: 'critique-code',
    grants: ['fs.read', 'fs.write', 'test.run_impacted'],
  };
}

describe('convergence — scripted full-stack composed path', () => {
  it('drives red→refusal→green→emit and converges with the worktree collected', async () => {
    const repo = makeFixtureRepo();
    const store = new MemoryEventStore();

    const brain = planBrain([
      // 1. WRONG content + 2. run the test (RED).
      {
        kind: 'tool-calls',
        calls: [
          { id: 's1', name: 'write_file', args: { path: 'src/target.txt', content: 'WRONG' } },
          { id: 's2', name: 'run_script', args: { script: 'test' } },
        ],
        usage: USAGE,
      },
      // 3. an OUT-OF-SCOPE write (refused).
      {
        kind: 'tool-calls',
        calls: [{ id: 's3', name: 'write_file', args: { path: 'lib/escape.txt', content: 'nope' } }],
        usage: USAGE,
      },
      // 4. the FIX + 5. run the test (GREEN).
      {
        kind: 'tool-calls',
        calls: [
          { id: 's4', name: 'write_file', args: { path: 'src/target.txt', content: RIGHT } },
          { id: 's5', name: 'run_script', args: { script: 'test' } },
        ],
        usage: USAGE,
      },
      // 6. emit.
      {
        kind: 'artifact',
        artifact: { kind: 'files', files: [{ path: 'src/target.txt', content: RIGHT }] },
        usage: USAGE,
      },
    ]);

    const registry = buildRegistry([implType()]);
    const engine = new Engine({
      registry,
      brain,
      store,
      memory: new NoopMemoryView(),
      sandbox: { repoRoot: repo, declaredScripts: { test: 'check.mjs' } },
    });

    const goal = makeGoal({
      id: 'conv-root',
      type: 'implement',
      title: 'make the declared test pass',
      scope: ['src/'],
      budget: { attempts: 3, tokens: 100_000, toolCalls: 50, wallClockMs: 120_000 },
    });

    const report = await engine.run(goal);
    const events = await store.list();

    // ── converged ──────────────────────────────────────────────────────────
    expect(report.blockers).toHaveLength(0);
    expect(report.artifact).toEqual({ kind: 'files', files: [{ path: 'src/target.txt', content: RIGHT }] });

    // ── the out-of-scope write was refused, in the transcript AND as an event ─
    const toolCalls = events.filter((e) => e.type === 'tool-call');
    const refused = toolCalls.filter((e) => e.type === 'tool-call' && e.outcome === 'refused');
    expect(refused.length).toBeGreaterThanOrEqual(1);
    const refusedScopes = refused.map((e) => (e.type === 'tool-call' ? e.tool : ''));
    expect(refusedScopes).toContain('write_file');

    // ── the executing check ran the script via script-ran events ─────────────
    // run_script was called twice by the leaf (red + green) and once more by the
    // deterministic gate (green) — all logged against the LEAF goal's id.
    const scriptRan = events.filter((e) => e.type === 'script-ran');
    expect(scriptRan.length).toBeGreaterThanOrEqual(2);
    for (const e of scriptRan) {
      expect(e.goalId).toBe('conv-root');
    }
    // At least one RED (exit 1) and at least one GREEN (exit 0) run occurred.
    const exits = scriptRan.map((e) => (e.type === 'script-ran' ? e.exitStatus : null));
    expect(exits).toContain(1);
    expect(exits).toContain(0);

    // ── the judge was never consulted while the script was red ───────────────
    // The deterministic gate runs before any judge; with the gate passing only
    // on the green run, the first judge-verdict (if any) must come AFTER the
    // first green script-ran in the event order.
    const firstGreenIdx = events.findIndex(
      (e) => e.type === 'script-ran' && e.exitStatus === 0,
    );
    const firstJudgeIdx = events.findIndex((e) => e.type === 'judge-verdict');
    if (firstJudgeIdx !== -1) {
      expect(firstJudgeIdx).toBeGreaterThan(firstGreenIdx);
    }

    // ── usage-bearing events feed a non-zero cost projection ──────────────────
    const hasUsageEvent = events.some(
      (e) => e.type === 'step' && e.usage !== undefined && e.usage.costUsd !== undefined,
    );
    expect(hasUsageEvent).toBe(true);
    const cost = costSummary(events);
    expect(cost.tree.promptTokens).toBeGreaterThan(0);
    expect(cost.tree.completionTokens).toBeGreaterThan(0);
    expect(cost.tree.costUsd).toBeGreaterThan(0);

    // ── diff ⊆ scope enforced at root emission; worktree collected ────────────
    const collected = events.filter((e) => e.type === 'worktree-collected');
    expect(collected).toHaveLength(1);
    const collectedEvent = collected[0];
    expect(collectedEvent?.type).toBe('worktree-collected');
    if (collectedEvent?.type === 'worktree-collected') {
      expect(collectedEvent.commits.length).toBeGreaterThan(0);
      // The commit landed on the tree branch.
      const log = execFileSync(
        'git',
        ['-C', repo, 'log', '--format=%H', collectedEvent.branch],
        { encoding: 'utf-8' },
      ).trim();
      expect(log).toContain(collectedEvent.commits[0]);
    }
  });
});

// ── attribution: SPLIT tree, script-ran goalId equals child id ──
//
// A root goal splits into one tool-granted implement child leaf that calls
// run_script. The script-ran event's goalId must equal the CHILD leaf's id, not
// the root's. Uses ScriptedBrain with decide-to-split + scripted child steps,
// against a real git fixture repo with a `test` script (mirroring the convergence
// pattern above).

describe('script-ran attribution: SPLIT tree attributes run to CHILD leaf', () => {
  it('script-ran event goalId equals child leaf id, not root id', async () => {
    const repo = makeFixtureRepo();
    const store = new MemoryEventStore();

    // Root type: splits (non-leaf). Child type: tool-granted implement leaf.
    const rootType: GoalTypeDef = {
      name: 'splitter',
      kind: 'make',
      family: 'build',
      leafOnly: false,
      tier: { default: 'sonnet', ladder: ['sonnet'] },
      deterministic: [],
      judgeType: null,
      grants: [],
    };

    const childLeafType: GoalTypeDef = {
      name: 'implement',
      kind: 'make',
      family: 'build',
      leafOnly: true,
      tier: { default: 'sonnet', ladder: ['sonnet'] },
      // The executing check runs the declared test script via ctx.
      deterministic: [runScriptCheck('test')],
      judgeType: null,
      grants: ['fs.read', 'fs.write', 'test.run_impacted'],
    };

    // The root brain decides to split into one implement child.
    const childPlan: ChildPlan = {
      localId: 'impl',
      type: 'implement',
      title: 'write the fix',
      spec: { description: 'write src/target.txt with CONVERGED' },
      dependsOn: [],
      scope: ['src/'],
      budgetShare: 1.0,
    };

    // ScriptedBrain: root decides to split; child steps drive the step loop.
    // The child: write the fix, run_script (GREEN), emit artifact.
    let decideCount = 0;
    let stepCount = 0;

    const childSteps: StepOutput[] = [
      // Write the correct content.
      {
        kind: 'tool-calls',
        calls: [
          { id: 'f1', name: 'write_file', args: { path: 'src/target.txt', content: RIGHT } },
        ],
        usage: USAGE,
      },
      // Run the test (GREEN).
      {
        kind: 'tool-calls',
        calls: [{ id: 'rs1', name: 'run_script', args: { script: 'test' } }],
        usage: USAGE,
      },
      // Emit the artifact.
      {
        kind: 'artifact',
        artifact: { kind: 'files', files: [{ path: 'src/target.txt', content: RIGHT }] },
        usage: USAGE,
      },
    ];

    const splitBrain: Brain = {
      async decide(_goal: Goal, _ctx: BrainContext): Promise<Metered<Decision>> {
        decideCount++;
        return { value: { kind: 'split', children: [childPlan] }, usage: ZERO_USAGE };
      },
      async produce(): Promise<Metered<Artifact>> {
        throw new Error('produce not used in split test');
      },
      async judge(): Promise<Metered<Verdict>> {
        return { value: { pass: true, findings: [] }, usage: USAGE };
      },
      async repair(): Promise<Metered<Artifact>> {
        throw new Error('repair not used');
      },
      async step(
        _goal: Goal,
        _transcript: import('../../src/contract/brain.js').StepTranscript,
        _tools: ToolDef[],
        _ctx: BrainContext,
      ): Promise<StepOutput> {
        const out = childSteps[stepCount];
        stepCount++;
        if (out === undefined) throw new Error('splitBrain: step plan exhausted');
        return out;
      },
    };

    const registry = buildRegistry([rootType, childLeafType]);
    const engine = new Engine({
      registry,
      brain: splitBrain,
      store,
      memory: new NoopMemoryView(),
      sandbox: { repoRoot: repo, declaredScripts: { test: 'check.mjs' } },
    });

    const rootGoal = makeGoal({
      id: 'split-root',
      type: 'splitter',
      title: 'split and fix',
      scope: ['src/'],
      budget: { attempts: 3, tokens: 100_000, toolCalls: 50, wallClockMs: 120_000 },
    });

    const report = await engine.run(rootGoal);
    const events = await store.list();

    // The tree must succeed.
    expect(report.blockers).toHaveLength(0);

    // The expected child leaf id is 'split-root/impl'.
    const childId = 'split-root/impl';

    // All script-ran events must carry the CHILD's goalId, not the root's.
    const scriptRanEvents = events.filter((e) => e.type === 'script-ran');
    expect(scriptRanEvents.length).toBeGreaterThanOrEqual(1);
    for (const e of scriptRanEvents) {
      expect(e.goalId).toBe(childId);
      expect(e.goalId).not.toBe('split-root');
    }

    // At least one green exit-0 script-ran event exists.
    const greenRuns = scriptRanEvents.filter(
      (e) => e.type === 'script-ran' && e.exitStatus === 0,
    );
    expect(greenRuns.length).toBeGreaterThanOrEqual(1);

    // The child-spawned event names the child.
    const spawned = events.filter((e) => e.type === 'child-spawned');
    expect(spawned).toHaveLength(1);
    if (spawned[0]?.type === 'child-spawned') {
      expect(spawned[0].childId).toBe(childId);
    }
  });
});
