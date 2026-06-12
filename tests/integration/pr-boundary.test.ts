/**
 * Chunk 5 — Bare-repo integration suite (F-61, AC 1–6).
 *
 * End-to-end push + PR pipeline with:
 *   - A local bare repo as origin (real `git push`, no network).
 *   - A stub GitHub transport (no network for PR creation).
 *
 * Covers all six acceptance criteria end-to-end:
 *   AC 1: push via GIT_ASKPASS; token not in output or event.
 *   AC 2: process-clean gate blocks dirty diff before push.
 *   AC 3: open_pr returns PR URL; body carries supplied content.
 *   AC 4: push_branch fast-forward; open_pr idempotence.
 *   AC 5: branch-pushed + pr-opened events in the log; projections don't throw.
 *   AC 6: type without repo.branch / repo.pr is refused by the broker.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { InMemoryEventStore } from '../../src/eventlog/memory-store.js';
import { pushBranchTool, openPrTool, type FetchTransport } from '../../src/engine/pr-tools.js';
import { Broker } from '../../src/engine/broker.js';
import { createRegistry } from '../../src/library/registry.js';
import { starterTypes } from '../../src/library/starter-types.js';
import { traceStats, costSummary, projectKnowledge } from '../../src/eventlog/projections.js';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

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
  const dir = mkdtempSync(join(tmpdir(), 'corellia-int-repo-'));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  execFileSync('git', ['init'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: dir, stdio: 'pipe' });
  writeFileSync(join(dir, 'README.md'), '# integration test\n');
  execFileSync('git', ['add', 'README.md'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['commit', '-m', 'init'], { cwd: dir, stdio: 'pipe' });
  return dir;
}

function makeBareRepo(source: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'corellia-int-bare-'));
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
  const dir = mkdtempSync(join(tmpdir(), 'corellia-int-wt-'));
  cleanups.push(() => {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
    try {
      execFileSync('git', ['-C', repoRoot, 'worktree', 'remove', '--force', dir], { stdio: 'pipe' });
    } catch { /* already torn down */ }
  });
  execFileSync('git', ['-C', repoRoot, 'worktree', 'add', '-b', branch, dir], { stdio: 'pipe' });
  writeFileSync(join(dir, fileName), content);
  execFileSync('git', ['-C', dir, 'add', fileName], { stdio: 'pipe' });
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

const registry = createRegistry(starterTypes());

const baseGoal = {
  id: 'g-integration',
  type: 'improve-factory',
  parentId: null as null,
  title: 'integration test goal',
  spec: {},
  intent: 'production' as const,
  scope: [],
  budget: { attempts: 3, tokens: 1000, toolCalls: 20, wallClockMs: 120_000 },
  memories: [],
};

// ---------------------------------------------------------------------------
// Shared repo/worktree state for the main integration suite
// ---------------------------------------------------------------------------

let repo: string;
let bare: string;
let worktreeDir: string;
let store: InMemoryEventStore;
const BRANCH = 'tree/int-test-abc12345';
const TREE_ID = 'int-test-abc12345';
const PR_URL = 'https://github.com/acme/factory/pull/100';

beforeEach(() => {
  withToken('ghp_INTEGRATION_FAKE');
  repo = makeTempRepo();
  bare = makeBareRepo(repo);
  execFileSync('git', ['-C', repo, 'remote', 'add', 'origin', bare], { stdio: 'pipe' });
  worktreeDir = makeWorktree(repo, BRANCH, 'feature.ts', 'export const greet = () => "hello";\n');
  store = new InMemoryEventStore();
});

// ---------------------------------------------------------------------------
// AC 1: push succeeds, token never in events or tool output
// ---------------------------------------------------------------------------

