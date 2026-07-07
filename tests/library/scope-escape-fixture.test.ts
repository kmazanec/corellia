import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { filesWithinScope } from '../../src/library/checks.js';
import type { Goal } from '../../src/contract/goal.js';
import type { Artifact } from '../../src/contract/report.js';

// The diff ⊆ scope proof: a goal declares an impact set, and an artifact that
// writes a file OUTSIDE that scope is rejected deterministically before any
// judge — the out-of-scope write seen in real runs. The clean twin, differing
// by exactly one file, passes. Drives the real filesWithinScope check.

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'fixtures', 'scope-escape');

function readFixture<T>(name: string): T {
  return JSON.parse(readFileSync(join(fixtureDir, name), 'utf8')) as T;
}

const { scope } = readFixture<{ scope: string[] }>('scope.json');
const goal = { id: 'g', scope } as unknown as Goal;

describe('scope-escape fixture (diff ⊆ scope)', () => {
  it('PASSES when every file is within the declared scope', async () => {
    const artifact = readFixture<Artifact>('artifact.clean.json');
    const result = await filesWithinScope.run(goal, artifact);
    expect(result.ok).toBe(true);
  });

  it('FAILS when one file escapes the declared scope (out-of-scope write caught)', async () => {
    const artifact = readFixture<Artifact>('artifact.defect.json');
    const result = await filesWithinScope.run(goal, artifact);
    expect(result.ok).toBe(false);
    expect(result.detail).toContain('outside declared scope');
    expect(result.detail).toContain('src/auth/session.ts');
  });
});
