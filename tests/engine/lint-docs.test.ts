/**
 * Tests for the OKF docs lint script (scripts/lint-docs.ts).
 *
 * Verifies that the lintDocs function:
 *   1. Passes a conformant docs tree (no hard violations).
 *   2. Fails (reports a hard violation) for a doc missing the "type" field.
 *   3. Fails for an issues doc missing kind/severity/status.
 *   4. Exempts reserved files (index.md, log.md).
 *   5. Warns on missing recommended fields.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rm, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { lintDocs } from '../../scripts/lint-docs.js';

let docsRoot: string;

beforeEach(async () => {
  docsRoot = await mkdtempSimple();
});

afterEach(async () => {
  await rm(docsRoot, { recursive: true, force: true });
});

async function mkdtempSimple(): Promise<string> {
  const { mkdtemp } = await import('node:fs/promises');
  return mkdtemp(join(tmpdir(), 'corellia-lint-docs-'));
}

async function writeDoc(
  dir: string,
  name: string,
  frontmatter: Record<string, string>,
): Promise<void> {
  const lines = ['---'];
  for (const [k, v] of Object.entries(frontmatter)) {
    lines.push(`${k}: ${v}`);
  }
  lines.push('---');
  lines.push('');
  lines.push('# Body content');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, name), lines.join('\n'), 'utf-8');
}

describe('lintDocs', () => {
  it('passes a conformant docs tree with no violations', async () => {
    await writeDoc(docsRoot, 'ARCHITECTURE.md', {
      type: 'architecture',
      title: 'Architecture',
      description: 'System architecture',
      tags: 'arch',
      timestamp: '2026-01-01',
    });
    await writeDoc(docsRoot, 'PRD.md', {
      type: 'prd',
      title: 'PRD',
      description: 'Product requirements',
      tags: 'product',
      timestamp: '2026-01-01',
    });

    const { hardViolations, warnings } = lintDocs(docsRoot);
    expect(hardViolations).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it('reports a hard violation when type is missing', async () => {
    await writeDoc(docsRoot, 'MISSING.md', {
      title: 'No type here',
      description: 'Missing the required type field',
    });

    const { hardViolations } = lintDocs(docsRoot);
    expect(hardViolations).toHaveLength(1);
    expect(hardViolations[0]).toMatchObject({
      file: 'MISSING.md',
      field: 'type',
    });
  });

  it('reports a hard violation when type is empty', async () => {
    await writeDoc(docsRoot, 'EMPTY.md', {
      type: '',
      title: 'Empty type',
    });

    const { hardViolations } = lintDocs(docsRoot);
    expect(hardViolations).toHaveLength(1);
    expect(hardViolations[0]).toMatchObject({
      file: 'EMPTY.md',
      field: 'type',
    });
  });

  it('reports hard violations for issues missing kind, severity, or status', async () => {
    const issuesDir = join(docsRoot, 'issues');
    await writeDoc(issuesDir, 'bad-issue.md', {
      type: 'issue',
      title: 'Bad issue',
      description: 'Missing kind, severity, status',
      tags: 'test',
      timestamp: '2026-01-01',
    });

    const { hardViolations } = lintDocs(docsRoot);

    const fields = hardViolations.map((v) => v.field).sort();
    expect(fields).toEqual(['kind', 'severity', 'status']);
  });

  it('exempts reserved index.md from type requirement', async () => {
    // docs/index.md — reserved
    await writeDoc(docsRoot, 'index.md', {
      title: 'Index',
    });

    const { hardViolations } = lintDocs(docsRoot);
    expect(hardViolations).toEqual([]);
  });

  it('exempts reserved log.md from type requirement', async () => {
    await writeDoc(docsRoot, 'log.md', {
      title: 'Log',
    });

    const { hardViolations } = lintDocs(docsRoot);
    expect(hardViolations).toEqual([]);
  });

  it('exempts nested index.md from type requirement', async () => {
    const subDir = join(docsRoot, 'adrs');
    await writeDoc(subDir, 'index.md', {
      title: 'ADR index',
    });

    const { hardViolations } = lintDocs(docsRoot);
    expect(hardViolations).toEqual([]);
  });

  it('warns on missing recommended fields (title, description, tags, timestamp)', async () => {
    await writeDoc(docsRoot, 'SPARSE.md', {
      type: 'note',
    });

    const { hardViolations, warnings } = lintDocs(docsRoot);
    expect(hardViolations).toEqual([]);
    const warnFields = warnings.map((w) => w.field).sort();
    expect(warnFields).toEqual(['description', 'tags', 'timestamp', 'title']);
  });

  it('does not warn when recommended fields are present and non-empty', async () => {
    await writeDoc(docsRoot, 'FULL.md', {
      type: 'note',
      title: 'Full',
      description: 'Has all fields',
      tags: 'a, b',
      timestamp: '2026-01-01',
    });

    const { warnings } = lintDocs(docsRoot);
    expect(warnings).toEqual([]);
  });

  it('returns empty violations for a nonexistent docs root', async () => {
    const { hardViolations, warnings } = lintDocs(join(docsRoot, 'nope'));
    expect(hardViolations).toEqual([]);
    expect(warnings).toEqual([]);
  });
});