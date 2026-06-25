/**
 * Tests for parseIssueToCommissionSeed: reads an OKF type:issue file and
 * validates the seed extraction (id, title, spec.description, spec.constraints)
 * and error cases (missing type:issue, missing required frontmatter, absent body
 * sections).
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseIssueToCommissionSeed } from '../../src/listener/listener.js';

// ── Temp-dir helpers ──────────────────────────────────────────────────────────

let tmpDirs: string[] = [];

afterEach(() => {
  for (const d of tmpDirs) {
    try { rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
  }
  tmpDirs = [];
});

function makeTmpDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'corellia-issue-reader-'));
  tmpDirs.push(d);
  return d;
}

/** Write a file into a temp dir and return the path. */
function writeIssue(tmp: string, slug: string, content: string): string {
  const path = join(tmp, `${slug}.md`);
  writeFileSync(path, content, 'utf-8');
  return path;
}

// ── A well-formed issue fixture ───────────────────────────────────────────────

const WELL_FORMED = `---
type: issue
title: "Test issue: add a widget"
description: A one-line summary for the catalog
tags: [widget, test]
timestamp: 2026-01-01T00:00:00.000Z
status: open
kind: idea
severity: medium
---

# Test issue: add a widget

## Problem
The factory cannot produce widgets yet.

## Evidence
Widgets are needed by the roadmap.

## Proposed direction
Add a WidgetTool that brokered writes can invoke.

## Acceptance hint
A run must produce a widget artifact.
`;

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('parseIssueToCommissionSeed — well-formed issue', () => {
  it('extracts id from the slug (filename without .md)', async () => {
    const tmp = makeTmpDir();
    const path = writeIssue(tmp, 'add-widget', WELL_FORMED);

    const seed = await parseIssueToCommissionSeed(path);
    expect(seed.id).toBe('add-widget');
  });

  it('extracts title from the title frontmatter field', async () => {
    const tmp = makeTmpDir();
    const path = writeIssue(tmp, 'add-widget', WELL_FORMED);

    const seed = await parseIssueToCommissionSeed(path);
    expect(seed.title).toBe('Test issue: add a widget');
  });

  it('concatenates Problem and Proposed direction into spec.description', async () => {
    const tmp = makeTmpDir();
    const path = writeIssue(tmp, 'add-widget', WELL_FORMED);

    const seed = await parseIssueToCommissionSeed(path);
    expect(seed.spec.description).toContain('The factory cannot produce widgets yet.');
    expect(seed.spec.description).toContain('Add a WidgetTool that brokered writes can invoke.');
    // The two sections are separated by a blank line.
    expect(seed.spec.description).toMatch(
      /widgets yet\.\n\nAdd a WidgetTool/,
    );
  });

  it('extracts spec.constraints from the Acceptance hint section', async () => {
    const tmp = makeTmpDir();
    const path = writeIssue(tmp, 'add-widget', WELL_FORMED);

    const seed = await parseIssueToCommissionSeed(path);
    expect(seed.spec.constraints).toBe('A run must produce a widget artifact.');
  });

  it('parses a real doc issues file (factory-manages-issues.md)', async () => {
    // The repo's own docs/issues/*.md files should be parseable.
    const seed = await parseIssueToCommissionSeed('docs/issues/factory-manages-issues.md');
    expect(seed.id).toBe('factory-manages-issues');
    expect(seed.title).toBe('Teach the factory to create, consume, and delete OKF issues itself');
    expect(seed.spec.description.length).toBeGreaterThan(50);
    expect(seed.spec.constraints.length).toBeGreaterThan(10);
  });
});

