/**
 * The worktree shell is scope-checked after each call: paths a call newly
 * pushes outside the calling goal's scope are logged as `scope-escaped` and
 * named back to the leaf; pre-existing dirt (a sibling's work) and in-scope
 * writes are not attributed to it, and nothing is reverted.
 *
 * Real tmp git repo (mkdtemp + git init); zero network.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { scopeWatchedTool } from '../../src/engine/scope-watch.js';
import { InMemoryEventStore } from '../../src/eventlog/memory-store.js';
import type { ToolImpl } from '../../src/contract/tool.js';
import { makeGoal } from './stubs.js';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs.length = 0;
});

function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'corellia-scope-watch-'));
  dirs.push(dir);
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' });
  git('init');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test User');
  writeFileSync(join(dir, 'README.md'), '# repo\n');
  git('add', '.');
  git('commit', '-m', 'init');
  return dir;
}

function writeAt(root: string, rel: string, body: string): void {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), body);
}

/** A stand-in shell whose "command" writes the paths it is given. */
function writingShell(root: string): ToolImpl {
  return {
    def: { name: 'run_command', description: 'test shell', parameters: {} } as unknown as ToolImpl['def'],
    async execute(_goal, args) {
      for (const rel of args['writes'] as string[]) writeAt(root, rel, 'x\n');
      return { ok: true, output: 'command output' };
    },
  };
}

describe('scopeWatchedTool', () => {
  it('logs and names a path the call pushed outside scope, without reverting it', async () => {
    const root = makeRepo();
    const store = new InMemoryEventStore();
    const tool = scopeWatchedTool(writingShell(root), root, store, () => 1);
    const goal = makeGoal({ id: 'leaf-1', scope: ['src/'] });

    const result = await tool.execute(goal, { writes: ['src/ok.ts', 'README.md'] });

    expect(result.ok).toBe(true);
    expect(result.output).toMatch(/^SCOPE ESCAPE: .*README\.md/);
    expect(result.output).toContain('command output');
    const events = (await store.list()).filter((e) => e.type === 'scope-escaped');
    expect(events).toEqual([
      { type: 'scope-escaped', at: 1, goalId: 'leaf-1', source: 'run_command', scope: ['src/'], paths: ['README.md'] },
    ]);
    expect(existsSync(join(root, 'src/ok.ts'))).toBe(true);
  });

  it("does not attribute pre-existing out-of-scope dirt (a sibling's work) to the call", async () => {
    const root = makeRepo();
    writeAt(root, 'docs/sibling.md', 'sibling work\n');
    const store = new InMemoryEventStore();
    const tool = scopeWatchedTool(writingShell(root), root, store, () => 1);

    const result = await tool.execute(makeGoal({ scope: ['src/'] }), { writes: ['src/a.ts'] });

    expect(result.output).toBe('command output');
    expect((await store.list()).filter((e) => e.type === 'scope-escaped')).toHaveLength(0);
  });
});
