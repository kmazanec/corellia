/**
 * A sandboxed root runs under its commission's declared scripts: the tree's
 * CheckContext names them and runs them against the tree's worktree, while the
 * engine's default sandbox stays unchanged for the next tree.
 *
 * Real tmp git repo (mkdtemp + git init); zero network.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { runRootGoal } from '../../src/engine/root-runner.js';
import type { SandboxAssembly, SandboxConfig } from '../../src/engine/assembly.js';
import type { CheckContext } from '../../src/contract/goal-type.js';
import { MemoryEventStore, buildRegistry, makeGoal } from './stubs.js';
import type { Report } from '../../src/contract/report.js';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs.length = 0;
});

function repoWithSmokeCheck(): string {
  const dir = mkdtempSync(join(tmpdir(), 'corellia-tree-sandbox-'));
  dirs.push(dir);
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' });
  git('init');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test User');
  mkdirSync(join(dir, 'checks'));
  writeFileSync(join(dir, 'checks', 'smoke.mjs'), 'console.log("smoke ok");\n');
  git('add', '.');
  git('commit', '-m', 'init');
  return dir;
}

const emptyReport: Report = {
  artifact: { kind: 'text', text: 'done' },
  proof: [],
  lessons: [],
  memoriesUsed: [],
  blockers: [],
  findings: [],
} as unknown as Report;

describe('runRootGoal — per-tree declared scripts', () => {
  it("runs a commission-declared script through the tree's CheckContext", async () => {
    const repoRoot = repoWithSmokeCheck();
    const sandbox: SandboxConfig = { repoRoot, declaredScripts: {} };
    const goal = makeGoal({ id: 'tree-smoke', declaredScripts: { smoke: 'checks/smoke.mjs' } });
    let ctx: CheckContext | undefined;
    let assembly: SandboxAssembly | undefined;

    await runRootGoal({
      goal,
      sandbox,
      registry: buildRegistry([]),
      store: new MemoryEventStore(),
      now: () => Date.now(),
      setActiveAssembly: (a) => {
        assembly = a ?? assembly;
      },
      runTree: async () => {
        ctx = assembly?.checkContextFor(goal.id);
        const result = await ctx?.runScript?.('smoke');
        expect(result?.ok).toBe(true);
        expect(result?.output).toContain('smoke ok');
        return emptyReport;
      },
    });

    expect(ctx?.declaredScriptNames).toEqual(['smoke']);
    expect(sandbox.declaredScripts).toEqual({});
  });
});
