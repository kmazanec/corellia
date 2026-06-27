/**
 * Tests for the deliver-intent lifecycle integration steps (ADR-034):
 * createIterationRecord and deleteProvenanceIssue. Both run as engine code at the
 * assembly-emit SUCCESS boundary (before collectTree); these unit tests exercise
 * them directly against tmp-dir fixture worktrees.
 *
 * "Both steps fire on success" is covered here (the success branch calls them);
 * "neither fires on a blocked delivery" is structural — the engine calls them only
 * in the `!failedOrBlocked` branch — and is asserted via the no-op behaviors below
 * (a goal without a provenance annotation deletes nothing; an absent index is left
 * untouched).
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createIterationRecord, deleteProvenanceIssue } from '../../src/engine/iteration-tools.js';
import type { Goal } from '../../src/contract/goal.js';

let tmpDirs: string[] = [];
function makeWorktree(): string {
  const d = mkdtempSync(join(tmpdir(), 'corellia-iter-'));
  tmpDirs.push(d);
  mkdirSync(join(d, 'docs', 'iterations'), { recursive: true });
  mkdirSync(join(d, 'docs', 'issues'), { recursive: true });
  return d;
}
afterEach(() => {
  for (const d of tmpDirs) {
    try { rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
  }
  tmpDirs = [];
});

// A fixed clock — 2026-06-26 20:00 local — so the date prefix is deterministic.
const FIXED_MS = new Date(2026, 5, 26, 20, 0, 0).getTime();
const now = () => FIXED_MS;
const datePrefix = `2026-06-26-20`;

function makeGoal(overrides: Partial<Goal> = {}): Goal {
  return {
    id: 'live-self-abc/root',
    type: 'deliver-intent',
    parentId: null,
    title: 'Add a CLI greeting command',
    spec: { description: 'Add a CLI greeting command' },
    intent: 'production',
    scope: ['src/cli/'],
    budget: { attempts: 1, tokens: 1000, toolCalls: 10, wallClockMs: 1000 },
    memories: [],
    ...overrides,
  };
}

function seedIndex(root: string, rel: string, body: string): void {
  writeFileSync(join(root, rel), body, 'utf-8');
}

describe('createIterationRecord', () => {
  it('creates a date-prefixed iteration dir with OKF type:iteration frontmatter', () => {
    const root = makeWorktree();
    createIterationRecord(root, makeGoal(), now);

    const iterDir = join(root, 'docs', 'iterations', `${datePrefix}-add-a-cli-greeting-command`);
    const indexMd = join(iterDir, 'index.md');
    expect(existsSync(indexMd)).toBe(true);

    const content = readFileSync(indexMd, 'utf-8');
    expect(content.startsWith('---\n')).toBe(true);
    expect(content).toContain('type: iteration');
    expect(content).toContain('Add a CLI greeting command');
  });

  it('appends a catalog row to docs/iterations/index.md', () => {
    const root = makeWorktree();
    seedIndex(root, 'docs/iterations/index.md',
      '# Iterations\n\n| Iteration | Title | Status |\n|---|---|---|\n| [old](old/index.md) | Old | shipped |\n');
    createIterationRecord(root, makeGoal(), now);

    const idx = readFileSync(join(root, 'docs', 'iterations', 'index.md'), 'utf-8');
    expect(idx).toContain(`[${datePrefix}-add-a-cli-greeting-command](${datePrefix}-add-a-cli-greeting-command/index.md)`);
    // The old row is still present (append, not replace).
    expect(idx).toContain('[old](old/index.md)');
  });

  it('appends a one-line entry to docs/log.md under the current date heading', () => {
    const root = makeWorktree();
    seedIndex(root, 'docs/log.md', '# Corellia log\n\nNewest first.\n\n## 2026-06-26\n\n- prior entry\n');
    createIterationRecord(root, makeGoal(), now);

    const log = readFileSync(join(root, 'docs', 'log.md'), 'utf-8');
    expect(log).toContain('Add a CLI greeting command');
    expect(log).toContain(`iterations/${datePrefix}-add-a-cli-greeting-command/index.md`);
    // The prior entry survives.
    expect(log).toContain('- prior entry');
  });

  it('is idempotent — a second call for the same intent does not clobber', () => {
    const root = makeWorktree();
    createIterationRecord(root, makeGoal(), now);
    const iterDir = join(root, 'docs', 'iterations', `${datePrefix}-add-a-cli-greeting-command`);
    const firstContent = readFileSync(join(iterDir, 'index.md'), 'utf-8');

    // Second call: dir exists → skip (no throw, no clobber).
    expect(() => createIterationRecord(root, makeGoal(), now)).not.toThrow();
    expect(readFileSync(join(iterDir, 'index.md'), 'utf-8')).toBe(firstContent);
  });

  it('skips entirely when the title yields an empty slug', () => {
    const root = makeWorktree();
    createIterationRecord(root, makeGoal({ title: '!!!' }), now);
    // No iteration dir created (slug empty).
    const dirs = readdirSync(join(root, 'docs', 'iterations'));
    expect(dirs).toHaveLength(0);
  });
});

describe('deleteProvenanceIssue', () => {
  it('deletes the issue file named by a `// from docs/issues/<slug>.md` provenance annotation', () => {
    const root = makeWorktree();
    writeFileSync(join(root, 'docs', 'issues', 'my-feature.md'), '# the issue\n', 'utf-8');
    seedIndex(root, 'docs/issues/index.md',
      '# Issues\n\n| Issue | Kind | Tags |\n|---|---|---|\n| [my-feature](my-feature.md) | bug | x |\n| [other](other.md) | idea | y |\n');

    const goal = makeGoal({ spec: { description: 'do it', provenance: '// from docs/issues/my-feature.md' } });
    deleteProvenanceIssue(root, goal);

    expect(existsSync(join(root, 'docs', 'issues', 'my-feature.md'))).toBe(false);
    const idx = readFileSync(join(root, 'docs', 'issues', 'index.md'), 'utf-8');
    expect(idx).not.toContain('[my-feature](my-feature.md)');
    // An unrelated row is untouched.
    expect(idx).toContain('[other](other.md)');
  });

  it('is a no-op when the goal carries no provenance annotation', () => {
    const root = makeWorktree();
    writeFileSync(join(root, 'docs', 'issues', 'keepme.md'), '# keep\n', 'utf-8');
    deleteProvenanceIssue(root, makeGoal()); // no annotation in spec
    expect(existsSync(join(root, 'docs', 'issues', 'keepme.md'))).toBe(true);
  });

  it('is a no-op when the annotated issue file is already gone', () => {
    const root = makeWorktree();
    const goal = makeGoal({ spec: { provenance: '// from docs/issues/ghost.md' } });
    expect(() => deleteProvenanceIssue(root, goal)).not.toThrow();
  });
});
