/**
 * The issue-backlog consistency rules (src/library/issue-backlog.ts): the closed
 * lifecycle vocabulary, `## Resolution` presence tracking status, and catalog
 * rows agreeing with their files. Each case builds a tiny docs tree and names
 * the one rule it breaks.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { catalogRow, checkIssueBacklog, parseCatalog } from '../../src/library/issue-backlog.js';

let docsRoot: string;

beforeEach(async () => {
  docsRoot = await mkdtemp(join(tmpdir(), 'corellia-issue-backlog-'));
  await mkdir(join(docsRoot, 'issues'), { recursive: true });
});

afterEach(async () => {
  await rm(docsRoot, { recursive: true, force: true });
});

type IssueSpec = { slug: string; status: string; kind?: string; severity?: string; body?: string };

async function writeIssue(spec: IssueSpec): Promise<void> {
  const text = [
    '---',
    'type: issue',
    `status: ${spec.status}`,
    `kind: ${spec.kind ?? 'bug'}`,
    `severity: ${spec.severity ?? 'high'}`,
    '---',
    '',
    `# ${spec.slug}`,
    '',
    '## Problem',
    'Something.',
    ...(spec.body !== undefined ? ['', spec.body] : []),
    '',
  ].join('\n');
  await writeFile(join(docsRoot, 'issues', `${spec.slug}.md`), text, 'utf-8');
}

async function writeCatalog(rows: Record<'high' | 'medium' | 'low', string[]>): Promise<void> {
  const section = (name: string, r: string[]) =>
    [`## ${name} severity`, '', '| Issue | Kind | Status | Tags |', '|---|---|---|---|', ...r, ''].join('\n');
  await writeFile(
    join(docsRoot, 'issues', 'index.md'),
    ['# Issues', '', section('High', rows.high), section('Medium', rows.medium), section('Low', rows.low)].join('\n'),
    'utf-8',
  );
}

const row = (slug: string, status: string, kind = 'bug') => catalogRow({ slug, kind, status, tags: ['engine'] });

function rules(): string[] {
  return checkIssueBacklog(docsRoot).map((v) => v.rule).sort();
}

describe('checkIssueBacklog', () => {
  it('passes a consistent backlog', async () => {
    await writeIssue({ slug: 'a', status: 'open' });
    await writeIssue({ slug: 'b', status: 'fixed-pending-live-proof', severity: 'low', body: '## Resolution\n\nLanded.' });
    await writeCatalog({ high: [row('a', 'open')], medium: [], low: [row('b', 'fixed-pending-live-proof')] });
    expect(checkIssueBacklog(docsRoot)).toEqual([]);
  });

  it('rejects a status outside the lifecycle (done is deletion, not a status)', async () => {
    await writeIssue({ slug: 'a', status: 'done', body: '## Resolution\n\nLanded.' });
    await writeCatalog({ high: [row('a', 'done')], medium: [], low: [] });
    expect(rules()).toEqual(['status-vocabulary']);
  });

  it('rejects an open issue whose body carries a fix note', async () => {
    await writeIssue({ slug: 'a', status: 'open', body: '---\n\n> **Fixed (2026-07-07, pending live proof).** Built it.' });
    await writeCatalog({ high: [row('a', 'open')], medium: [], low: [] });
    expect(rules()).toEqual(['open-with-fix-note']);
  });

  it('rejects an open issue with a Resolution section', async () => {
    await writeIssue({ slug: 'a', status: 'open', body: '## Resolution\n\nSome of it.' });
    await writeCatalog({ high: [row('a', 'open')], medium: [], low: [] });
    expect(rules()).toEqual(['open-with-resolution']);
  });

  it('rejects a non-open issue with no Resolution section', async () => {
    await writeIssue({ slug: 'a', status: 'partially-fixed' });
    await writeCatalog({ high: [row('a', 'partially-fixed')], medium: [], low: [] });
    expect(rules()).toEqual(['resolution-missing']);
  });

  it('rejects a catalog row whose status disagrees with the file', async () => {
    await writeIssue({ slug: 'a', status: 'partially-fixed', body: '## Resolution\n\nHalf.' });
    await writeCatalog({ high: [row('a', 'open')], medium: [], low: [] });
    expect(rules()).toEqual(['catalog-status']);
  });

  it('rejects a row filed under the wrong severity and a row with the wrong kind', async () => {
    await writeIssue({ slug: 'a', status: 'open', severity: 'medium', kind: 'idea' });
    await writeCatalog({ high: [row('a', 'open', 'bug')], medium: [], low: [] });
    expect(rules()).toEqual(['catalog-kind', 'catalog-section']);
  });

  it('rejects a missing row, a duplicated row, and an orphaned row', async () => {
    await writeIssue({ slug: 'a', status: 'open' });
    await writeIssue({ slug: 'b', status: 'open' });
    await writeCatalog({ high: [row('b', 'open'), row('b', 'open'), row('gone', 'open')], medium: [], low: [] });
    expect(rules()).toEqual(['catalog-row-duplicated', 'catalog-row-missing', 'catalog-row-orphaned']);
  });

  it('is clean for a docs tree with no issues directory', async () => {
    await rm(join(docsRoot, 'issues'), { recursive: true });
    expect(checkIssueBacklog(docsRoot)).toEqual([]);
  });
});

describe('parseCatalog', () => {
  it('reads slug, section, kind, and status from each row', () => {
    const entries = parseCatalog(['## High severity', '', row('x', 'open', 'idea')].join('\n'));
    expect(entries).toEqual([{ slug: 'x', section: '## High severity', kind: 'idea', status: 'open', line: 3 }]);
  });
});
