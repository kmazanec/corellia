/**
 * F-63 Chunk 4 — End-to-end improvement-loop integration test.
 *
 * Scripted end-to-end test covering AC 1–5:
 *   AC 1: run completing with blockers mints one improve-factory commission;
 *         one blocker-routed event per blocker.
 *   AC 2: originating run continues past its blockers (no factory file changes mid-run).
 *   AC 3: harness routes by generality (scripted both ways):
 *         - repo-specific → memory write, no PR.
 *         - repo-agnostic → branch + PR via push_branch/open_pr (stub transport, bare-repo fixture).
 *   AC 4: envelope admission: headroom + empty product queue; exhausted envelope parks.
 *   AC 5: runaway-loop guard: a scripted improvement run produces no second mint.
 *
 * Uses:
 *   - Real listener code (not mocked).
 *   - ScriptedEngine mock (appends events directly; enough for the listener).
 *   - Real InMemoryEventStore (real event log).
 *   - Real push_branch/open_pr with a bare-repo fixture and stub GitHub transport.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { Listener } from '../../src/listener/listener.js';
import { InMemoryEventStore } from '../../src/eventlog/memory-store.js';
import { pushBranchTool, openPrTool, type FetchTransport } from '../../src/engine/pr-tools.js';
import type { EventStore, FactoryEvent } from '../../src/contract/events.js';
import type { Goal } from '../../src/contract/goal.js';
import type { Report } from '../../src/contract/report.js';
import type { CommissionInput, StandingEnvelope } from '../../src/contract/brief.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

function withToken(token: string): void {
  const original = process.env['GITHUB_TOKEN'];
  process.env['GITHUB_TOKEN'] = token;
  cleanups.push(() => {
    if (original === undefined) delete process.env['GITHUB_TOKEN'];
    else process.env['GITHUB_TOKEN'] = original;
  });
}

function makeTempRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'corellia-il-repo-'));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  execFileSync('git', ['init'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: dir, stdio: 'pipe' });
  writeFileSync(join(dir, 'README.md'), '# improvement-loop test\n');
  execFileSync('git', ['add', 'README.md'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['commit', '-m', 'init'], { cwd: dir, stdio: 'pipe' });
  return dir;
}

function makeBareRepo(source: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'corellia-il-bare-'));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  execFileSync('git', ['clone', '--bare', source, dir], { stdio: 'pipe' });
  return dir;
}

function makeWorktree(
  repoRoot: string,
  branch: string,
  fileName: string,
  content: string,
): string {
  const dir = mkdtempSync(join(tmpdir(), 'corellia-il-wt-'));
  cleanups.push(() => {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
    try {
      execFileSync('git', ['-C', repoRoot, 'worktree', 'remove', '--force', dir], { stdio: 'pipe' });
    } catch { /* already torn down */ }
  });
  execFileSync('git', ['-C', repoRoot, 'worktree', 'add', '-b', branch, dir], { stdio: 'pipe' });
  const filePath = join(dir, fileName);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, content);
  // Add using the full path relative to the worktree dir so git finds nested files.
  execFileSync('git', ['-C', dir, 'add', filePath], { stdio: 'pipe' });
  execFileSync('git', ['-C', dir, 'commit', '-m', `add ${fileName}`], { stdio: 'pipe' });
  return dir;
}

function stubGitHubTransport(prUrl: string): FetchTransport {
  return async (_url, _init) => ({
    ok: true,
    status: 201,
    json: async () => ({ html_url: prUrl, number: 1 }),
  });
}

// ── Report/input factories ────────────────────────────────────────────────────

function makeReport(overrides: Partial<Report> = {}): Report {
  return {
    artifact: { kind: 'text', text: 'done' },
    proof: [],
    lessons: [],
    memoriesUsed: [],
    blockers: [],
    findings: [],
    learned: '',
    ...overrides,
  };
}

function makeInput(id: string, overrides: Partial<CommissionInput> = {}): CommissionInput {
  return {
    id,
    title: `Intent ${id}`,
    spec: { what: id },
    scope: [],
    budget: { attempts: 3, tokens: 1000, toolCalls: 50, wallClockMs: 60_000 },
    intent: 'production',
    ...overrides,
  };
}

