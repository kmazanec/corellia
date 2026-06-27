/**
 * Tests for the four core file-system ToolImpl objects: read_file, write_file,
 * list_dir, and search — all bound to a sandbox root created per-test in
 * os.tmpdir(). Covers sandbox safety (traversal, absolute paths), scope
 * enforcement (write_file), and correct results for in-scope operations.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { createFileTools } from '../../src/engine/tools.js';
import type { Goal } from '../../src/contract/goal.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeGoal(overrides: Partial<Goal> = {}): Goal {
  return {
    id: 'g1',
    type: 'implement',
    parentId: null,
    title: 'test goal',
    spec: {},
    intent: 'production',
    scope: ['src/'],
    budget: { attempts: 3, tokens: 1000, toolCalls: 10, wallClockMs: 60000 },
    memories: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let sandboxRoot: string;

beforeEach(async () => {
  sandboxRoot = await mkdtemp(join(tmpdir(), 'corellia-tools-test-'));
  // Seed a directory structure.
  await mkdir(join(sandboxRoot, 'src'), { recursive: true });
  await mkdir(join(sandboxRoot, 'tests'), { recursive: true });
  await writeFile(join(sandboxRoot, 'src', 'index.ts'), 'export const answer = 42;\n');
  await writeFile(join(sandboxRoot, 'src', 'util.ts'), 'export function add(a: number, b: number) { return a + b; }\n');
  await writeFile(join(sandboxRoot, 'tests', 'index.test.ts'), 'import { answer } from "../src/index.js";\n');
});

afterEach(async () => {
  await rm(sandboxRoot, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// read_file
// ---------------------------------------------------------------------------

describe('read_file', () => {
  it('returns the content of an in-sandbox file', async () => {
    const { readFile } = createFileTools(sandboxRoot);
    const goal = makeGoal();
    const result = await readFile.execute(goal, { path: 'src/index.ts' });
    expect(result.ok).toBe(true);
    expect(result.output).toContain('answer = 42');
  });

  it('returns ok:false for a missing file', async () => {
    const { readFile } = createFileTools(sandboxRoot);
    const goal = makeGoal();
    const result = await readFile.execute(goal, { path: 'src/missing.ts' });
    expect(result.ok).toBe(false);
  });

  it('refuses an absolute path', async () => {
    const { readFile } = createFileTools(sandboxRoot);
    const goal = makeGoal();
    const result = await readFile.execute(goal, { path: '/etc/passwd' });
    expect(result.ok).toBe(false);
    expect(result.output).toContain('outside the sandbox root');
  });

  it('refuses a ../ traversal that escapes the root', async () => {
    const { readFile } = createFileTools(sandboxRoot);
    const goal = makeGoal();
    const result = await readFile.execute(goal, { path: '../../../etc/passwd' });
    expect(result.ok).toBe(false);
    expect(result.output).toContain('outside the sandbox root');
  });

  it('refuses a path that normalizes to escaping the root', async () => {
    const { readFile } = createFileTools(sandboxRoot);
    const goal = makeGoal();
    const result = await readFile.execute(goal, { path: 'src/../../etc/passwd' });
    expect(result.ok).toBe(false);
    expect(result.output).toContain('outside the sandbox root');
  });

  it('refuses an empty path', async () => {
    const { readFile } = createFileTools(sandboxRoot);
    const goal = makeGoal();
    const result = await readFile.execute(goal, { path: '' });
    expect(result.ok).toBe(false);
  });

  it('refuses a non-string path', async () => {
    const { readFile } = createFileTools(sandboxRoot);
    const goal = makeGoal();
    const result = await readFile.execute(goal, { path: 42 });
    expect(result.ok).toBe(false);
  });

  it('reads a deeply nested file', async () => {
    const { readFile } = createFileTools(sandboxRoot);
    await mkdir(join(sandboxRoot, 'src', 'deep', 'nested'), { recursive: true });
    await writeFile(join(sandboxRoot, 'src', 'deep', 'nested', 'file.ts'), 'hello');
    const goal = makeGoal();
    const result = await readFile.execute(goal, { path: 'src/deep/nested/file.ts' });
    expect(result.ok).toBe(true);
    expect(result.output).toBe('hello');
  });

  // ── ranged + large-file bounding (run live-self-bcc825bb context-thrash) ──
  it('returns a small whole file byte-identically (no range, no notice)', async () => {
    const { readFile } = createFileTools(sandboxRoot);
    await writeFile(join(sandboxRoot, 'src', 'small.ts'), 'a\nb\nc\n');
    const result = await readFile.execute(makeGoal(), { path: 'src/small.ts' });
    expect(result.ok).toBe(true);
    expect(result.output).toBe('a\nb\nc\n'); // exact — common case unchanged
  });

  it('returns only the requested line range with a range notice', async () => {
    const { readFile } = createFileTools(sandboxRoot);
    const body = Array.from({ length: 20 }, (_, i) => `line${i + 1}`).join('\n');
    await writeFile(join(sandboxRoot, 'src', 'ranged.ts'), body);
    const result = await readFile.execute(makeGoal(), { path: 'src/ranged.ts', offset: 5, limit: 3 });
    expect(result.ok).toBe(true);
    expect(result.output).toContain('line5\nline6\nline7');
    expect(result.output).not.toContain('line8');
    expect(result.output).toContain('lines 5-7 of 20');
  });

  it('auto-bounds a whole-file read of a large file and tells the model to page', async () => {
    const { readFile } = createFileTools(sandboxRoot);
    const body = Array.from({ length: 600 }, (_, i) => `L${i + 1}`).join('\n');
    await writeFile(join(sandboxRoot, 'src', 'huge.ts'), body);
    const result = await readFile.execute(makeGoal(), { path: 'src/huge.ts' });
    expect(result.ok).toBe(true);
    expect(result.output).toContain('L1\n');
    expect(result.output).toContain('L400'); // first chunk
    expect(result.output).not.toContain('L401');
    expect(result.output).toContain('file is 600 lines; showing 1-400');
    expect(result.output).toMatch(/offset=401/);
  });

  it('rejects a non-positive-integer offset/limit as a soft error', async () => {
    const { readFile } = createFileTools(sandboxRoot);
    await writeFile(join(sandboxRoot, 'src', 'r.ts'), 'x\n');
    const bad = await readFile.execute(makeGoal(), { path: 'src/r.ts', offset: 0 });
    expect(bad.ok).toBe(false);
    expect(bad.output).toContain('offset must be a positive integer');
    const bad2 = await readFile.execute(makeGoal(), { path: 'src/r.ts', limit: -3 });
    expect(bad2.ok).toBe(false);
    expect(bad2.output).toContain('limit must be a positive integer');
  });

  it('reports when offset is past end of file', async () => {
    const { readFile } = createFileTools(sandboxRoot);
    await writeFile(join(sandboxRoot, 'src', 'tiny.ts'), 'a\nb\n');
    const result = await readFile.execute(makeGoal(), { path: 'src/tiny.ts', offset: 99 });
    expect(result.ok).toBe(true);
    expect(result.output).toContain('past end of file');
  });
});

// ---------------------------------------------------------------------------
// list_dir
// ---------------------------------------------------------------------------

describe('list_dir', () => {
  it('returns entries for an in-sandbox directory', async () => {
    const { listDir } = createFileTools(sandboxRoot);
    const goal = makeGoal();
    const result = await listDir.execute(goal, { path: 'src' });
    expect(result.ok).toBe(true);
    expect(result.output).toContain('index.ts');
    expect(result.output).toContain('util.ts');
  });

  it('marks directories with a trailing slash', async () => {
    const { listDir } = createFileTools(sandboxRoot);
    await mkdir(join(sandboxRoot, 'src', 'subdir'), { recursive: true });
    const goal = makeGoal();
    const result = await listDir.execute(goal, { path: 'src' });
    expect(result.ok).toBe(true);
    expect(result.output).toContain('subdir/');
  });

  it('lists the root sandbox itself with path "."', async () => {
    const { listDir } = createFileTools(sandboxRoot);
    const goal = makeGoal();
    const result = await listDir.execute(goal, { path: '.' });
    expect(result.ok).toBe(true);
    expect(result.output).toContain('src/');
    expect(result.output).toContain('tests/');
  });

  it('refuses an absolute path', async () => {
    const { listDir } = createFileTools(sandboxRoot);
    const goal = makeGoal();
    const result = await listDir.execute(goal, { path: '/tmp' });
    expect(result.ok).toBe(false);
    expect(result.output).toContain('outside the sandbox root');
  });

  it('refuses a ../ traversal', async () => {
    const { listDir } = createFileTools(sandboxRoot);
    const goal = makeGoal();
    const result = await listDir.execute(goal, { path: '../' });
    expect(result.ok).toBe(false);
    expect(result.output).toContain('outside the sandbox root');
  });

  it('returns ok:false for a missing directory', async () => {
    const { listDir } = createFileTools(sandboxRoot);
    const goal = makeGoal();
    const result = await listDir.execute(goal, { path: 'nonexistent' });
    expect(result.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// write_file
// ---------------------------------------------------------------------------

describe('write_file', () => {
  it('writes an in-scope file', async () => {
    const { writeFile, readFile } = createFileTools(sandboxRoot);
    const goal = makeGoal({ scope: ['src/'] });
    const writeResult = await writeFile.execute(goal, { path: 'src/new.ts', content: 'export {}' });
    expect(writeResult.ok).toBe(true);
    // Verify the file was actually written.
    const readResult = await readFile.execute(goal, { path: 'src/new.ts' });
    expect(readResult.ok).toBe(true);
    expect(readResult.output).toBe('export {}');
  });

  it('refuses a path outside the goal scope', async () => {
    const { writeFile } = createFileTools(sandboxRoot);
    const goal = makeGoal({ scope: ['src/'] });
    const result = await writeFile.execute(goal, { path: 'tests/bad.ts', content: 'oops' });
    expect(result.ok).toBe(false);
    expect(result.output).toContain("outside the goal's declared scope");
    // Verify no file was created.
    const { readFile } = createFileTools(sandboxRoot);
    const check = await readFile.execute(goal, { path: 'tests/bad.ts' });
    expect(check.ok).toBe(false);
  });

  it('refuses an absolute path', async () => {
    const { writeFile } = createFileTools(sandboxRoot);
    const goal = makeGoal({ scope: ['src/'] });
    const result = await writeFile.execute(goal, { path: '/etc/evil', content: 'evil' });
    expect(result.ok).toBe(false);
    expect(result.output).toContain('outside the sandbox root');
  });

  it('refuses ../ traversal', async () => {
    const { writeFile } = createFileTools(sandboxRoot);
    const goal = makeGoal({ scope: ['src/'] });
    const result = await writeFile.execute(goal, { path: '../escaped.ts', content: 'evil' });
    expect(result.ok).toBe(false);
    expect(result.output).toContain('outside the sandbox root');
  });

  it('refuses a path that normalizes to escaping root', async () => {
    const { writeFile } = createFileTools(sandboxRoot);
    const goal = makeGoal({ scope: ['src/'] });
    const result = await writeFile.execute(goal, { path: 'src/../../escape.ts', content: 'evil' });
    expect(result.ok).toBe(false);
    expect(result.output).toContain('outside the sandbox root');
  });

  it('allows write when scope is empty (no scope restriction)', async () => {
    const { writeFile, readFile } = createFileTools(sandboxRoot);
    const goal = makeGoal({ scope: [] });
    const result = await writeFile.execute(goal, { path: 'src/any.ts', content: 'hello' });
    expect(result.ok).toBe(true);
    const check = await readFile.execute(goal, { path: 'src/any.ts' });
    expect(check.ok).toBe(true);
  });

  it('creates parent directories if needed', async () => {
    const { writeFile, readFile } = createFileTools(sandboxRoot);
    const goal = makeGoal({ scope: ['src/'] });
    const result = await writeFile.execute(goal, { path: 'src/new/dir/file.ts', content: 'deep' });
    expect(result.ok).toBe(true);
    const check = await readFile.execute(goal, { path: 'src/new/dir/file.ts' });
    expect(check.ok).toBe(true);
    expect(check.output).toBe('deep');
  });

  // Parametrized scope-normalization cases mirroring filesWithinScope suite.
  const scopeTable: Array<{ label: string; path: string; scope: string[]; expectOk: boolean }> = [
    { label: 'in scope: exact prefix match', path: 'src/index.ts', scope: ['src/'], expectOk: true },
    { label: 'in scope: nested path under prefix', path: 'src/deep/file.ts', scope: ['src/'], expectOk: true },
    { label: 'out of scope: different top-level dir', path: 'lib/file.ts', scope: ['src/'], expectOk: false },
    { label: 'out of scope: looks like prefix but not a directory boundary', path: 'srcX/file.ts', scope: ['src/'], expectOk: false },
    { label: 'in scope: multiple scope entries, matches second', path: 'tests/foo.ts', scope: ['src/', 'tests/'], expectOk: true },
    { label: 'out of scope: none of the scopes match', path: 'vendor/x.ts', scope: ['src/', 'tests/'], expectOk: false },
  ];

  for (const { label, path, scope, expectOk } of scopeTable) {
    it(`scope normalization — ${label}`, async () => {
      const { writeFile } = createFileTools(sandboxRoot);
      const goal = makeGoal({ scope });
      // Ensure directory exists for the write attempt.
      const { dirname } = await import('node:path');
      const { mkdir: mkdirFn } = await import('node:fs/promises');
      await mkdirFn(join(sandboxRoot, dirname(path)), { recursive: true });
      const result = await writeFile.execute(goal, { path, content: 'test' });
      expect(result.ok).toBe(expectOk);
    });
  }
});

// ---------------------------------------------------------------------------
// delete_file
// ---------------------------------------------------------------------------

describe('delete_file', () => {
  it('deletes an in-scope file', async () => {
    const { deleteFile, readFile } = createFileTools(sandboxRoot);
    const goal = makeGoal({ scope: ['src/'] });
    const result = await deleteFile.execute(goal, { path: 'src/util.ts' });
    expect(result.ok).toBe(true);
    expect(result.output).toContain('deleted src/util.ts');
    // Verify the file is gone.
    const check = await readFile.execute(goal, { path: 'src/util.ts' });
    expect(check.ok).toBe(false);
  });

  it('refuses a path outside the goal scope', async () => {
    const { deleteFile, readFile } = createFileTools(sandboxRoot);
    const goal = makeGoal({ scope: ['src/'] });
    const result = await deleteFile.execute(goal, { path: 'tests/index.test.ts' });
    expect(result.ok).toBe(false);
    expect(result.output).toContain("outside the goal's declared scope");
    // Verify the file still exists.
    const check = await readFile.execute(goal, { path: 'tests/index.test.ts' });
    expect(check.ok).toBe(true);
  });

  it('refuses an absolute path', async () => {
    const { deleteFile } = createFileTools(sandboxRoot);
    const goal = makeGoal({ scope: ['src/'] });
    const result = await deleteFile.execute(goal, { path: '/etc/passwd' });
    expect(result.ok).toBe(false);
    expect(result.output).toContain('outside the sandbox root');
  });

  it('refuses ../ traversal', async () => {
    const { deleteFile } = createFileTools(sandboxRoot);
    const goal = makeGoal({ scope: ['src/'] });
    const result = await deleteFile.execute(goal, { path: '../escaped.ts' });
    expect(result.ok).toBe(false);
    expect(result.output).toContain('outside the sandbox root');
  });

  it('returns ok:false for a missing file', async () => {
    const { deleteFile } = createFileTools(sandboxRoot);
    const goal = makeGoal({ scope: ['src/'] });
    const result = await deleteFile.execute(goal, { path: 'src/nope.ts' });
    expect(result.ok).toBe(false);
  });

  it('refuses to delete a directory', async () => {
    const { deleteFile } = createFileTools(sandboxRoot);
    // Empty scope so the scope check is not what trips it — the directory guard is.
    const goal = makeGoal({ scope: [] });
    const result = await deleteFile.execute(goal, { path: 'src' });
    expect(result.ok).toBe(false);
    expect(result.output).toContain('is a directory');
  });

  it('refuses an empty path', async () => {
    const { deleteFile } = createFileTools(sandboxRoot);
    const goal = makeGoal({ scope: ['src/'] });
    const result = await deleteFile.execute(goal, { path: '' });
    expect(result.ok).toBe(false);
    expect(result.output).toContain('non-empty string');
  });
});

// ---------------------------------------------------------------------------
// search
// ---------------------------------------------------------------------------

describe('search', () => {
  it('returns path:line-prefixed matches', async () => {
    const { search } = createFileTools(sandboxRoot);
    const goal = makeGoal();
    const result = await search.execute(goal, { pattern: 'answer' });
    expect(result.ok).toBe(true);
    // Should match src/index.ts line 1
    expect(result.output).toMatch(/src.index\.ts:1:/);
    expect(result.output).toContain('answer');
  });

  it('returns empty output for no matches', async () => {
    const { search } = createFileTools(sandboxRoot);
    const goal = makeGoal();
    const result = await search.execute(goal, { pattern: 'zzz_no_match_zzz' });
    expect(result.ok).toBe(true);
    expect(result.output).toBe('');
  });

  it('searches only within the specified sub-path', async () => {
    const { search } = createFileTools(sandboxRoot);
    const goal = makeGoal();
    // 'import' appears in tests/ but not in src/index.ts
    const result = await search.execute(goal, { pattern: 'import', path: 'src' });
    expect(result.ok).toBe(true);
    // src/index.ts has no import; src/util.ts has no import either
    expect(result.output).not.toContain('index.test.ts');
  });

  it('finds matches in multiple files', async () => {
    const { search } = createFileTools(sandboxRoot);
    const goal = makeGoal();
    // 'export' appears in both src/index.ts and src/util.ts
    const result = await search.execute(goal, { pattern: 'export' });
    expect(result.ok).toBe(true);
    expect(result.output).toContain('src' + sep + 'index.ts');
    expect(result.output).toContain('src' + sep + 'util.ts');
  });

  it('refuses an absolute search path', async () => {
    const { search } = createFileTools(sandboxRoot);
    const goal = makeGoal();
    const result = await search.execute(goal, { pattern: 'export', path: '/etc' });
    expect(result.ok).toBe(false);
    expect(result.output).toContain('outside the sandbox root');
  });

  it('refuses a ../ traversal in path', async () => {
    const { search } = createFileTools(sandboxRoot);
    const goal = makeGoal();
    const result = await search.execute(goal, { pattern: 'export', path: '../' });
    expect(result.ok).toBe(false);
    expect(result.output).toContain('outside the sandbox root');
  });

  it('returns ok:true with empty output for a non-existent search path', async () => {
    const { search } = createFileTools(sandboxRoot);
    const goal = makeGoal();
    const result = await search.execute(goal, { pattern: 'export', path: 'nonexistent' });
    expect(result.ok).toBe(true);
    expect(result.output).toBe('');
  });

  it('handles a regex pattern', async () => {
    const { search } = createFileTools(sandboxRoot);
    const goal = makeGoal();
    const result = await search.execute(goal, { pattern: 'answer\\s*=\\s*\\d+' });
    expect(result.ok).toBe(true);
    expect(result.output).toContain('answer');
  });

  it('never throws on binary-like or unreadable content', async () => {
    const { search } = createFileTools(sandboxRoot);
    // Write a file with null bytes (binary-like).
    await writeFile(join(sandboxRoot, 'src', 'binary.bin'), Buffer.from([0x00, 0x01, 0x02]));
    const goal = makeGoal();
    // Should not throw; just skips or returns empty for that file.
    await expect(search.execute(goal, { pattern: 'anything' })).resolves.toBeDefined();
  });

  it('returns ok:false for an empty pattern', async () => {
    const { search } = createFileTools(sandboxRoot);
    const goal = makeGoal();
    const result = await search.execute(goal, { pattern: '' });
    expect(result.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// head_sha
// ---------------------------------------------------------------------------

describe('head_sha', () => {
  it('returns the current HEAD SHA of the sandbox git repo', async () => {
    const { execFileSync } = await import('node:child_process');
    const opts = { cwd: sandboxRoot, stdio: 'ignore' as const };
    execFileSync('git', ['init', '-q'], opts);
    execFileSync('git', ['config', 'user.email', 't@t.t'], opts);
    execFileSync('git', ['config', 'user.name', 'T'], opts);
    execFileSync('git', ['add', '-A'], opts);
    execFileSync('git', ['commit', '-q', '-m', 'init'], opts);
    const expected = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: sandboxRoot, encoding: 'utf-8',
    }).trim();

    const { headSha } = createFileTools(sandboxRoot);
    const result = await headSha.execute(makeGoal(), {});
    expect(result.ok).toBe(true);
    expect(result.output).toBe(expected);
    expect(result.output).toMatch(/^[0-9a-f]{40}$/);
  });

  it('returns ok:false when the sandbox is not a git repo', async () => {
    // sandboxRoot is a bare temp dir (no git init) in this test.
    const { headSha } = createFileTools(sandboxRoot);
    const result = await headSha.execute(makeGoal(), {});
    expect(result.ok).toBe(false);
    expect(result.output).toContain('head_sha');
  });
});