describe('parseIssueToCommissionSeed — malformed files', () => {
  it('rejects when frontmatter type is not "issue"', async () => {
    const tmp = makeTmpDir();
    const content = `---
type: other
title: Something
kind: bug
severity: high
status: open
---

## Problem
text

## Proposed direction
text

## Acceptance hint
text
`;
    const path = writeIssue(tmp, 'not-issue', content);
    await expect(parseIssueToCommissionSeed(path)).rejects.toThrow(
      /type must be "issue"/,
    );
  });

  it('rejects when type field is missing', async () => {
    const tmp = makeTmpDir();
    const content = `---
title: Something
kind: bug
severity: high
status: open
---

## Problem
text

## Proposed direction
text

## Acceptance hint
text
`;
    const path = writeIssue(tmp, 'no-type', content);
    await expect(parseIssueToCommissionSeed(path)).rejects.toThrow(
      /type must be "issue"/,
    );
  });

  it('rejects when title is missing', async () => {
    const tmp = makeTmpDir();
    const content = `---
type: issue
kind: bug
severity: high
status: open
---

## Problem
text

## Proposed direction
text

## Acceptance hint
text
`;
    const path = writeIssue(tmp, 'no-title', content);
    await expect(parseIssueToCommissionSeed(path)).rejects.toThrow(
      /missing required frontmatter field "title"/,
    );
  });

  it('rejects when kind is missing', async () => {
    const tmp = makeTmpDir();
    const content = `---
type: issue
title: Has title
severity: high
status: open
---

## Problem
text

## Proposed direction
text

## Acceptance hint
text
`;
    const path = writeIssue(tmp, 'no-kind', content);
    await expect(parseIssueToCommissionSeed(path)).rejects.toThrow(
      /missing required frontmatter field "kind"/,
    );
  });

  it('rejects when severity is missing', async () => {
    const tmp = makeTmpDir();
    const content = `---
type: issue
title: Has title
kind: bug
status: open
---

## Problem
text

## Proposed direction
text

## Acceptance hint
text
`;
    const path = writeIssue(tmp, 'no-severity', content);
    await expect(parseIssueToCommissionSeed(path)).rejects.toThrow(
      /missing required frontmatter field "severity"/,
    );
  });

  it('rejects when status is missing', async () => {
    const tmp = makeTmpDir();
    const content = `---
type: issue
title: Has title
kind: bug
severity: high
---

## Problem
text

## Proposed direction
text

## Acceptance hint
text
`;
    const path = writeIssue(tmp, 'no-status', content);
    await expect(parseIssueToCommissionSeed(path)).rejects.toThrow(
      /missing required frontmatter field "status"/,
    );
  });

  it('rejects when the file has no frontmatter at all', async () => {
    const tmp = makeTmpDir();
    const path = writeIssue(tmp, 'no-fm', '# Just a heading\n\nSome body text.\n');
    await expect(parseIssueToCommissionSeed(path)).rejects.toThrow(
      /no frontmatter found/,
    );
  });

  it('rejects when ## Problem section is absent', async () => {
    const tmp = makeTmpDir();
    const content = `---
type: issue
title: Has title
kind: bug
severity: high
status: open
---

# Title

## Proposed direction
text

## Acceptance hint
text
`;
    const path = writeIssue(tmp, 'no-problem', content);
    await expect(parseIssueToCommissionSeed(path)).rejects.toThrow(
      /missing "## Problem"/,
    );
  });

  it('rejects when ## Proposed direction section is absent', async () => {
    const tmp = makeTmpDir();
    const content = `---
type: issue
title: Has title
kind: bug
severity: high
status: open
---

# Title

## Problem
text

## Acceptance hint
text
`;
    const path = writeIssue(tmp, 'no-proposed', content);
    await expect(parseIssueToCommissionSeed(path)).rejects.toThrow(
      /missing "## Proposed direction"/,
    );
  });

  it('rejects when ## Acceptance hint section is absent', async () => {
    const tmp = makeTmpDir();
    const content = `---
type: issue
title: Has title
kind: bug
severity: high
status: open
---

# Title

## Problem
text

## Proposed direction
text
`;
    const path = writeIssue(tmp, 'no-hint', content);
    await expect(parseIssueToCommissionSeed(path)).rejects.toThrow(
      /missing "## Acceptance hint"/,
    );
  });

  it('rejects when required frontmatter field is present but empty', async () => {
    const tmp = makeTmpDir();
    const content = `---
type: issue
title: 
kind: bug
severity: high
status: open
---

## Problem
text

## Proposed direction
text

## Acceptance hint
text
`;
    const path = writeIssue(tmp, 'empty-title', content);
    await expect(parseIssueToCommissionSeed(path)).rejects.toThrow(
      /missing required frontmatter field "title"/,
    );
  });

  it('rejects a non-.md file', async () => {
    const tmp = makeTmpDir();
    const path = join(tmp, 'not-markdown.txt');
    writeFileSync(path, WELL_FORMED, 'utf-8');
    await expect(parseIssueToCommissionSeed(path)).rejects.toThrow(
      /expected .md file/,
    );
  });
});