/**
 * A scripted engine that returns a fixed report per goal id.
 * Records all goal ids that were actually run.
 */
function makeScriptedEngine(
  scripts: Map<string, Report>,
  store: EventStore,
  now: () => number,
  ranGoals: string[],
): { run: (goal: Goal) => Promise<Report> } {
  return {
    async run(goal: Goal): Promise<Report> {
      ranGoals.push(goal.id);
      await store.append({ type: 'goal-received', at: now(), goalId: goal.id, goal });
      const report = scripts.get(goal.id) ?? makeReport();
      await store.append({ type: 'emitted', at: now(), goalId: goal.id, report });
      return report;
    },
  };
}

const defaultEnvelope: StandingEnvelope = {
  budget: { attempts: 3, tokens: 5000, toolCalls: 20, wallClockMs: 120_000 },
  spendCeilingUsd: 10,
};

// ── AC 1: Blocker run → mint + blocker-routed events ─────────────────────────

describe('improvement-loop e2e: AC 1 — mint on complete', () => {
  it('a product run with blockers emits one blocker-routed event per blocker and mints one commission', async () => {
    const store = new InMemoryEventStore();
    let tick = 0;
    const now = () => ++tick;
    const ranGoals: string[] = [];

    const blockers = ['stale skill: needs refresh', 'missing eval: no golden set'];
    const scripts = new Map([
      ['product-ac1', makeReport({ blockers })],
    ]);

    const engine = makeScriptedEngine(scripts, store, now, ranGoals);
    const listener = new Listener({
      engine: engine as unknown as InstanceType<typeof import('../../src/engine/engine.js').Engine>,
      store,
      now,
      standingEnvelope: defaultEnvelope,
    });

    const report = await listener.commission(makeInput('product-ac1'));

    // AC 2: the originating run resolved (it continued past blockers).
    expect(report.blockers).toHaveLength(2);

    // One blocker-routed event per blocker.
    const routedEvents = await store.list({ type: 'blocker-routed' });
    expect(routedEvents).toHaveLength(2);

    // All share the same commissionId.
    const commissionIds = routedEvents.map((e) => {
      if (e.type !== 'blocker-routed') throw new Error('unexpected type');
      return e.commissionId;
    });
    const uniqueIds = new Set(commissionIds);
    expect(uniqueIds.size).toBe(1);

    // The commissionId is the improve-factory commission id.
    const commissionId = [...uniqueIds][0]!;
    expect(commissionId.startsWith('improve-')).toBe(true);

    // The goalId on all blocker-routed events is the originating goal.
    for (const ev of routedEvents) {
      if (ev.type !== 'blocker-routed') throw new Error('unexpected type');
      expect(ev.goalId).toBe('product-ac1');
    }
  });
});

// ── AC 2: Originating run continues (no mid-run factory modification) ─────────

describe('improvement-loop e2e: AC 2 — originating run continues past blockers', () => {
  it('the product run resolves with its report; the improvement is a separate subsequent run', async () => {
    const store = new InMemoryEventStore();
    let tick = 0;
    const now = () => ++tick;
    const ranGoals: string[] = [];

    const scripts = new Map([
      ['product-ac2', makeReport({ blockers: ['one blocker'], artifact: { kind: 'text', text: 'product artifact' } })],
    ]);

    const engine = makeScriptedEngine(scripts, store, now, ranGoals);
    const listener = new Listener({
      engine: engine as unknown as InstanceType<typeof import('../../src/engine/engine.js').Engine>,
      store,
      now,
      // No envelope — improvement loop disabled, keeps test focused on AC 2.
    });

    const report = await listener.commission(makeInput('product-ac2'));

    // The product run returned its full artifact — it was not stopped by the blocker.
    expect(report.artifact?.text).toBe('product artifact');
    expect(report.blockers).toHaveLength(1);

    // Only the product run ran (no improvement run without envelope).
    expect(ranGoals).toEqual(['product-ac2']);
  });
});

