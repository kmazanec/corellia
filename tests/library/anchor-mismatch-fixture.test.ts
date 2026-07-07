import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, copyFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { sandboxFileContains } from '../../src/library/checks.js';
import type { Goal } from '../../src/contract/goal.js';

// The {file, anchor} proof: the SAME criterion — docs/api.md must contain the
// anchor "## Authentication" — passes against a doc whose heading matches and
// fails against a doc whose heading was reworded so the anchor is gone. An
// anchor that does not exist at the SHA can never pass, whatever a judge thinks
// the section means. Drives the real sandboxFileContains against a worktree.

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'fixtures', 'anchor-mismatch');

const { file, anchor } = JSON.parse(
  readFileSync(join(fixtureDir, 'anchor.json'), 'utf8'),
) as { file: string; anchor: string };

const goal = { id: 'g', scope: ['docs/'] } as unknown as Goal;

function makeWorktree(docKind: 'true-anchor' | 'defect'): string {
  const root = mkdtempSync(join(tmpdir(), 'anchor-mismatch-'));
  mkdirSync(join(root, dirname(file)), { recursive: true });
  copyFileSync(join(fixtureDir, `api.${docKind}.md`), join(root, file));
  return root;
}

describe('anchor-mismatch fixture ({file, anchor} criterion)', () => {
  it('PASSES when the anchor is present at the SHA', async () => {
    const root = makeWorktree('true-anchor');
    try {
      const check = sandboxFileContains(file, anchor);
      const result = await check.run(goal, null, { sandboxRoot: root });
      expect(result.ok).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('FAILS when the anchor was reworded away (anchor mismatch caught)', async () => {
    const root = makeWorktree('defect');
    try {
      const check = sandboxFileContains(file, anchor);
      const result = await check.run(goal, null, { sandboxRoot: root });
      expect(result.ok).toBe(false);
      expect(result.detail).toContain('does not contain');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
