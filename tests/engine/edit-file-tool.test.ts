import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createFileTools } from '../../src/engine/tools.js';
import type { Goal } from '../../src/contract/goal.js';

let tmpDirs: string[] = [];
function makeRoot(): string {
  const d = mkdtempSync(join(tmpdir(), 'corellia-edit-'));
  tmpDirs.push(d);
  mkdirSync(join(d, 'src'), { recursive: true });
  return d;
}
afterEach(() => {
  for (const d of tmpDirs) {
    try { rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
  }
  tmpDirs = [];
});

function goalScoped(scope: string[]): Goal {
  return {
    id: 'g', type: 'implement', parentId: null, title: 't', spec: {},
    intent: 'production', scope,
    budget: { attempts: 1, tokens: 1, toolCalls: 1, wallClockMs: 1 }, memories: [],
  };
}

describe('edit_file tool', () => {
  it('replaces a unique string without touching the rest of the file', async () => {
    const root = makeRoot();
    writeFileSync(join(root, 'src/x.ts'), 'const a = 1;\nconst b = 2;\nconst c = 3;\n');
    const { editFile } = createFileTools(root);

    const r = await editFile.execute(goalScoped(['src/']), {
      path: 'src/x.ts', old_string: 'const b = 2;', new_string: 'const b = 22;',
    });

    expect(r.ok).toBe(true);
    expect(readFileSync(join(root, 'src/x.ts'), 'utf-8')).toBe('const a = 1;\nconst b = 22;\nconst c = 3;\n');
  });

  it('appends a line via insert (new_string contains old_string)', async () => {
    const root = makeRoot();
    writeFileSync(join(root, 'src/log.md'), '# log\n- one\n');
    const { editFile } = createFileTools(root);

    const r = await editFile.execute(goalScoped(['src/']), {
      path: 'src/log.md', old_string: '- one\n', new_string: '- one\n- two\n',
    });

    expect(r.ok).toBe(true);
    expect(readFileSync(join(root, 'src/log.md'), 'utf-8')).toBe('# log\n- one\n- two\n');
  });

  it('refuses when old_string occurs more than once', async () => {
    const root = makeRoot();
    writeFileSync(join(root, 'src/x.ts'), 'x\nx\n');
    const { editFile } = createFileTools(root);
    const r = await editFile.execute(goalScoped(['src/']), { path: 'src/x.ts', old_string: 'x', new_string: 'y' });
    expect(r.ok).toBe(false);
    expect(r.output).toContain('more than once');
  });

  it('replace_all replaces every occurrence and reports the count', async () => {
    const root = makeRoot();
    writeFileSync(join(root, 'src/x.ts'), 'foo\nfoo\nbar\nfoo\n');
    const { editFile } = createFileTools(root);
    const r = await editFile.execute(goalScoped(['src/']), {
      path: 'src/x.ts', old_string: 'foo', new_string: 'baz', replace_all: true,
    });
    expect(r.ok).toBe(true);
    expect(r.output).toContain('3 occurrences');
    expect(readFileSync(join(root, 'src/x.ts'), 'utf-8')).toBe('baz\nbaz\nbar\nbaz\n');
  });

  it('replace_all still fails when old_string is absent', async () => {
    const root = makeRoot();
    writeFileSync(join(root, 'src/x.ts'), 'nothing here\n');
    const { editFile } = createFileTools(root);
    const r = await editFile.execute(goalScoped(['src/']), {
      path: 'src/x.ts', old_string: 'zzz', new_string: 'y', replace_all: true,
    });
    expect(r.ok).toBe(false);
    expect(r.output).toContain('not found');
  });

  it('refuses when old_string is not found', async () => {
    const root = makeRoot();
    writeFileSync(join(root, 'src/x.ts'), 'hello\n');
    const { editFile } = createFileTools(root);
    const r = await editFile.execute(goalScoped(['src/']), { path: 'src/x.ts', old_string: 'nope', new_string: 'y' });
    expect(r.ok).toBe(false);
    expect(r.output).toContain('not found');
  });

  it('refuses a path outside the declared scope', async () => {
    const root = makeRoot();
    writeFileSync(join(root, 'src/x.ts'), 'a\n');
    const { editFile } = createFileTools(root);
    const r = await editFile.execute(goalScoped(['docs/']), { path: 'src/x.ts', old_string: 'a', new_string: 'b' });
    expect(r.ok).toBe(false);
    expect(r.output).toContain('scope');
  });

  it('refuses a path that escapes the sandbox root', async () => {
    const root = makeRoot();
    const { editFile } = createFileTools(root);
    const r = await editFile.execute(goalScoped(['']), { path: '../escape.ts', old_string: 'a', new_string: 'b' });
    expect(r.ok).toBe(false);
    expect(r.output).toContain('outside the sandbox root');
  });

  it('refuses editing a file that does not exist (steer to write_file)', async () => {
    const root = makeRoot();
    const { editFile } = createFileTools(root);
    const r = await editFile.execute(goalScoped(['src/']), { path: 'src/new.ts', old_string: 'a', new_string: 'b' });
    expect(r.ok).toBe(false);
    expect(r.output).toContain('write_file');
  });

  it('refuses identical old/new strings', async () => {
    const root = makeRoot();
    writeFileSync(join(root, 'src/x.ts'), 'a\n');
    const { editFile } = createFileTools(root);
    const r = await editFile.execute(goalScoped(['src/']), { path: 'src/x.ts', old_string: 'a', new_string: 'a' });
    expect(r.ok).toBe(false);
    expect(r.output).toContain('identical');
  });
});