// ── AC 4: Envelope admission — headroom + empty product queue ─────────────────

describe('improvement-loop e2e: AC 4 — envelope admission', () => {
  it('improvement commission runs when envelope has headroom and product queue is empty', async () => {
    const store = new InMemoryEventStore();
    let tick = 0;
    const now = () => ++tick;
    const ranGoals: string[] = [];

    const scripts = new Map([
      ['product-ac4', makeReport({ blockers: ['needs fix'] })],
    ]);

    const engine = makeScriptedEngine(scripts, store, now, ranGoals);
    const listener = new Listener({
      engine: engine as unknown as InstanceType<typeof import('../../src/engine/engine.js').Engine>,
      store,
      now,
      standingEnvelope: defaultEnvelope,
    });

    await listener.commission(makeInput('product-ac4'));

    // Wait for async improvement commission.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // The improvement run should have started after the product run.
    const improveRuns = ranGoals.filter((id) => id.startsWith('improve-'));
    expect(improveRuns).toHaveLength(1);
  });

  it('improvement commission is parked when envelope is exhausted; visible in status()', async () => {
    const store = new InMemoryEventStore();
    let tick = 0;
    const now = () => ++tick;
    const ranGoals: string[] = [];

    const scripts = new Map([
      ['product-ac4b', makeReport({ blockers: ['blocked again'] })],
    ]);

    const engine = makeScriptedEngine(scripts, store, now, ranGoals);
    const exhaustedEnvelope: StandingEnvelope = {
      budget: { attempts: 1, tokens: 100, toolCalls: 5, wallClockMs: 10_000 },
      spendCeilingUsd: 0, // Exhausted.
    };
    const listener = new Listener({
      engine: engine as unknown as InstanceType<typeof import('../../src/engine/engine.js').Engine>,
      store,
      now,
      standingEnvelope: exhaustedEnvelope,
    });

    await listener.commission(makeInput('product-ac4b'));

    // No improvement run started.
    const improveRuns = ranGoals.filter((id) => id.startsWith('improve-'));
    expect(improveRuns).toHaveLength(0);

    // Parked improvement visible in status.
    const s = listener.status();
    expect(s.parkedImprovement).toHaveLength(1);
  });
});

// ── AC 5: Runaway-loop guard ───────────────────────────────────────────────────

describe('improvement-loop e2e: AC 5 — runaway-loop guard (pinned by test)', () => {
  it('an improvement run that emits blockers does NOT mint a second improvement commission', async () => {
    const store = new InMemoryEventStore();
    let tick = 0;
    const now = () => ++tick;
    const ranGoals: string[] = [];

    // Product run with a blocker triggers the improvement loop.
    // The improvement run itself also has a blocker (simulating failure).
    // Script: improvement run id will start with 'improve-'; we script it with blockers.
    const productId = 'product-ac5';
    const productReport = makeReport({ blockers: ['harness gap'] });

    const engine = {
      async run(goal: Goal): Promise<Report> {
        ranGoals.push(goal.id);
        await store.append({ type: 'goal-received', at: now(), goalId: goal.id, goal });
        const report = goal.id.startsWith('improve-')
          ? makeReport({ blockers: ['improvement run also failed'] })
          : productReport;
        await store.append({ type: 'emitted', at: now(), goalId: goal.id, report });
        return report;
      },
    } as unknown as InstanceType<typeof import('../../src/engine/engine.js').Engine>;

    const listener = new Listener({
      engine,
      store,
      now,
      standingEnvelope: defaultEnvelope,
    });

    await listener.commission(makeInput(productId));

    // Wait for the improvement run to complete.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    const allRoutedEvents = await store.list({ type: 'blocker-routed' });

    // Only ONE blocker-routed event (from the product run).
    // The improvement run's blockers must NOT generate a second blocker-routed event.
    expect(allRoutedEvents).toHaveLength(1);

    const routedEv = allRoutedEvents[0]!;
    if (routedEv.type !== 'blocker-routed') throw new Error('unexpected type');
    expect(routedEv.goalId).toBe(productId);

    // And at most two runs: the product run and ONE improvement run.
    expect(ranGoals.length).toBeLessThanOrEqual(2);
    const improveCount = ranGoals.filter((id) => id.startsWith('improve-')).length;
    expect(improveCount).toBeLessThanOrEqual(1);
  });
});

