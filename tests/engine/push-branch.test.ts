/**
 * Chunk 3 — push_branch tests (F-61, AC 1, AC 4 push half).
 *
 * Tests the `push_branch` ToolImpl:
 *   - Real `git push` against a local bare-repo origin (no network).
 *   - GIT_ASKPASS: the token is passed via askpass helper, never in argv.
 *   - Process-clean gate blocks a dirty diff before push.
 *   - A repeat push (fast-forward) is allowed.
 *   - Missing GITHUB_TOKEN is refused gracefully.
 *   - Missing origin remote is refused gracefully.
 *   - Success appends a branch-pushed event.
 *
 * Environment: GITHUB_TOKEN is set in the test's process.env for the duration
 * of each test that requires it, then restored.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { InMemoryEventStore } from '../../src/eventlog/memory-store.js';
import { pushBranchTool } from '../../src/engine/pr-tools.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

/**
 * Create a temp git repo with an initial commit and configure user identity.
 * Returns the repo path.
 */
function makeTempRepo(name = 'repo'): string {
  const dir = mkdtempSync(join(tmpdir(), `corellia-push-${name}-`));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  execFileSync('git', ['init'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: dir, stdio: 'pipe' });
  writeFileSync(join(dir, 'README.md'), '# test\n');
  execFileSync('git', ['add', 'README.md'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['commit', '-m', 'init'], { cwd: dir, stdio: 'pipe' });
  return dir;
}

/**
 * Create a bare repo (acts as the remote origin). Returns its path.
 * The bare repo is populated from `sourceRepo` so it has the same HEAD.
 */
function makeBareRepo(sourceRepo: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'corellia-push-bare-'));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  execFileSync('git', ['clone', '--bare', sourceRepo, dir], { stdio: 'pipe' });
  return dir;
}

/**
 * Create a worktree of `repoRoot` on branch `branch`, with an initial file
 * committed so the branch diverges from main.
 */
function makeWorktreeWithBranch(
  repoRoot: string,
  branch: string,
  worktreeDir: string,
  fileName: string,
  content: string,
): void {
  execFileSync('git', ['-C', repoRoot, 'worktree', 'add', '-b', branch, worktreeDir], { stdio: 'pipe' });
  cleanups.push(() => {
    try {
      execFileSync('git', ['-C', repoRoot, 'worktree', 'remove', '--force', worktreeDir], { stdio: 'pipe' });
    } catch { /* already gone */ }
  });
  writeFileSync(join(worktreeDir, fileName), content);
  execFileSync('git', ['-C', worktreeDir, 'add', fileName], { stdio: 'pipe' });
  execFileSync('git', ['-C', worktreeDir, 'commit', '-m', `add ${fileName}`], { stdio: 'pipe' });
}

/** Override GITHUB_TOKEN for the duration of the test, restore on teardown. */
function withToken(token: string): void {
  const original = process.env['GITHUB_TOKEN'];
  process.env['GITHUB_TOKEN'] = token;
  cleanups.push(() => {
    if (original === undefined) {
      delete process.env['GITHUB_TOKEN'];
    } else {
      process.env['GITHUB_TOKEN'] = original;
    }
  });
}

/** Remove GITHUB_TOKEN for the duration of the test. */
function withoutToken(): void {
  const original = process.env['GITHUB_TOKEN'];
  delete process.env['GITHUB_TOKEN'];
  cleanups.push(() => {
    if (original !== undefined) process.env['GITHUB_TOKEN'] = original;
  });
}

// ---------------------------------------------------------------------------
// Token never in output — unit-level check (AC 1)
// ---------------------------------------------------------------------------

describe('push_branch — token never in output', () => {
  it('the ToolImpl output does not contain the GITHUB_TOKEN value', async () => {
    // Use a distinguishable fake token so we can search the output.
    const fakeToken = 'ghp_FAKESECRETTOKEN99999999999';
    withToken(fakeToken);

    const repo = makeTempRepo('token-check');
    const bare = makeBareRepo(repo);
    const worktreeDir = mkdtempSync(join(tmpdir(), 'corellia-push-wt-'));
    cleanups.push(() => rmSync(worktreeDir, { recursive: true, force: true }));
    const branch = 'tree/test-token';

    makeWorktreeWithBranch(repo, branch, worktreeDir, 'feature.ts', 'export const x = 1;\n');

    // Wire origin → bare repo.
    execFileSync('git', ['-C', repo, 'remote', 'add', 'origin', bare], { stdio: 'pipe' });

    const store = new InMemoryEventStore();
    const tool = pushBranchTool({ worktreeRoot: worktreeDir, branch, treeId: 'test-token', store });

    const goal = {
      id: 'g1',
      type: 'improve-factory',
      parentId: null as null,
      title: 'push test',
      spec: {},
      intent: 'production' as const,
      scope: [],
      budget: { attempts: 3, tokens: 1000, toolCalls: 10, wallClockMs: 60000 },
      memories: [],
    };

    const result = await tool.execute(goal, {});

    // Token must NEVER appear in the output string.
    expect(result.output).not.toContain(fakeToken);
    // Branch push succeeded or failed — we just care the token is not leaked.
    // (The push may fail because the bare repo doesn't know the branch — that's ok here.)
  });
});

