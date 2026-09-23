/**
 * `update_issue` (src/engine/issue-updates.ts): each lifecycle transition keeps
 * the issue file, its catalog row, and the log consistent — proven by running
 * the same backlog check the docs lint runs.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { updateIssue } from '../../src/engine/issue-updates.js';
import { updateIssueTool } from '../../src/engine/issue-tools.js';
import { checkIssueBacklog } from '../../src/library/issue-backlog.js';
import type { Goal } from '../../src/contract/goal.js';

const NOW = () => Date.parse('2026-09-23T12:00:00Z');
let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'corellia-issue-updates-'));
  await mkdir(join(root, 'docs', 'issues'), { recursive: true });
  await writeFile(
    join(root, 'docs', 'issues', 'widget.md'),
    ['---', 'type: issue', 'title: Widget', 'status: open', 'kind: bug', 'severity: medium', '---', '', '# Widget', '', '## Problem', 'It does not spin.', ''].join('\n'),
    'utf-8',
  );
  await writeFile(
    join(root, 'docs', 'issues', 'index.md'),
    ['# Issues', '', '## Medium severity', '', '| Issue | Kind | Status | Tags |', '|---|---|---|---|', '| [widget](widget.md) | bug | open | engine |', ''].join('\n'),
    'utf-8',
  );
  await writeFile(join(root, 'docs', 'log.md'), ['---', 'type: log', '---', '', '# Log', '', '## 2026-09-23', '', '- Earlier entry.', ''].join('\n'), 'utf-8');
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const read = (rel: string) => readFile(join(root, rel), 'utf-8');

describe('updateIssue', () => {
  it('records a partial fix: status, a dated Resolution entry, and the catalog row', async () => {
    const result = await updateIssue(root, { slug: 'widget', status: 'partially-fixed', resolution: 'Spins left.' }, NOW);
    expect(result.ok).toBe(true);

    const issue = await read('docs/issues/widget.md');
    expect(issue).toContain('status: partially-fixed');
    expect(issue).toMatch(/## Resolution\n\n\*\*2026-09-23 — partially-fixed\.\*\* Spins left\.\n$/);
    expect(await read('docs/issues/index.md')).toContain('| [widget](widget.md) | bug | partially-fixed | engine |');
    expect(checkIssueBacklog(join(root, 'docs'))).toEqual([]);
  });

  it('appends later entries to the same Resolution section', async () => {
    await updateIssue(root, { slug: 'widget', status: 'partially-fixed', resolution: 'Spins left.' }, NOW);
    await updateIssue(root, { slug: 'widget', status: 'fixed-pending-live-proof', resolution: 'Spins right.' }, NOW);

    const issue = await read('docs/issues/widget.md');
    expect(issue.match(/## Resolution/g)).toHaveLength(1);
    expect(issue).toContain('Spins left.\n\n**2026-09-23 — fixed-pending-live-proof.** Spins right.');
    expect(checkIssueBacklog(join(root, 'docs'))).toEqual([]);
  });

  it('resolves: deletes the issue and its row, and logs under the date heading', async () => {
    const result = await updateIssue(root, { slug: 'widget', status: 'resolved', resolution: 'Spins both ways, live.' }, NOW);
    expect(result.ok).toBe(true);

    expect(existsSync(join(root, 'docs', 'issues', 'widget.md'))).toBe(false);
    expect(await read('docs/issues/index.md')).not.toContain('[widget]');
    expect(await read('docs/log.md')).toContain('## 2026-09-23\n\n- **Resolved issue `widget`** — Spins both ways, live.\n- Earlier entry.');
    expect(checkIssueBacklog(join(root, 'docs'))).toEqual([]);
  });

  it('refuses an unknown transition, a missing resolution, and a missing issue', async () => {
    expect((await updateIssue(root, { slug: 'widget', status: 'done', resolution: 'x' }, NOW)).output).toMatch(/status/);
    expect((await updateIssue(root, { slug: 'widget', status: 'resolved', resolution: '  ' }, NOW)).output).toMatch(/resolution/);
    expect((await updateIssue(root, { slug: 'nope', status: 'resolved', resolution: 'x' }, NOW)).output).toMatch(/no issue/);
    expect(await read('docs/issues/widget.md')).toContain('status: open');
  });
});

describe('updateIssueTool', () => {
  it('exposes the lifecycle transitions and delegates to updateIssue', async () => {
    const tool = updateIssueTool(root, NOW);
    expect(tool.def.name).toBe('update_issue');
    expect((tool.def.parameters as { properties: { status: { enum: string[] } } }).properties.status.enum)
      .toEqual(['partially-fixed', 'fixed-pending-live-proof', 'resolved']);
    const goal = { id: 'g', type: 'investigate', scope: ['docs/issues/'] } as unknown as Goal;
    const result = await tool.execute(goal, { slug: 'widget', status: 'fixed-pending-live-proof', resolution: 'Built.' });
    expect(result.ok).toBe(true);
  });
});