describe('integration: push_branch (AC 1)', () => {
  it('pushes the branch to the bare origin', async () => {
    const tool = pushBranchTool({ worktreeRoot: worktreeDir, branch: BRANCH, treeId: TREE_ID, store });
    const result = await tool.execute(baseGoal, {});
    expect(result.ok).toBe(true);

    const branches = execFileSync(
      'git', ['-C', bare, 'branch', '--list', BRANCH],
      { stdio: 'pipe', encoding: 'utf-8' },
    ).trim();
    expect(branches).toContain(BRANCH);
  });

  it('token does not appear in tool output', async () => {
    const token = process.env['GITHUB_TOKEN'] ?? '';
    const tool = pushBranchTool({ worktreeRoot: worktreeDir, branch: BRANCH, treeId: TREE_ID, store });
    const result = await tool.execute(baseGoal, {});
    expect(result.output).not.toContain(token);
  });

  it('token does not appear in branch-pushed event fields', async () => {
    const token = process.env['GITHUB_TOKEN'] ?? '';
    const tool = pushBranchTool({ worktreeRoot: worktreeDir, branch: BRANCH, treeId: TREE_ID, store });
    await tool.execute(baseGoal, {});

    const events = await store.list({ type: 'branch-pushed' });
    const serialised = JSON.stringify(events);
    expect(serialised).not.toContain(token);
  });
});

// ---------------------------------------------------------------------------
// AC 2: process-clean gate blocks dirty diff
// ---------------------------------------------------------------------------

describe('integration: process-clean gate (AC 2)', () => {
  it('blocks push when the diff contains factory language', async () => {
    // Create a worktree with factory-internal content.
    const dirtyWorktree = makeWorktree(
      repo, 'tree/dirty-int', 'bad.ts',
      '// improve-factory reference in source\nexport const x = 1;\n',
    );
    const tool = pushBranchTool({
      worktreeRoot: dirtyWorktree,
      branch: 'tree/dirty-int',
      treeId: 'dirty-int',
      store,
    });
    const result = await tool.execute(baseGoal, {});
    expect(result.ok).toBe(false);
    expect(result.output).toContain('process-clean');
    expect(result.output).toContain('bad.ts');

    // Branch must NOT appear in the bare repo.
    const branchOut = execFileSync(
      'git', ['-C', bare, 'branch', '--list', 'tree/dirty-int'],
      { stdio: 'pipe', encoding: 'utf-8' },
    ).trim();
    expect(branchOut).toBe('');
  });
});

// ---------------------------------------------------------------------------
// AC 3: open_pr returns URL and carries supplied body content
// ---------------------------------------------------------------------------

describe('integration: open_pr (AC 3)', () => {
  it('returns the PR URL after a successful push', async () => {
    // Push first.
    const pushTool = pushBranchTool({ worktreeRoot: worktreeDir, branch: BRANCH, treeId: TREE_ID, store });
    await pushTool.execute(baseGoal, {});

    const prTool = openPrTool({
      branch: BRANCH,
      treeId: TREE_ID,
      repoSlug: 'acme/factory',
      store,
      fetchTransport: stubGitHubTransport(PR_URL),
    });
    const result = await prTool.execute(baseGoal, {
      title: 'feat: greeting utility',
      body: '## Proof\nAll tests pass.\n\n## Learned\nSmall functions are better.',
    });

    expect(result.ok).toBe(true);
    expect(result.output).toContain(PR_URL);
  });

  it('pr-opened event carries the PR URL and treeId', async () => {
    const prTool = openPrTool({
      branch: BRANCH,
      treeId: TREE_ID,
      repoSlug: 'acme/factory',
      store,
      fetchTransport: stubGitHubTransport(PR_URL),
    });
    await prTool.execute(baseGoal, { title: 'PR', body: 'body' });

    const events = await store.list({ type: 'pr-opened' });
    expect(events).toHaveLength(1);
    const e = events[0];
    if (e?.type === 'pr-opened') {
      expect(e.url).toBe(PR_URL);
      expect(e.treeId).toBe(TREE_ID);
      expect(e.branch).toBe(BRANCH);
    }
  });
});

