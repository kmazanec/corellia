/**
 * Tests for src/library/imports.ts — the import-edge scanner and impact().
 *
 * All tests use tmp fixture trees built with writeFileSync. No network, no mocks.
 * Covers AC-1..6 from the F-42 spec.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { scanImports, impact } from '../../src/library/imports.js';
import type { ImportGraph } from '../../src/library/imports.js';

// ── Fixture helpers ───────────────────────────────────────────────────────────

let tmpDirs: string[] = [];

function makeTmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'corellia-imp-'));
  tmpDirs.push(d);
  return d;
}

afterEach(() => {
  for (const d of tmpDirs) {
    try { rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
  }
  tmpDirs = [];
});

function write(root: string, relPath: string, content: string): void {
  const abs = join(root, relPath);
  mkdirSync(join(root, relPath.split('/').slice(0, -1).join('/')), { recursive: true });
  writeFileSync(abs, content, 'utf8');
}

// ── AC-1: ES/TS import forms + extension/index inference ─────────────────────

describe('AC-1: ES/TS import extraction and path resolution', () => {
  it('resolves static import with explicit extension', () => {
    const root = makeTmp();
    write(root, 'src/a.ts', `export const x = 1;`);
    write(root, 'src/b.ts', `import { x } from './a.js';`);

    const graph = scanImports(root, { sha: 'test-sha' });
    expect(graph.edges).toContainEqual({ from: 'src/b.ts', to: 'src/a.ts' });
  });

  it('resolves export...from form', () => {
    const root = makeTmp();
    write(root, 'src/a.ts', `export const x = 1;`);
    write(root, 'src/index.ts', `export { x } from './a.js';`);

    const graph = scanImports(root, { sha: 'test-sha' });
    expect(graph.edges).toContainEqual({ from: 'src/index.ts', to: 'src/a.ts' });
  });

  it('resolves require() form', () => {
    const root = makeTmp();
    write(root, 'src/utils.ts', `export function fn() {}`);
    write(root, 'src/main.ts', `const u = require('./utils.js');`);

    const graph = scanImports(root, { sha: 'test-sha' });
    expect(graph.edges).toContainEqual({ from: 'src/main.ts', to: 'src/utils.ts' });
  });

  it('resolves dynamic import() form', () => {
    const root = makeTmp();
    write(root, 'src/lazy.ts', `export const lazy = 1;`);
    write(root, 'src/main.ts', `const m = await import('./lazy.js');`);

    const graph = scanImports(root, { sha: 'test-sha' });
    expect(graph.edges).toContainEqual({ from: 'src/main.ts', to: 'src/lazy.ts' });
  });

  it('infers .ts extension when specifier has no extension', () => {
    const root = makeTmp();
    write(root, 'src/util.ts', `export const x = 1;`);
    write(root, 'src/main.ts', `import { x } from './util';`);

    const graph = scanImports(root, { sha: 'test-sha' });
    expect(graph.edges).toContainEqual({ from: 'src/main.ts', to: 'src/util.ts' });
  });

  it('infers /index.ts for a directory import', () => {
    const root = makeTmp();
    write(root, 'src/utils/index.ts', `export const u = 1;`);
    write(root, 'src/main.ts', `import { u } from './utils';`);

    const graph = scanImports(root, { sha: 'test-sha' });
    expect(graph.edges).toContainEqual({ from: 'src/main.ts', to: 'src/utils/index.ts' });
  });

  it('resolves TypeScript type import', () => {
    const root = makeTmp();
    write(root, 'src/types.ts', `export type Foo = string;`);
    write(root, 'src/consumer.ts', `import type { Foo } from './types.js';`);

    const graph = scanImports(root, { sha: 'test-sha' });
    expect(graph.edges).toContainEqual({ from: 'src/consumer.ts', to: 'src/types.ts' });
  });

  it('does not create self-import edges', () => {
    const root = makeTmp();
    write(root, 'src/a.ts', `import { a } from './a.js';`);

    const graph = scanImports(root, { sha: 'test-sha' });
    const selfEdges = graph.edges.filter(e => e.from === e.to);
    expect(selfEdges).toHaveLength(0);
  });

  it('resolves .tsx extension', () => {
    const root = makeTmp();
    write(root, 'src/Button.tsx', `export const Button = () => null;`);
    write(root, 'src/App.tsx', `import { Button } from './Button';`);

    const graph = scanImports(root, { sha: 'test-sha' });
    expect(graph.edges).toContainEqual({ from: 'src/App.tsx', to: 'src/Button.tsx' });
  });
});

// ── AC-2: Python / Go / Ruby generic patterns ─────────────────────────────────

describe('AC-2: Python/Go/Ruby generic patterns (best-effort)', () => {
  it('extracts Python relative imports', () => {
    const root = makeTmp();
    write(root, 'app/utils.py', `def helper(): pass`);
    write(root, 'app/main.py', `from .utils import helper`);

    const graph = scanImports(root, { sha: 'test-sha' });
    // Python relative import: from .utils → sibling utils.py
    // The pattern captures ".utils"; resolution maps to app/utils.py
    const hasEdge = graph.edges.some(e => e.from === 'app/main.py' && e.to === 'app/utils.py');
    expect(hasEdge).toBe(true);
  });

  it('extracts Go relative import paths', () => {
    const root = makeTmp();
    write(root, 'pkg/util.go', `package pkg`);
    write(root, 'cmd/main.go', `import "../pkg/util.go"`);

    const graph = scanImports(root, { sha: 'test-sha' });
    const hasEdge = graph.edges.some(e => e.from === 'cmd/main.go' && e.to === 'pkg/util.go');
    expect(hasEdge).toBe(true);
  });

  it('extracts Ruby require_relative', () => {
    const root = makeTmp();
    write(root, 'lib/helper.rb', `def help; end`);
    write(root, 'lib/main.rb', `require_relative 'helper'`);

    const graph = scanImports(root, { sha: 'test-sha' });
    const hasEdge = graph.edges.some(e => e.from === 'lib/main.rb' && e.to === 'lib/helper.rb');
    expect(hasEdge).toBe(true);
  });
});

// ── AC-3: impact() reverse-reachability and test-file association ──────────────

describe('AC-3: impact() transitive closure and test-file association', () => {
  it('returns direct importers of a changed file', () => {
    const root = makeTmp();
    write(root, 'src/a.ts', `export const a = 1;`);
    write(root, 'src/b.ts', `import { a } from './a.js';`);
    write(root, 'src/c.ts', `import { a } from './a.js';`);

    const graph = scanImports(root, { sha: 'test-sha' });
    const result = impact(graph, ['src/a.ts']);

    expect(result.files).toContain('src/b.ts');
    expect(result.files).toContain('src/c.ts');
  });

  it('returns transitive importers (a → b → c, change a → impact includes c)', () => {
    const root = makeTmp();
    write(root, 'src/a.ts', `export const a = 1;`);
    write(root, 'src/b.ts', `import { a } from './a.js'; export const b = 2;`);
    write(root, 'src/c.ts', `import { b } from './b.js';`);

    const graph = scanImports(root, { sha: 'test-sha' });
    const result = impact(graph, ['src/a.ts']);

    expect(result.files).toContain('src/b.ts');
    expect(result.files).toContain('src/c.ts');
  });

  it('includes test files by .test.ts naming convention', () => {
    const root = makeTmp();
    write(root, 'src/util.ts', `export const fn = () => {};`);
    write(root, 'src/util.test.ts', `import { fn } from './util.js';`);

    const graph = scanImports(root, { sha: 'test-sha' });
    const result = impact(graph, ['src/util.ts']);

    expect(result.testFiles).toContain('src/util.test.ts');
    expect(result.files).not.toContain('src/util.test.ts');
  });

  it('includes test files by .spec.ts naming convention', () => {
    const root = makeTmp();
    write(root, 'src/util.ts', `export const fn = () => {};`);
    write(root, 'src/util.spec.ts', `import { fn } from './util.js';`);

    const graph = scanImports(root, { sha: 'test-sha' });
    const result = impact(graph, ['src/util.ts']);

    expect(result.testFiles).toContain('src/util.spec.ts');
  });

  it('includes test files from tests/ directory that import the impacted file', () => {
    const root = makeTmp();
    write(root, 'src/core.ts', `export const core = 1;`);
    write(root, 'tests/core.test.ts', `import { core } from '../src/core.js';`);

    const graph = scanImports(root, { sha: 'test-sha' });
    const result = impact(graph, ['src/core.ts']);

    expect(result.testFiles).toContain('tests/core.test.ts');
  });

  it('returns empty for a file not in the graph', () => {
    const root = makeTmp();
    write(root, 'src/a.ts', `export const a = 1;`);

    const graph = scanImports(root, { sha: 'test-sha' });
    const result = impact(graph, ['src/nonexistent.ts']);

    expect(result.files).toHaveLength(0);
    expect(result.testFiles).toHaveLength(0);
  });

  it('handles an empty files array', () => {
    const root = makeTmp();
    write(root, 'src/a.ts', `export const a = 1;`);

    const graph = scanImports(root, { sha: 'test-sha' });
    const result = impact(graph, []);

    expect(result.files).toHaveLength(0);
    expect(result.testFiles).toHaveLength(0);
  });
});

// ── AC-4: False positives pinned (comments/strings), never false negatives ────

describe('AC-4: Comment/string false-positives accepted; plain imports never missed', () => {
  it('never misses a plain static import', () => {
    const root = makeTmp();
    write(root, 'src/target.ts', `export const t = 1;`);
    write(root, 'src/importer.ts', [
      `// some comment`,
      `import { t } from './target.js';`,
    ].join('\n'));

    const graph = scanImports(root, { sha: 'test-sha' });
    expect(graph.edges).toContainEqual({ from: 'src/importer.ts', to: 'src/target.ts' });
  });

  it('may include an import inside a comment as a false-positive (accepted)', () => {
    const root = makeTmp();
    write(root, 'src/ghost.ts', `export const g = 1;`);
    write(root, 'src/file.ts', [
      `// import { g } from './ghost.js';`,
      `export const x = 1;`,
    ].join('\n'));

    // This is a known accepted false-positive direction: it MAY appear in edges.
    // The test pins that it never causes a throw and we get a valid graph.
    const graph = scanImports(root, { sha: 'test-sha' });
    expect(graph).toBeDefined();
    expect(graph.edges).toBeDefined();
  });

  it('never misses an import that follows a line comment', () => {
    const root = makeTmp();
    write(root, 'src/real.ts', `export const r = 1;`);
    write(root, 'src/consumer.ts', [
      `// import { fake } from './fake';`,
      `import { r } from './real.js';`,
    ].join('\n'));

    const graph = scanImports(root, { sha: 'test-sha' });
    expect(graph.edges).toContainEqual({ from: 'src/consumer.ts', to: 'src/real.ts' });
  });

  it('captures both forms in the same file without false-negatives', () => {
    const root = makeTmp();
    write(root, 'src/a.ts', `export const a = 1;`);
    write(root, 'src/b.ts', `export const b = 2;`);
    write(root, 'src/main.ts', [
      `import { a } from './a.js';`,
      `const x = require('./b.js');`,
    ].join('\n'));

    const graph = scanImports(root, { sha: 'test-sha' });
    expect(graph.edges).toContainEqual({ from: 'src/main.ts', to: 'src/a.ts' });
    expect(graph.edges).toContainEqual({ from: 'src/main.ts', to: 'src/b.ts' });
  });
});

// ── AC-5: Determinism — identical rescan = identical graph ───────────────────

describe('AC-5: Determinism and scannedAtSha', () => {
  it('re-scanning an unchanged tree yields identical edges', () => {
    const root = makeTmp();
    write(root, 'src/a.ts', `export const a = 1;`);
    write(root, 'src/b.ts', `import { a } from './a.js';`);
    write(root, 'src/c.ts', `import { a } from './a.js'; import { b } from './b.js';`);

    const g1 = scanImports(root, { sha: 'fixed-sha' });
    const g2 = scanImports(root, { sha: 'fixed-sha' });

    expect(g1.edges).toEqual(g2.edges);
    expect(g1.scannedAtSha).toBe(g2.scannedAtSha);
  });

  it('opts.sha is reflected in scannedAtSha', () => {
    const root = makeTmp();
    write(root, 'src/a.ts', `export const a = 1;`);

    const graph = scanImports(root, { sha: 'abc123' });
    expect(graph.scannedAtSha).toBe('abc123');
  });

  it('edges are sorted deterministically (from asc, then to asc)', () => {
    const root = makeTmp();
    write(root, 'src/z.ts', `export const z = 1;`);
    write(root, 'src/a.ts', `export const a = 1;`);
    write(root, 'src/main.ts', [
      `import { z } from './z.js';`,
      `import { a } from './a.js';`,
    ].join('\n'));

    const graph = scanImports(root, { sha: 'test-sha' });
    const mainEdges = graph.edges.filter(e => e.from === 'src/main.ts');
    expect(mainEdges[0]?.to).toBe('src/a.ts');
    expect(mainEdges[1]?.to).toBe('src/z.ts');
  });

  it('scannedAtSha changes reflect a changed edge after re-scan', () => {
    const root = makeTmp();
    write(root, 'src/a.ts', `export const a = 1;`);
    write(root, 'src/b.ts', `export const b = 2;`);
    write(root, 'src/main.ts', `import { a } from './a.js';`);

    const g1 = scanImports(root, { sha: 'sha-before' });
    const mainEdgesBefore = g1.edges.filter(e => e.from === 'src/main.ts');
    expect(mainEdgesBefore.some(e => e.to === 'src/b.ts')).toBe(false);

    // Add a new import
    write(root, 'src/main.ts', `import { a } from './a.js';\nimport { b } from './b.js';`);
    const g2 = scanImports(root, { sha: 'sha-after' });
    const mainEdgesAfter = g2.edges.filter(e => e.from === 'src/main.ts');
    expect(mainEdgesAfter.some(e => e.to === 'src/b.ts')).toBe(true);
    expect(g2.scannedAtSha).toBe('sha-after');
  });

  it('impact() output is stably sorted', () => {
    const root = makeTmp();
    write(root, 'src/shared.ts', `export const s = 1;`);
    write(root, 'src/z-consumer.ts', `import { s } from './shared.js';`);
    write(root, 'src/a-consumer.ts', `import { s } from './shared.js';`);
    write(root, 'src/m-consumer.ts', `import { s } from './shared.js';`);

    const graph = scanImports(root, { sha: 'test-sha' });
    const r1 = impact(graph, ['src/shared.ts']);
    const r2 = impact(graph, ['src/shared.ts']);

    expect(r1.files).toEqual(r2.files);
    const sorted = [...r1.files].sort();
    expect(r1.files).toEqual(sorted);
  });
});

// ── AC-6: Skips node_modules/.git/binary, bounded file size, no throws ───────

describe('AC-6: Exclusions, file-size guard, no throws on weird input', () => {
  it('skips node_modules directory', () => {
    const root = makeTmp();
    write(root, 'src/app.ts', `export const app = 1;`);
    write(root, 'node_modules/pkg/index.ts', `import { app } from '../../src/app.js';`);

    const graph = scanImports(root, { sha: 'test-sha' });
    const fromNodeModules = graph.edges.filter(e => e.from.startsWith('node_modules/'));
    expect(fromNodeModules).toHaveLength(0);
  });

  it('skips .git directory', () => {
    const root = makeTmp();
    write(root, 'src/app.ts', `export const app = 1;`);
    write(root, '.git/SOME_HOOK', `#!/bin/sh\nimport x from './src/app.ts';`);

    const graph = scanImports(root, { sha: 'test-sha' });
    const fromGit = graph.edges.filter(e => e.from.startsWith('.git/'));
    expect(fromGit).toHaveLength(0);
  });

  it('skips files above maxFileBytes', () => {
    const root = makeTmp();
    const bigContent = `import { x } from './target.js';\n` + 'x'.repeat(600 * 1024);
    write(root, 'src/target.ts', `export const x = 1;`);
    write(root, 'src/big.ts', bigContent);

    const graph = scanImports(root, { sha: 'test-sha', maxFileBytes: 100 });
    const fromBig = graph.edges.filter(e => e.from === 'src/big.ts');
    expect(fromBig).toHaveLength(0);
  });

  it('never throws on a file with unusual encoding', () => {
    const root = makeTmp();
    // Write binary-ish bytes that are valid latin1 but odd utf8
    const buf = Buffer.from([0xff, 0xfe, 0x00, 0x69, 0x00, 0x6d, 0x00, 0x70]);
    writeFileSync(join(root, 'weird.ts'), buf);
    write(root, 'src/normal.ts', `export const x = 1;`);

    expect(() => scanImports(root, { sha: 'test-sha' })).not.toThrow();
  });

  it('never throws on an empty file', () => {
    const root = makeTmp();
    write(root, 'src/empty.ts', ``);
    expect(() => scanImports(root, { sha: 'test-sha' })).not.toThrow();
  });

  it('does not include binary extension files in scan', () => {
    const root = makeTmp();
    write(root, 'src/app.ts', `export const app = 1;`);
    mkdirSync(join(root, 'assets'), { recursive: true });
    writeFileSync(join(root, 'assets/img.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    const graph = scanImports(root, { sha: 'test-sha' });
    const fromPng = graph.edges.filter(e => e.from.endsWith('.png'));
    expect(fromPng).toHaveLength(0);
  });

  it('skips bare module specifiers (no edges to node packages)', () => {
    const root = makeTmp();
    write(root, 'src/app.ts', `import { readFile } from 'node:fs'; import express from 'express';`);

    const graph = scanImports(root, { sha: 'test-sha' });
    // No edges should have a bare specifier as 'to'
    const bareEdges = graph.edges.filter(e => !e.to.includes('/') || e.to.startsWith('node:'));
    expect(bareEdges).toHaveLength(0);
  });
});

// ── FIX-1: source files under build/ dir are scanned by default ──────────────

describe('FIX-1: default skip set is node_modules + .git only', () => {
  it('scans a source file under a dir named build/', () => {
    const root = makeTmp();
    write(root, 'src/a.ts', `export const a = 1;`);
    write(root, 'build/x.ts', `import { a } from '../src/a.js';`);

    const graph = scanImports(root, { sha: 'test-sha' });
    expect(graph.edges).toContainEqual({ from: 'build/x.ts', to: 'src/a.ts' });
  });

  it('skips build/ when listed in extraSkipDirs', () => {
    const root = makeTmp();
    write(root, 'src/a.ts', `export const a = 1;`);
    write(root, 'build/x.ts', `import { a } from '../src/a.js';`);

    const graph = scanImports(root, { sha: 'test-sha', extraSkipDirs: ['build'] });
    const fromBuild = graph.edges.filter(e => e.from.startsWith('build/'));
    expect(fromBuild).toHaveLength(0);
  });
});

// ── FIX: multiline / re-export / side-effect import forms ────────────────────

describe('static import edge cases pinned by spec', () => {
  it('resolves a multiline import (import {\\n a,\\n b\\n} from "./x")', () => {
    const root = makeTmp();
    write(root, 'src/x.ts', `export const a = 1; export const b = 2;`);
    write(root, 'src/consumer.ts', `import {\n  a,\n  b\n} from './x.js';`);

    const graph = scanImports(root, { sha: 'test-sha' });
    expect(graph.edges).toContainEqual({ from: 'src/consumer.ts', to: 'src/x.ts' });
  });

  it('produces an edge for export * from "./y"', () => {
    const root = makeTmp();
    write(root, 'src/y.ts', `export const y = 1;`);
    write(root, 'src/barrel.ts', `export * from './y.js';`);

    const graph = scanImports(root, { sha: 'test-sha' });
    expect(graph.edges).toContainEqual({ from: 'src/barrel.ts', to: 'src/y.ts' });
  });

  it('produces an edge for a side-effect import ("import \'./z\'")', () => {
    const root = makeTmp();
    write(root, 'src/z.ts', `console.log('side effect');`);
    write(root, 'src/main.ts', `import './z.js';`);

    const graph = scanImports(root, { sha: 'test-sha' });
    expect(graph.edges).toContainEqual({ from: 'src/main.ts', to: 'src/z.ts' });
  });
});

// ── impact() negative assertion: unrelated file absent from files ─────────────

describe('impact() negative: unrelated file not in result', () => {
  it('an unrelated file is absent from impact().files', () => {
    const root = makeTmp();
    write(root, 'src/a.ts', `export const a = 1;`);
    write(root, 'src/b.ts', `import { a } from './a.js';`);
    write(root, 'src/unrelated.ts', `export const unrelated = 42;`);

    const graph = scanImports(root, { sha: 'test-sha' });
    const result = impact(graph, ['src/a.ts']);

    // unrelated.ts imports nothing and is imported by nothing in this chain
    expect(result.files).not.toContain('src/unrelated.ts');
  });
});

// ── Cycle safety ──────────────────────────────────────────────────────────────

describe('Cycle safety', () => {
  it('handles a direct cycle without hanging or throwing', () => {
    const root = makeTmp();
    write(root, 'src/a.ts', `import { b } from './b.js'; export const a = 1;`);
    write(root, 'src/b.ts', `import { a } from './a.js'; export const b = 2;`);

    expect(() => scanImports(root, { sha: 'test-sha' })).not.toThrow();
    const graph = scanImports(root, { sha: 'test-sha' });
    expect(graph.edges).toContainEqual({ from: 'src/a.ts', to: 'src/b.ts' });
    expect(graph.edges).toContainEqual({ from: 'src/b.ts', to: 'src/a.ts' });
  });

  it('impact() handles a cycle without hanging', () => {
    const root = makeTmp();
    write(root, 'src/a.ts', `import { b } from './b.js'; export const a = 1;`);
    write(root, 'src/b.ts', `import { a } from './a.js'; export const b = 2;`);

    const graph = scanImports(root, { sha: 'test-sha' });

    let result: ReturnType<typeof impact> | undefined;
    expect(() => { result = impact(graph, ['src/a.ts']); }).not.toThrow();
    expect(result!.files).toContain('src/b.ts');
  });

  it('handles a 3-node cycle', () => {
    const root = makeTmp();
    write(root, 'src/a.ts', `import { c } from './c.js'; export const a = 1;`);
    write(root, 'src/b.ts', `import { a } from './a.js'; export const b = 2;`);
    write(root, 'src/c.ts', `import { b } from './b.js'; export const c = 3;`);

    const graph = scanImports(root, { sha: 'test-sha' });
    const result = impact(graph, ['src/a.ts']);
    expect(result.files).toContain('src/b.ts');
    expect(result.files).toContain('src/c.ts');
  });
});