// ---------------------------------------------------------------------------
// Missing GITHUB_TOKEN (AC 1)
// ---------------------------------------------------------------------------

describe('push_branch — missing GITHUB_TOKEN', () => {
  it('returns ok:false with a helpful message when token is absent', async () => {
    withoutToken();

    const store = new InMemoryEventStore();
    const tool = pushBranchTool({
      worktreeRoot: '/tmp/irrelevant',
      branch: 'tree/test',
      treeId: 'test',
      store,
    });

    const goal = {
      id: 'g1',
      type: 'improve-factory',
      parentId: null as null,
      title: 't',
      spec: {},
      intent: 'production' as const,
      scope: [],
      budget: { attempts: 3, tokens: 1000, toolCalls: 10, wallClockMs: 60000 },
      memories: [],
    };

    const result = await tool.execute(goal, {});
    expect(result.ok).toBe(false);
    expect(result.output).toContain('GITHUB_TOKEN');
  });

  it('does not append branch-pushed event when token is absent', async () => {
    withoutToken();

    const store = new InMemoryEventStore();
    const tool = pushBranchTool({
      worktreeRoot: '/tmp/irrelevant',
      branch: 'tree/test',
      treeId: 'test',
      store,
    });

    const goal = {
      id: 'g1',
      type: 'improve-factory',
      parentId: null as null,
      title: 't',
      spec: {},
      intent: 'production' as const,
      scope: [],
      budget: { attempts: 3, tokens: 1000, toolCalls: 10, wallClockMs: 60000 },
      memories: [],
    };

    await tool.execute(goal, {});
    const events = await store.list({ type: 'branch-pushed' });
    expect(events).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Missing origin remote
// ---------------------------------------------------------------------------

describe('push_branch — missing origin remote', () => {
  it('returns ok:false when origin is not configured', async () => {
    withToken('ghp_FAKE');

    const repo = makeTempRepo('no-origin');
    const worktreeDir = mkdtempSync(join(tmpdir(), 'corellia-push-wt-no-origin-'));
    cleanups.push(() => rmSync(worktreeDir, { recursive: true, force: true }));
    const branch = 'tree/no-origin';

    makeWorktreeWithBranch(repo, branch, worktreeDir, 'f.ts', 'export {};\n');
    // Do NOT add an origin remote.

    const store = new InMemoryEventStore();
    const tool = pushBranchTool({ worktreeRoot: worktreeDir, branch, treeId: 'no-origin', store });

    const goal = {
      id: 'g1',
      type: 'improve-factory',
      parentId: null as null,
      title: 't',
      spec: {},
      intent: 'production' as const,
      scope: [],
      budget: { attempts: 3, tokens: 1000, toolCalls: 10, wallClockMs: 60000 },
      memories: [],
    };

    const result = await tool.execute(goal, {});
    expect(result.ok).toBe(false);
    expect(result.output).toContain('origin');
  });
});

// ---------------------------------------------------------------------------
// Process-clean gate blocks push (AC 2)
// ---------------------------------------------------------------------------

describe('push_branch — process-clean gate', () => {
  it('refuses when the diff contains factory-internal content', async () => {
    withToken('ghp_FAKE');

    const repo = makeTempRepo('dirty-diff');
    const bare = makeBareRepo(repo);
    execFileSync('git', ['-C', repo, 'remote', 'add', 'origin', bare], { stdio: 'pipe' });

    const worktreeDir = mkdtempSync(join(tmpdir(), 'corellia-push-wt-dirty-'));
    cleanups.push(() => rmSync(worktreeDir, { recursive: true, force: true }));
    const branch = 'tree/dirty-diff';

    // Commit a file with factory-internal content.
    makeWorktreeWithBranch(
      repo, branch, worktreeDir,
      'bad.ts',
      '// This references tree/ which is factory-internal\nexport const x = 1;\n',
    );

    const store = new InMemoryEventStore();
    // No factoryRepoSlug → full gate applies (tree/ is in ALWAYS_DANGEROUS regardless).
    const tool = pushBranchTool({ worktreeRoot: worktreeDir, branch, treeId: 'dirty-diff', store });

    const goal = {
      id: 'g1',
      type: 'improve-factory',
      parentId: null as null,
      title: 't',
      spec: {},
      intent: 'production' as const,
      scope: [],
      budget: { attempts: 3, tokens: 1000, toolCalls: 10, wallClockMs: 60000 },
      memories: [],
    };

    const result = await tool.execute(goal, {});
    expect(result.ok).toBe(false);
    expect(result.output).toContain('process-clean');
    // Offending location must name the file.
    expect(result.output).toContain('bad.ts');
  });

  it('does not append branch-pushed event when process-clean gate fires', async () => {
    withToken('ghp_FAKE');

    const repo = makeTempRepo('dirty-evt');
    const bare = makeBareRepo(repo);
    execFileSync('git', ['-C', repo, 'remote', 'add', 'origin', bare], { stdio: 'pipe' });

    const worktreeDir = mkdtempSync(join(tmpdir(), 'corellia-push-wt-dirty-evt-'));
    cleanups.push(() => rmSync(worktreeDir, { recursive: true, force: true }));
    const branch = 'tree/dirty-evt';

    makeWorktreeWithBranch(
      repo, branch, worktreeDir,
      'bad2.ts',
      '// goalid: g-12345\n',
    );

    const store = new InMemoryEventStore();
    const tool = pushBranchTool({ worktreeRoot: worktreeDir, branch, treeId: 'dirty-evt', store });

    // Use a foreign-repo goal type so the full PROCESS_CLEAN_PATTERNS set applies
    // (goalid is in FOREIGN_REPO_ONLY_PATTERNS and is blocked on foreign-repo pushes).
    const goal = {
      id: 'g1',
      type: 'implement',
      parentId: null as null,
      title: 't',
      spec: {},
      intent: 'production' as const,
      scope: [],
      budget: { attempts: 3, tokens: 1000, toolCalls: 10, wallClockMs: 60000 },
      memories: [],
    };

    await tool.execute(goal, {});
    const events = await store.list({ type: 'branch-pushed' });
    expect(events).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Real git push against a local bare repo — success + idempotence (AC 1, AC 4)
// ---------------------------------------------------------------------------

describe('push_branch — real git push against local bare repo', () => {
  it('pushes the branch to the bare repo and appends branch-pushed event', async () => {
    // Use a syntactically valid but never-network-touched fake token.
    // The local bare repo doesn't enforce auth, so git won't invoke askpass.
    withToken('ghp_LOCAL_FAKE_99');

    const repo = makeTempRepo('push-success');
    const bare = makeBareRepo(repo);
    execFileSync('git', ['-C', repo, 'remote', 'add', 'origin', bare], { stdio: 'pipe' });

    const worktreeDir = mkdtempSync(join(tmpdir(), 'corellia-push-wt-ok-'));
    cleanups.push(() => rmSync(worktreeDir, { recursive: true, force: true }));
    const branch = 'tree/push-success-abc12345';

    makeWorktreeWithBranch(repo, branch, worktreeDir, 'feature.ts', 'export const greeting = "hello";\n');

    const store = new InMemoryEventStore();
    const treeId = 'push-success-abc12345';
    const tool = pushBranchTool({ worktreeRoot: worktreeDir, branch, treeId, store });

    const goal = {
      id: 'g-push',
      type: 'improve-factory',
      parentId: null as null,
      title: 'push test',
      spec: {},
      intent: 'production' as const,
      scope: [],
      budget: { attempts: 3, tokens: 1000, toolCalls: 10, wallClockMs: 60000 },
      memories: [],
    };

    const result = await tool.execute(goal, {});
    expect(result.ok).toBe(true);
    expect(result.output).toContain(branch);

    // Verify branch exists in the bare repo.
    const bareBranches = execFileSync(
      'git',
      ['-C', bare, 'branch', '--list', branch],
      { stdio: 'pipe', encoding: 'utf-8' },
    ).trim();
    expect(bareBranches).toContain(branch);

    // Verify branch-pushed event was appended.
    const events = await store.list({ type: 'branch-pushed' });
    expect(events).toHaveLength(1);
    const e = events[0];
    expect(e?.type).toBe('branch-pushed');
    if (e?.type === 'branch-pushed') {
      expect(e.treeId).toBe(treeId);
      expect(e.branch).toBe(branch);
      expect(e.goalId).toBe(goal.id);
    }
  });

  it('fast-forward repeat push is allowed (idempotence, AC 4)', async () => {
    withToken('ghp_LOCAL_FAKE_FF');

    const repo = makeTempRepo('push-ff');
    const bare = makeBareRepo(repo);
    execFileSync('git', ['-C', repo, 'remote', 'add', 'origin', bare], { stdio: 'pipe' });

    const worktreeDir = mkdtempSync(join(tmpdir(), 'corellia-push-wt-ff-'));
    cleanups.push(() => rmSync(worktreeDir, { recursive: true, force: true }));
    const branch = 'tree/push-ff-abc12345';

    makeWorktreeWithBranch(repo, branch, worktreeDir, 'ff.ts', 'export const v = 1;\n');

    const store = new InMemoryEventStore();
    const treeId = 'push-ff-abc12345';
    const tool = pushBranchTool({ worktreeRoot: worktreeDir, branch, treeId, store });

    const goal = {
      id: 'g-ff',
      type: 'improve-factory',
      parentId: null as null,
      title: 'ff test',
      spec: {},
      intent: 'production' as const,
      scope: [],
      budget: { attempts: 3, tokens: 1000, toolCalls: 10, wallClockMs: 60000 },
      memories: [],
    };

    // First push — should succeed.
    const first = await tool.execute(goal, {});
    expect(first.ok).toBe(true);

    // Second push — same commits, fast-forward — should also succeed.
    const second = await tool.execute(goal, {});
    expect(second.ok).toBe(true);

    // Two branch-pushed events should be appended.
    const events = await store.list({ type: 'branch-pushed' });
    expect(events).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Configurable push remote (AC-4: cats' origin is GitLab; push to `github` mirror)
// ---------------------------------------------------------------------------

describe('push_branch — configurable remote (non-origin)', () => {
  it('pushes to the named remote, not origin', async () => {
    withToken('ghp_LOCAL_FAKE_REMOTE');

    const repo = makeTempRepo('push-remote');
    // Two bare repos: a decoy `origin` and the real PR target `github`.
    const origin = makeBareRepo(repo);
    const github = makeBareRepo(repo);
    execFileSync('git', ['-C', repo, 'remote', 'add', 'origin', origin], { stdio: 'pipe' });
    execFileSync('git', ['-C', repo, 'remote', 'add', 'github', github], { stdio: 'pipe' });

    const worktreeDir = mkdtempSync(join(tmpdir(), 'corellia-push-wt-remote-'));
    cleanups.push(() => rmSync(worktreeDir, { recursive: true, force: true }));
    const branch = 'tree/push-remote-abc12345';

    makeWorktreeWithBranch(repo, branch, worktreeDir, 'feature.ts', 'export const v = 1;\n');

    const store = new InMemoryEventStore();
    const treeId = 'push-remote-abc12345';
    // Bind the `github` remote — origin must be left untouched.
    const tool = pushBranchTool({ worktreeRoot: worktreeDir, branch, treeId, store, remote: 'github' });

    const goal = {
      id: 'g-remote',
      type: 'improve-factory',
      parentId: null as null,
      title: 'remote test',
      spec: {},
      intent: 'production' as const,
      scope: [],
      budget: { attempts: 3, tokens: 1000, toolCalls: 10, wallClockMs: 60000 },
      memories: [],
    };

    const result = await tool.execute(goal, {});
    expect(result.ok).toBe(true);

    // The branch must exist in the `github` bare repo...
    const githubBranches = execFileSync(
      'git', ['-C', github, 'branch', '--list', branch], { stdio: 'pipe', encoding: 'utf-8' },
    ).trim();
    expect(githubBranches).toContain(branch);

    // ...and must NOT exist in the decoy `origin` bare repo.
    const originBranches = execFileSync(
      'git', ['-C', origin, 'branch', '--list', branch], { stdio: 'pipe', encoding: 'utf-8' },
    ).trim();
    expect(originBranches).toBe('');

    // The branch-pushed event records the github remote's URL, not origin's.
    const events = await store.list({ type: 'branch-pushed' });
    expect(events).toHaveLength(1);
    const e = events[0];
    if (e?.type === 'branch-pushed') {
      expect(e.remote).toBe(github);
    }
  });

  it('refuses gracefully when the named remote is not configured', async () => {
    withToken('ghp_FAKE');

    const repo = makeTempRepo('push-remote-missing');
    const origin = makeBareRepo(repo);
    execFileSync('git', ['-C', repo, 'remote', 'add', 'origin', origin], { stdio: 'pipe' });

    const worktreeDir = mkdtempSync(join(tmpdir(), 'corellia-push-wt-remote-missing-'));
    cleanups.push(() => rmSync(worktreeDir, { recursive: true, force: true }));
    const branch = 'tree/push-remote-missing';
    makeWorktreeWithBranch(repo, branch, worktreeDir, 'f.ts', 'export {};\n');

    const store = new InMemoryEventStore();
    // Bind a remote that does not exist.
    const tool = pushBranchTool({ worktreeRoot: worktreeDir, branch, treeId: 'm', store, remote: 'github' });

    const goal = {
      id: 'g1', type: 'improve-factory', parentId: null as null, title: 't', spec: {},
      intent: 'production' as const, scope: [],
      budget: { attempts: 3, tokens: 1000, toolCalls: 10, wallClockMs: 60000 }, memories: [],
    };

    const result = await tool.execute(goal, {});
    expect(result.ok).toBe(false);
    expect(result.output).toContain('github');
  });
});