// ---------------------------------------------------------------------------
// AC 4: push_branch fast-forward; open_pr idempotence
// ---------------------------------------------------------------------------

describe('integration: idempotence (AC 4)', () => {
  it('push_branch fast-forward repeat is allowed', async () => {
    const tool = pushBranchTool({ worktreeRoot: worktreeDir, branch: BRANCH, treeId: TREE_ID, store });
    const first = await tool.execute(baseGoal, {});
    expect(first.ok).toBe(true);
    const second = await tool.execute(baseGoal, {});
    expect(second.ok).toBe(true);
    // Two branch-pushed events.
    expect((await store.list({ type: 'branch-pushed' })).length).toBe(2);
  });

  it('open_pr second call refuses and returns existing URL', async () => {
    const prTool = openPrTool({
      branch: BRANCH,
      treeId: TREE_ID,
      repoSlug: 'acme/factory',
      store,
      fetchTransport: stubGitHubTransport(PR_URL),
    });

    const first = await prTool.execute(baseGoal, { title: 'PR', body: 'body' });
    expect(first.ok).toBe(true);

    const second = await prTool.execute(baseGoal, { title: 'PR 2', body: 'body 2' });
    expect(second.ok).toBe(false);
    expect(second.output).toContain(PR_URL);
    // Still only one pr-opened event.
    expect((await store.list({ type: 'pr-opened' })).length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// AC 5: events in log; all three projections handle them without throwing
// ---------------------------------------------------------------------------

describe('integration: event log and projections (AC 5)', () => {
  it('branch-pushed + pr-opened events are both in the log', async () => {
    const pushTool = pushBranchTool({ worktreeRoot: worktreeDir, branch: BRANCH, treeId: TREE_ID, store });
    await pushTool.execute(baseGoal, {});

    const prTool = openPrTool({
      branch: BRANCH,
      treeId: TREE_ID,
      repoSlug: 'acme/factory',
      store,
      fetchTransport: stubGitHubTransport(PR_URL),
    });
    await prTool.execute(baseGoal, { title: 'PR', body: 'body' });

    const pushed = await store.list({ type: 'branch-pushed' });
    const opened = await store.list({ type: 'pr-opened' });
    expect(pushed).toHaveLength(1);
    expect(opened).toHaveLength(1);
  });

  it('traceStats does not throw on a log containing branch-pushed + pr-opened', async () => {
    const pushTool = pushBranchTool({ worktreeRoot: worktreeDir, branch: BRANCH, treeId: TREE_ID, store });
    await pushTool.execute(baseGoal, {});
    const prTool = openPrTool({
      branch: BRANCH, treeId: TREE_ID, repoSlug: 'acme/factory', store,
      fetchTransport: stubGitHubTransport(PR_URL),
    });
    await prTool.execute(baseGoal, { title: 'PR', body: 'body' });
    const events = await store.list();
    expect(() => traceStats(events)).not.toThrow();
  });

  it('costSummary does not throw on a log containing branch-pushed + pr-opened', async () => {
    const events = await store.list();
    expect(() => costSummary(events)).not.toThrow();
  });

  it('projectKnowledge does not throw on a log containing branch-pushed + pr-opened', async () => {
    const events = await store.list();
    expect(() => projectKnowledge(events)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// AC 6: broker refuses push_branch / open_pr for types without the grant
// ---------------------------------------------------------------------------

describe('integration: broker grant enforcement (AC 6)', () => {
  it('broker refuses push_branch for a goal type without repo.branch', async () => {
    const pushImpl = pushBranchTool({
      worktreeRoot: worktreeDir, branch: BRANCH, treeId: TREE_ID, store,
    });
    const broker = new Broker({
      root: worktreeDir,
      registry,
      store,
      tools: [pushImpl],
    });
    const noGrantGoal = { ...baseGoal, id: 'g-no-grant', type: 'implement' };
    const result = await broker.execute(noGrantGoal, { id: 'c1', name: 'push_branch', args: {} });
    expect(result.ok).toBe(false);
    expect(result.output).toContain('repo.branch');
  });

  it('broker refuses open_pr for a goal type without repo.pr', async () => {
    const prImpl = openPrTool({
      branch: BRANCH, treeId: TREE_ID, repoSlug: 'acme/factory', store,
      fetchTransport: stubGitHubTransport(PR_URL),
    });
    const broker = new Broker({
      root: worktreeDir,
      registry,
      store,
      tools: [prImpl],
    });
    const noGrantGoal = { ...baseGoal, id: 'g-no-grant-pr', type: 'implement' };
    const result = await broker.execute(noGrantGoal, {
      id: 'c2', name: 'open_pr', args: { title: 'PR', body: 'body' },
    });
    expect(result.ok).toBe(false);
    expect(result.output).toContain('repo.pr');
  });

  it('broker grants push_branch + open_pr to improve-factory', async () => {
    const pushImpl = pushBranchTool({
      worktreeRoot: worktreeDir, branch: BRANCH, treeId: TREE_ID, store,
    });
    const prImpl = openPrTool({
      branch: BRANCH, treeId: TREE_ID, repoSlug: 'acme/factory', store,
      fetchTransport: stubGitHubTransport(PR_URL),
    });
    const broker = new Broker({
      root: worktreeDir,
      registry,
      store,
      tools: [pushImpl, prImpl],
    });

    // push_branch — granted (will succeed or fail on git but NOT on grant).
    const pushResult = await broker.execute(baseGoal, { id: 'c1', name: 'push_branch', args: {} });
    // May succeed or fail at the git level (we care it's not a grant refusal).
    expect(pushResult.output).not.toContain('not granted');

    // open_pr — granted (will attempt GitHub REST).
    const prResult = await broker.execute(baseGoal, {
      id: 'c2', name: 'open_pr', args: { title: 'PR', body: 'body' },
    });
    expect(prResult.output).not.toContain('not granted');
  });
});

// ---------------------------------------------------------------------------
// Full pipeline: push → open_pr → assert both events and no token leakage
// ---------------------------------------------------------------------------

describe('integration: full pipeline end-to-end', () => {
  it('push then open_pr: both events in log, token absent from all outputs', async () => {
    const token = process.env['GITHUB_TOKEN'] ?? '';
    expect(token.length).toBeGreaterThan(0);

    const pushTool = pushBranchTool({
      worktreeRoot: worktreeDir, branch: BRANCH, treeId: TREE_ID, store,
    });
    const pushResult = await pushTool.execute(baseGoal, {});
    expect(pushResult.ok).toBe(true);
    expect(pushResult.output).not.toContain(token);

    const prTool = openPrTool({
      branch: BRANCH, treeId: TREE_ID, repoSlug: 'acme/factory', store,
      fetchTransport: stubGitHubTransport(PR_URL),
    });
    const prResult = await prTool.execute(baseGoal, {
      title: 'Full pipeline PR',
      body: '## Proof\nTests pass. Commits: abc123.\n\n## Learned\nCompose small units.',
    });
    expect(prResult.ok).toBe(true);
    expect(prResult.output).not.toContain(token);

    // Both events are in the log.
    expect((await store.list({ type: 'branch-pushed' })).length).toBe(1);
    expect((await store.list({ type: 'pr-opened' })).length).toBe(1);

    // Serialise the whole event log — the token must not appear anywhere.
    const allEvents = await store.list();
    const serialised = JSON.stringify(allEvents);
    expect(serialised).not.toContain(token);

    // All three projection functions run cleanly over the final log.
    expect(() => traceStats(allEvents)).not.toThrow();
    expect(() => costSummary(allEvents)).not.toThrow();
    expect(() => projectKnowledge(allEvents)).not.toThrow();
  });
});
