/**
 * Chunk 4 — open_pr tests (F-61, AC 3, AC 4 PR half).
 *
 * Tests `openPrTool` via the injectable fetch transport — no network calls.
 *   - Success: PR URL returned, pr-opened event appended.
 *   - Idempotence: a second call refuses and returns the existing URL.
 *   - Missing title is refused.
 *   - Missing GITHUB_TOKEN is refused.
 *   - GitHub API error (4xx) is refused with the error message.
 *   - Fetch transport failure (network error) is refused gracefully.
 *   - The Authorization header carries the token (and only the token).
 *   - No merge/approve/close capability exists (structural — no tool named that).
 *   - extractRepoSlug correctly parses HTTPS and SSH GitHub remote URLs.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { InMemoryEventStore } from '../../src/eventlog/memory-store.js';
import { openPrTool, extractRepoSlug, type FetchTransport, type FetchResponse } from '../../src/engine/pr-tools.js';
import { GRANT_TOOL_MAP } from '../../src/contract/tool.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeGoal(overrides: Partial<{ id: string; type: string }> = {}) {
  return {
    id: overrides.id ?? 'g1',
    type: overrides.type ?? 'improve-factory',
    parentId: null as null,
    title: 'test PR goal',
    spec: {},
    intent: 'production' as const,
    scope: [],
    budget: { attempts: 3, tokens: 1000, toolCalls: 10, wallClockMs: 60000 },
    memories: [],
  };
}

/**
 * A stub FetchTransport that returns a successful GitHub PR creation response
 * with the supplied URL.
 */
function successTransport(prUrl = 'https://github.com/acme/factory/pull/42'): FetchTransport {
  return async (_url, _init) => ({
    ok: true,
    status: 201,
    json: async () => ({ html_url: prUrl, number: 42 }),
  });
}

/**
 * A stub FetchTransport that returns an error response.
 */
function errorTransport(status: number, message: string): FetchTransport {
  return async (_url, _init) => ({
    ok: false,
    status,
    json: async () => ({ message }),
  });
}

/**
 * A stub FetchTransport that throws (simulates a network failure).
 */
function throwingTransport(msg = 'network error'): FetchTransport {
  return async (_url, _init) => {
    throw new Error(msg);
  };
}

/** Capture headers sent to the transport. */
function capturingTransport(
  prUrl = 'https://github.com/acme/factory/pull/1',
): { transport: FetchTransport; captured: { url: string; init: RequestInit }[] } {
  const captured: { url: string; init: RequestInit }[] = [];
  const transport: FetchTransport = async (url, init) => {
    captured.push({ url, init });
    return { ok: true, status: 201, json: async () => ({ html_url: prUrl }) };
  };
  return { transport, captured };
}

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

function withoutToken(): void {
  const original = process.env['GITHUB_TOKEN'];
  delete process.env['GITHUB_TOKEN'];
  cleanups.push(() => {
    if (original !== undefined) process.env['GITHUB_TOKEN'] = original;
  });
}

// ---------------------------------------------------------------------------
// extractRepoSlug — HTTPS and SSH URL forms
// ---------------------------------------------------------------------------

