import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { countRegion, repoShapeHint } from '../../src/engine/repo-shape-hint.js';
import { makeGoal } from './stubs.js';

describe('repo shape hints', () => {
  let dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
    dirs = [];
  });

  function tempRepo(): string {
    const dir = mkdtempSync(join(tmpdir(), 'corellia-shape-'));
    dirs.push(dir);
    return dir;
  }

  it('skips goals that do not map repository shape', () => {
    const root = tempRepo();

    expect(repoShapeHint(makeGoal({ type: 'make-widget' }), root)).toBeUndefined();
  });

  it('summarizes whole-repo breadth while ignoring tooling directories', () => {
    const root = tempRepo();
    mkdirSync(join(root, 'src'));
    mkdirSync(join(root, 'docs'));
    mkdirSync(join(root, 'node_modules'));
    writeFileSync(join(root, 'README.md'), 'hello');
    writeFileSync(join(root, 'node_modules', 'ignored.js'), 'ignored');
    writeFileSync(join(root, 'src', 'index.ts'), 'export {};');

    const hint = repoShapeHint(makeGoal({ type: 'map-repo' }), root);

    expect(hint).toContain('top-level source dirs: 2');
    expect(hint).toContain('top-level files: 1');
  });

  it('does not hint for small scoped regions', () => {
    const root = tempRepo();
    mkdirSync(join(root, 'src'));
    writeFileSync(join(root, 'src', 'index.ts'), 'export {};');

    expect(repoShapeHint(makeGoal({ type: 'deep-dive-region', scope: ['src'] }), root)).toBeUndefined();
  });

  it('hints for scoped regions that are too large for one node', () => {
    const root = tempRepo();
    mkdirSync(join(root, 'tests'));
    writeFileSync(join(root, 'tests', 'large.test.ts'), 'x'.repeat(451_000));

    const hint = repoShapeHint(makeGoal({ type: 'deep-dive-region', scope: ['tests'] }), root);

    expect(hint).toContain('scope: tests');
    expect(hint).toContain('SPLIT');
  });

  it('counts scoped regions without descending into ignored tooling dirs', () => {
    const root = tempRepo();
    mkdirSync(join(root, 'src'));
    mkdirSync(join(root, 'src', 'node_modules'));
    writeFileSync(join(root, 'src', 'index.ts'), 'export {};');
    writeFileSync(join(root, 'src', 'node_modules', 'ignored.js'), 'ignored');

    expect(countRegion(root, ['src'])).toMatchObject({ dirs: 0, files: 1 });
  });
});