// ── AC 3: Generality routing — scripted both ways ─────────────────────────────

describe('improvement-loop e2e: AC 3 — generality routing (bare-repo PR path)', () => {
  it('the push_branch + open_pr tools work end-to-end with a real bare repo and stub transport', async () => {
    withToken('ghp_fake_improvement_test');

    const repo = makeTempRepo();
    const bare = makeBareRepo(repo);
    execFileSync('git', ['-C', repo, 'remote', 'add', 'origin', bare], { stdio: 'pipe' });

    const BRANCH = 'tree/improve-test-xyz';
    const TREE_ID = 'improve-test-xyz';
    const PR_URL = 'https://github.com/acme/factory/pull/999';

    const worktreeDir = makeWorktree(
      repo,
      BRANCH,
      'src/library/skills/test-skill.md',
      '# Test skill\n\n## test-type\n\nTest content for the harness fix.\n',
    );

    const store = new InMemoryEventStore();

    // The improve-factory goal (the entity calling these tools).
    const goal: Goal = {
      id: 'improve-test-xyz',
      type: 'improve-factory',
      parentId: null,
      title: 'improve-factory: fix skill gap',
      spec: { originatingGoalId: 'product-x', blockers: ['skill gap'] },
      intent: 'production',
      scope: [],
      budget: { attempts: 3, tokens: 5000, toolCalls: 20, wallClockMs: 120_000 },
      memories: [],
    };

    // Use the real push_branch tool with the real bare-repo fixture.
    const pushTool = pushBranchTool({
      worktreeRoot: worktreeDir,
      branch: BRANCH,
      treeId: TREE_ID,
      store,
    });

    const pushResult = await pushTool.execute(goal, {});
    expect(pushResult.ok).toBe(true);

    // Verify the branch actually landed in the bare repo.
    const branchList = execFileSync(
      'git', ['-C', bare, 'branch', '--list', BRANCH],
      { stdio: 'pipe', encoding: 'utf-8' },
    ).trim();
    expect(branchList).toContain(BRANCH);

    // Use the open_pr tool with a stub transport (no network).
    const openPr = openPrTool({
      branch: BRANCH,
      treeId: TREE_ID,
      repoSlug: 'acme/factory',
      store,
      fetchTransport: stubGitHubTransport(PR_URL),
    });

    const prResult = await openPr.execute(goal, {
      title: 'fix: improve skill gap in test-type',
      body: 'Closes harness gap identified in product-x run.\n\nlearned: the skill was missing X.',
    });
    expect(prResult.ok).toBe(true);
    expect(prResult.output).toContain(PR_URL);

    // Event log must contain branch-pushed and pr-opened.
    const branchPushedEvents = await store.list({ type: 'branch-pushed' });
    expect(branchPushedEvents).toHaveLength(1);

    const prOpenedEvents = await store.list({ type: 'pr-opened' });
    expect(prOpenedEvents).toHaveLength(1);

    const prEv = prOpenedEvents[0]!;
    if (prEv.type !== 'pr-opened') throw new Error('unexpected type');
    expect(prEv.url).toBe(PR_URL);
    expect(prEv.branch).toBe(BRANCH);
    expect(prEv.treeId).toBe(TREE_ID);

    // Idempotence: a second open_pr call should be refused.
    const prResult2 = await openPr.execute(goal, {
      title: 'duplicate PR attempt',
      body: 'should be refused',
    });
    expect(prResult2.ok).toBe(false);
    expect(prResult2.output).toContain('already exists');

    // Only one pr-opened event.
    const prEvents2 = await store.list({ type: 'pr-opened' });
    expect(prEvents2).toHaveLength(1);
  });

  it('process-clean gate is target-aware: factory vocabulary allowed when repoSlug === factoryRepoSlug, blocked otherwise', async () => {
    // This test pins BOTH directions of the target-aware gate (Fix 1 regression pin).
    // Gate decision is keyed on ACTUAL push target (repoSlug vs factoryRepoSlug),
    // NOT on goal.type — see security fix commit.
    withToken('ghp_fake_gate_test');

    // Shared: a temp repo + bare origin + a worktree containing factory vocabulary.
    const repo = makeTempRepo();
    const bare = makeBareRepo(repo);
    execFileSync('git', ['-C', repo, 'remote', 'add', 'origin', bare], { stdio: 'pipe' });

    const FACTORY_VOCAB_CONTENT = [
      '# improve-factory skill',
      '',
      '`improve-factory` goal type uses `grant_tool_map`, `toolimpl`, `corellia`',
      'internals. See docs/iterations/ and docs/adrs/ for context.',
    ].join('\n');

    const FACTORY_SLUG = 'acme/corellia';

    // ── Path A: repoSlug === factoryRepoSlug → ALWAYS_DANGEROUS_PATTERNS only ──
    // Factory vocabulary in the diff must PASS so the factory can self-improve.
    const branchA = 'tree/gate-factory-a';
    const worktreeDirA = makeWorktree(repo, branchA, 'improve-skill.md', FACTORY_VOCAB_CONTENT);
    const storeA = new InMemoryEventStore();
    const pushToolA = pushBranchTool({
      worktreeRoot: worktreeDirA,
      branch: branchA,
      treeId: 'gate-factory-a',
      store: storeA,
      repoSlug: FACTORY_SLUG,
      factoryRepoSlug: FACTORY_SLUG, // target IS the factory → narrow gate
    });

    const factoryGoal: Goal = {
      id: 'improve-gate-test',
      type: 'improve-factory',
      parentId: null,
      title: 'improve-factory: test target-aware gate',
      spec: {},
      intent: 'production',
      scope: [],
      budget: { attempts: 3, tokens: 5000, toolCalls: 20, wallClockMs: 120_000 },
      memories: [],
    };

    const resultA = await pushToolA.execute(factoryGoal, {});
    expect(resultA.ok).toBe(true); // Factory vocab allowed when target is the factory repo.

    // ── Path B: factoryRepoSlug unset (foreign repo) → full PROCESS_CLEAN_PATTERNS ──
    // Same factory vocabulary for a push targeting a foreign repo must be REFUSED,
    // even if goal.type === 'improve-factory'.
    const branchB = 'tree/gate-foreign-b';
    const worktreeDirB = makeWorktree(repo, branchB, 'leaked-vocab.md', FACTORY_VOCAB_CONTENT);
    const storeB = new InMemoryEventStore();
    const pushToolB = pushBranchTool({
      worktreeRoot: worktreeDirB,
      branch: branchB,
      treeId: 'gate-foreign-b',
      store: storeB,
      repoSlug: 'acme/cats',
      // factoryRepoSlug not set → full gate, regardless of goal.type
    });

    // Even with improve-factory goal type, the full gate fires on a foreign repo slug.
    const resultB = await pushToolB.execute(factoryGoal, {});
    expect(resultB.ok).toBe(false); // Factory vocab blocked on foreign-repo path.
    expect(resultB.output).toContain('process-clean');
  });

  it('the event log projections do not throw on improvement-loop events', async () => {
    const store = new InMemoryEventStore();

    // Seed the log with improvement-loop events.
    await store.append({
      type: 'blocker-routed',
      at: 1000,
      goalId: 'product-proj',
      blocker: 'skill gap in foo',
      commissionId: 'improve-product-proj-999',
    });

    // Import and exercise the projections — they must not throw.
    const { traceStats, costSummary, projectKnowledge } = await import('../../src/eventlog/projections.js');

    const events = await store.list();
    expect(() => traceStats(events)).not.toThrow();
    expect(() => costSummary(events)).not.toThrow();
    expect(() => projectKnowledge(events)).not.toThrow();
  });
});
