import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { salvageWorktreeArtifact } from '../../src/engine/attempt/worktree-salvage.js';

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'corellia-salvage-'));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  execFileSync('git', ['init'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.email', 't@e.com'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.name', 'T'], { cwd: dir, stdio: 'pipe' });
  writeFileSync(join(dir, 'README.md'), '# r\n');
  execFileSync('git', ['add', 'README.md'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['commit', '-m', 'init'], { cwd: dir, stdio: 'pipe' });
  return dir;
}

describe('salvageWorktreeArtifact', () => {
  it('collects an in-scope untracked file written to the worktree', () => {
    const repo = makeRepo();
    mkdirSync(join(repo, 'src/library'), { recursive: true });
    writeFileSync(join(repo, 'src/library/acceptance-criteria.ts'), 'export type X = 1;\n');

    const art = salvageWorktreeArtifact(repo, ['src/library/']);
    expect(art).toBeDefined();
    expect(art!.kind).toBe('files');
    expect(art!.files).toEqual([
      { path: 'src/library/acceptance-criteria.ts', content: 'export type X = 1;\n' },
    ]);
  });

  it('collects an in-scope modification to a tracked file', () => {
    const repo = makeRepo();
    writeFileSync(join(repo, 'README.md'), '# r\nchanged\n');
    const art = salvageWorktreeArtifact(repo, ['README.md']);
    expect(art?.files?.[0]?.path).toBe('README.md');
    expect(art?.files?.[0]?.content).toContain('changed');
  });

  it('excludes changes outside the declared scope', () => {
    const repo = makeRepo();
    mkdirSync(join(repo, 'src'), { recursive: true });
    writeFileSync(join(repo, 'src/in.ts'), 'in\n');
    writeFileSync(join(repo, 'out.ts'), 'out\n');

    const art = salvageWorktreeArtifact(repo, ['src/']);
    expect(art?.files?.map((f) => f.path)).toEqual(['src/in.ts']);
  });

  it('returns undefined for a clean worktree', () => {
    const repo = makeRepo();
    expect(salvageWorktreeArtifact(repo, ['src/'])).toBeUndefined();
  });

  it('returns undefined when changes exist but none are in scope', () => {
    const repo = makeRepo();
    writeFileSync(join(repo, 'out.ts'), 'out\n');
    expect(salvageWorktreeArtifact(repo, ['src/'])).toBeUndefined();
  });

  it('returns undefined on a non-repo path (best-effort, no throw)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'corellia-nonrepo-'));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    writeFileSync(join(dir, 'a.ts'), 'a\n');
    expect(salvageWorktreeArtifact(dir, [])).toBeUndefined();
  });
});
