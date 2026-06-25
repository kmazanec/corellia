/**
 * Tests for the file_issue brokered write tool (ADR-034): OKF-conformant issue
 * file creation, frontmatter validation, slug safety, no-overwrite, and the
 * docs/issues/index.md catalog-row append. Bound to a per-test sandbox root.
 *
 * (The factory built this tool in build run live-self-bd479522 but its leaf
 * emitted an empty artifact and blocked before writing a test; this is the
 * verify-on-read test added when the tool was folded onto main.)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, mkdir, rm, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileIssueTool } from '../../src/engine/issue-tools.js';
import type { Goal } from '../../src/contract/goal.js';

function makeGoal(overrides: Partial<Goal> = {}): Goal {
  return {
    id: 'g1',
    type: 'investigate',
    parentId: null,
    title: 'test goal',
    spec: {},
    intent: 'production',
    scope: ['docs/issues/'],
    budget: { attempts: 3, tokens: 1000, toolCalls: 10, wallClockMs: 60000 },
    memories: [],
    ...overrides,
  };
}

const VALID_ARGS = {
  slug: 'a-new-bug',
  title: 'A new bug worth filing',
  description: 'Something is broken in a way worth tracking.',
  tags: ['engine', 'bug'],
  kind: 'bug',
  severity: 'medium',
  problem: 'The widget does not spin.',
  evidence: 'Observed in run X; see foo.ts:10.',
  proposedDirection: 'Make the widget spin.',
  acceptanceHint: 'The widget spins.',
};

let sandboxRoot: string;

beforeEach(async () => {
  sandboxRoot = await mkdtemp(join(tmpdir(), 'corellia-issue-tools-'));
  await mkdir(join(sandboxRoot, 'docs', 'issues'), { recursive: true });
  // A minimal OKF issues index with the three severity sections + tables.
  await writeFile(
    join(sandboxRoot, 'docs', 'issues', 'index.md'),
    [
      '---', 'type: index', 'title: Issues', '---', '',
      '# Issues', '',
      '## High severity', '', '| Issue | Kind | Tags |', '|---|---|---|', '',
      '## Medium severity', '', '| Issue | Kind | Tags |', '|---|---|---|', '',
      '## Low severity', '', '| Issue | Kind | Tags |', '|---|---|---|', '',
    ].join('\n'),
  );
});

afterEach(async () => {
  await rm(sandboxRoot, { recursive: true, force: true });
});

describe('file_issue', () => {
  it('writes a conformant OKF issue file with all frontmatter and body sections', async () => {
    const tool = fileIssueTool(sandboxRoot);
    const result = await tool.execute(makeGoal(), { ...VALID_ARGS });
    expect(result.ok).toBe(true);

    const written = await readFile(join(sandboxRoot, 'docs', 'issues', 'a-new-bug.md'), 'utf-8');
    expect(written).toMatch(/^---\n/);
    expect(written).toContain('type: issue');
    expect(written).toContain('title: A new bug worth filing');
    expect(written).toContain('tags: [engine, bug]');
    expect(written).toContain('status: open');
    expect(written).toContain('kind: bug');
    expect(written).toContain('severity: medium');
    expect(written).toContain('# A new bug worth filing');
    expect(written).toContain('## Problem');
    expect(written).toContain('## Evidence');
    expect(written).toContain('## Proposed direction');
    expect(written).toContain('## Acceptance hint');
  });

  it('appends a catalog row to docs/issues/index.md under the right severity section', async () => {
    const tool = fileIssueTool(sandboxRoot);
    await tool.execute(makeGoal(), { ...VALID_ARGS });
    const index = await readFile(join(sandboxRoot, 'docs', 'issues', 'index.md'), 'utf-8');
    expect(index).toContain('[a-new-bug](a-new-bug.md)');
    // Under Medium, not High/Low.
    const med = index.indexOf('## Medium severity');
    const low = index.indexOf('## Low severity');
    const row = index.indexOf('[a-new-bug]');
    expect(row).toBeGreaterThan(med);
    expect(row).toBeLessThan(low);
  });

  it('refuses to overwrite an existing slug', async () => {
    const tool = fileIssueTool(sandboxRoot);
    const first = await tool.execute(makeGoal(), { ...VALID_ARGS });
    expect(first.ok).toBe(true);
    const second = await tool.execute(makeGoal(), { ...VALID_ARGS });
    expect(second.ok).toBe(false);
    expect(second.output).toMatch(/already exists/i);
  });

  it('rejects an invalid kind', async () => {
    const tool = fileIssueTool(sandboxRoot);
    const result = await tool.execute(makeGoal(), { ...VALID_ARGS, kind: 'epic' });
    expect(result.ok).toBe(false);
    expect(result.output).toMatch(/kind/i);
    expect(existsSync(join(sandboxRoot, 'docs', 'issues', 'a-new-bug.md'))).toBe(false);
  });

  it('rejects an invalid severity', async () => {
    const tool = fileIssueTool(sandboxRoot);
    const result = await tool.execute(makeGoal(), { ...VALID_ARGS, severity: 'critical' });
    expect(result.ok).toBe(false);
    expect(result.output).toMatch(/severity/i);
  });

  it('rejects a path-traversal slug', async () => {
    const tool = fileIssueTool(sandboxRoot);
    const result = await tool.execute(makeGoal(), { ...VALID_ARGS, slug: '../../etc/passwd' });
    expect(result.ok).toBe(false);
    expect(result.output).toMatch(/slug/i);
  });

  it('rejects empty required fields', async () => {
    const tool = fileIssueTool(sandboxRoot);
    const result = await tool.execute(makeGoal(), { ...VALID_ARGS, problem: '' });
    expect(result.ok).toBe(false);
    expect(result.output).toMatch(/problem/i);
  });

  it('rejects empty tags', async () => {
    const tool = fileIssueTool(sandboxRoot);
    const result = await tool.execute(makeGoal(), { ...VALID_ARGS, tags: [] });
    expect(result.ok).toBe(false);
    expect(result.output).toMatch(/tags/i);
  });
});