describe('extractRepoSlug', () => {
  it('parses an HTTPS URL with .git suffix', () => {
    expect(extractRepoSlug('https://github.com/acme/factory.git')).toBe('acme/factory');
  });

  it('parses an HTTPS URL without .git suffix', () => {
    expect(extractRepoSlug('https://github.com/acme/factory')).toBe('acme/factory');
  });

  it('parses an SSH URL with .git suffix', () => {
    expect(extractRepoSlug('git@github.com:acme/factory.git')).toBe('acme/factory');
  });

  it('parses an SSH URL without .git suffix', () => {
    expect(extractRepoSlug('git@github.com:acme/factory')).toBe('acme/factory');
  });

  it('returns null for a non-GitHub URL', () => {
    expect(extractRepoSlug('https://gitlab.com/acme/factory.git')).toBeNull();
  });

  it('returns null for a bare local path', () => {
    expect(extractRepoSlug('/tmp/bare-repo')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Successful PR creation (AC 3)
// ---------------------------------------------------------------------------

describe('open_pr — success', () => {
  it('returns ok:true with the PR URL', async () => {
    withToken('ghp_FAKETOKEN');

    const store = new InMemoryEventStore();
    const prUrl = 'https://github.com/acme/factory/pull/7';
    const tool = openPrTool({
      branch: 'tree/test-abc',
      treeId: 'test-abc',
      repoSlug: 'acme/factory',
      store,
      fetchTransport: successTransport(prUrl),
    });

    const result = await tool.execute(makeGoal(), {
      title: 'feat: add greeting',
      body: 'Proof: all tests pass. Learned: small functions are better.',
    });

    expect(result.ok).toBe(true);
    expect(result.output).toContain(prUrl);
  });

  it('appends a pr-opened event with the URL and treeId', async () => {
    withToken('ghp_FAKETOKEN');

    const store = new InMemoryEventStore();
    const prUrl = 'https://github.com/acme/factory/pull/8';
    const treeId = 'tree-id-xyz';
    const branch = `tree/${treeId}`;

    const tool = openPrTool({
      branch,
      treeId,
      repoSlug: 'acme/factory',
      store,
      fetchTransport: successTransport(prUrl),
    });

    const goal = makeGoal({ id: 'g-pr' });
    await tool.execute(goal, {
      title: 'feat: new thing',
      body: 'body text',
    });

    const events = await store.list({ type: 'pr-opened' });
    expect(events).toHaveLength(1);
    const e = events[0];
    expect(e?.type).toBe('pr-opened');
    if (e?.type === 'pr-opened') {
      expect(e.url).toBe(prUrl);
      expect(e.treeId).toBe(treeId);
      expect(e.branch).toBe(branch);
      expect(e.goalId).toBe(goal.id);
    }
  });

  it('uses the default base "main" when base is not supplied', async () => {
    withToken('ghp_FAKETOKEN');

    const { transport, captured } = capturingTransport();
    const store = new InMemoryEventStore();
    const tool = openPrTool({
      branch: 'tree/abc',
      treeId: 'abc',
      repoSlug: 'acme/factory',
      store,
      fetchTransport: transport,
    });

    await tool.execute(makeGoal(), { title: 'PR', body: 'body' });

    expect(captured).toHaveLength(1);
    const body = JSON.parse(captured[0]!.init.body as string) as Record<string, unknown>;
    expect(body['base']).toBe('main');
  });

  it('passes through a custom base branch', async () => {
    withToken('ghp_FAKETOKEN');

    const { transport, captured } = capturingTransport();
    const store = new InMemoryEventStore();
    const tool = openPrTool({
      branch: 'tree/abc',
      treeId: 'abc',
      repoSlug: 'acme/factory',
      store,
      fetchTransport: transport,
    });

    await tool.execute(makeGoal(), { title: 'PR', body: 'body', base: 'develop' });

    const body = JSON.parse(captured[0]!.init.body as string) as Record<string, unknown>;
    expect(body['base']).toBe('develop');
  });

  it('sends Authorization header with the token (Bearer scheme)', async () => {
    const token = 'ghp_SPECIFICTOKEN_XYZ';
    withToken(token);

    const { transport, captured } = capturingTransport();
    const store = new InMemoryEventStore();
    const tool = openPrTool({
      branch: 'tree/abc',
      treeId: 'abc',
      repoSlug: 'acme/factory',
      store,
      fetchTransport: transport,
    });

    await tool.execute(makeGoal(), { title: 'PR', body: 'body' });

    const headers = captured[0]!.init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe(`Bearer ${token}`);
  });

  it('constructs the correct GitHub REST API URL', async () => {
    withToken('ghp_FAKETOKEN');

    const { transport, captured } = capturingTransport();
    const store = new InMemoryEventStore();
    const tool = openPrTool({
      branch: 'tree/abc',
      treeId: 'abc',
      repoSlug: 'myorg/myrepo',
      store,
      fetchTransport: transport,
    });

    await tool.execute(makeGoal(), { title: 'PR', body: 'body' });

    expect(captured[0]!.url).toBe('https://api.github.com/repos/myorg/myrepo/pulls');
  });
});

// ---------------------------------------------------------------------------
// Idempotence: second call refuses (AC 4 PR half)
// ---------------------------------------------------------------------------

describe('open_pr — idempotence', () => {
  it('refuses a second call for the same treeId and returns the existing URL', async () => {
    withToken('ghp_FAKETOKEN');

    const store = new InMemoryEventStore();
    const prUrl = 'https://github.com/acme/factory/pull/10';
    const treeId = 'idempotent-tree';

    const tool = openPrTool({
      branch: `tree/${treeId}`,
      treeId,
      repoSlug: 'acme/factory',
      store,
      fetchTransport: successTransport(prUrl),
    });

    const goal = makeGoal();

    // First call — should succeed.
    const first = await tool.execute(goal, { title: 'PR', body: 'body' });
    expect(first.ok).toBe(true);

    // Second call — same treeId — should refuse.
    const second = await tool.execute(goal, { title: 'PR again', body: 'body 2' });
    expect(second.ok).toBe(false);
    // The existing PR URL must appear in the refusal message.
    expect(second.output).toContain(prUrl);
  });

  it('does not append a second pr-opened event on a refused idempotent call', async () => {
    withToken('ghp_FAKETOKEN');

    const store = new InMemoryEventStore();
    const treeId = 'idempotent-tree-2';

    const tool = openPrTool({
      branch: `tree/${treeId}`,
      treeId,
      repoSlug: 'acme/factory',
      store,
      fetchTransport: successTransport('https://github.com/acme/factory/pull/99'),
    });

    const goal = makeGoal();
    await tool.execute(goal, { title: 'PR', body: 'body' });
    await tool.execute(goal, { title: 'PR 2', body: 'body 2' });

    const events = await store.list({ type: 'pr-opened' });
    expect(events).toHaveLength(1);
  });

  it('idempotence guard reads from the event log — works across tool instances', async () => {
    withToken('ghp_FAKETOKEN');

    const store = new InMemoryEventStore();
    const treeId = 'shared-store-tree';
    const prUrl = 'https://github.com/acme/factory/pull/50';

    // First tool instance opens the PR.
    const tool1 = openPrTool({
      branch: `tree/${treeId}`,
      treeId,
      repoSlug: 'acme/factory',
      store,
      fetchTransport: successTransport(prUrl),
    });
    await tool1.execute(makeGoal({ id: 'g-first' }), { title: 'PR', body: 'body' });

    // A SECOND tool instance for the same treeId (same store) should refuse.
    const tool2 = openPrTool({
      branch: `tree/${treeId}`,
      treeId,
      repoSlug: 'acme/factory',
      store,
      fetchTransport: successTransport('https://github.com/acme/factory/pull/999'),
    });
    const result = await tool2.execute(makeGoal({ id: 'g-second' }), { title: 'PR 2', body: 'body' });
    expect(result.ok).toBe(false);
    expect(result.output).toContain(prUrl);
  });
});

// ---------------------------------------------------------------------------
// Validation: missing title / missing token
// ---------------------------------------------------------------------------

describe('open_pr — validation', () => {
  it('refuses when title is empty', async () => {
    withToken('ghp_FAKETOKEN');

    const store = new InMemoryEventStore();
    const tool = openPrTool({
      branch: 'tree/abc',
      treeId: 'abc',
      repoSlug: 'acme/factory',
      store,
      fetchTransport: successTransport(),
    });

    const result = await tool.execute(makeGoal(), { title: '', body: 'body' });
    expect(result.ok).toBe(false);
    expect(result.output).toContain('title');
  });

  it('refuses when title is missing', async () => {
    withToken('ghp_FAKETOKEN');

    const store = new InMemoryEventStore();
    const tool = openPrTool({
      branch: 'tree/abc',
      treeId: 'abc',
      repoSlug: 'acme/factory',
      store,
      fetchTransport: successTransport(),
    });

    const result = await tool.execute(makeGoal(), { body: 'body only' });
    expect(result.ok).toBe(false);
    expect(result.output).toContain('title');
  });

  it('refuses when GITHUB_TOKEN is absent', async () => {
    withoutToken();

    const store = new InMemoryEventStore();
    const tool = openPrTool({
      branch: 'tree/abc',
      treeId: 'abc',
      repoSlug: 'acme/factory',
      store,
      fetchTransport: successTransport(),
    });

    const result = await tool.execute(makeGoal(), { title: 'PR', body: 'body' });
    expect(result.ok).toBe(false);
    expect(result.output).toContain('GITHUB_TOKEN');
  });
});

// ---------------------------------------------------------------------------
// GitHub API error handling
// ---------------------------------------------------------------------------

describe('open_pr — GitHub API error handling', () => {
  it('returns ok:false when GitHub returns 422 Unprocessable Entity', async () => {
    withToken('ghp_FAKETOKEN');

    const store = new InMemoryEventStore();
    const tool = openPrTool({
      branch: 'tree/abc',
      treeId: 'abc',
      repoSlug: 'acme/factory',
      store,
      fetchTransport: errorTransport(422, 'Validation Failed'),
    });

    const result = await tool.execute(makeGoal(), { title: 'PR', body: 'body' });
    expect(result.ok).toBe(false);
    expect(result.output).toContain('Validation Failed');
  });

  it('returns ok:false when GitHub returns 404 Not Found', async () => {
    withToken('ghp_FAKETOKEN');

    const store = new InMemoryEventStore();
    const tool = openPrTool({
      branch: 'tree/abc',
      treeId: 'abc',
      repoSlug: 'nonexistent/repo',
      store,
      fetchTransport: errorTransport(404, 'Not Found'),
    });

    const result = await tool.execute(makeGoal(), { title: 'PR', body: 'body' });
    expect(result.ok).toBe(false);
    expect(result.output).toContain('Not Found');
  });

  it('does not append pr-opened event on API error', async () => {
    withToken('ghp_FAKETOKEN');

    const store = new InMemoryEventStore();
    const tool = openPrTool({
      branch: 'tree/abc',
      treeId: 'abc',
      repoSlug: 'acme/factory',
      store,
      fetchTransport: errorTransport(500, 'Internal Server Error'),
    });

    await tool.execute(makeGoal(), { title: 'PR', body: 'body' });
    const events = await store.list({ type: 'pr-opened' });
    expect(events).toHaveLength(0);
  });

  it('handles network / transport failure gracefully', async () => {
    withToken('ghp_FAKETOKEN');

    const store = new InMemoryEventStore();
    const tool = openPrTool({
      branch: 'tree/abc',
      treeId: 'abc',
      repoSlug: 'acme/factory',
      store,
      fetchTransport: throwingTransport('ECONNREFUSED'),
    });

    const result = await tool.execute(makeGoal(), { title: 'PR', body: 'body' });
    expect(result.ok).toBe(false);
    expect(result.output).toContain('ECONNREFUSED');
  });
});

// ---------------------------------------------------------------------------
// No merge/approve/close capability (AC 6, R13 structural guard)
// ---------------------------------------------------------------------------

describe('open_pr — no merge/approve/close capability', () => {
  it('GRANT_TOOL_MAP does not contain merge_pr', () => {
    expect(Object.keys(GRANT_TOOL_MAP)).not.toContain('merge_pr');
  });

  it('GRANT_TOOL_MAP does not contain approve_pr', () => {
    expect(Object.keys(GRANT_TOOL_MAP)).not.toContain('approve_pr');
  });

  it('GRANT_TOOL_MAP does not contain close_pr', () => {
    expect(Object.keys(GRANT_TOOL_MAP)).not.toContain('close_pr');
  });

  it('openPrTool def name is open_pr (not merge/approve/close)', () => {
    const store = new InMemoryEventStore();
    const tool = openPrTool({
      branch: 'tree/abc',
      treeId: 'abc',
      repoSlug: 'acme/factory',
      store,
      fetchTransport: successTransport(),
    });
    expect(tool.def.name).toBe('open_pr');
  });
});
