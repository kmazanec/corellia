/**
 * Tests for ScriptRunner and related utilities.
 *
 * Fixture mini-repos live in os.tmpdir(). Scripts are real node one-liners
 * invoked via node -e; no spawn mocking — exit-status truth and the kill are
 * the load-bearing behaviors.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  createScriptRunner,
  validateScriptTarget,
  verifyEntryPoints,
  runScriptTool,
  loggingScriptRunner,
  createCommandRunner,
  runCommandTool,
  loggingCommandRunner,
  networkCommandBlock,
  OUTPUT_TRUNCATION_CAP,
} from '../../src/library/script-runner.js';
import { InMemoryEventStore } from '../../src/eventlog/memory-store.js';
import type { FactoryEvent } from '../../src/contract/events.js';
import type { Goal } from '../../src/contract/goal.js';

// ── Fixture helpers ───────────────────────────────────────────────────────────

let tmpDirs: string[] = [];

function makeTmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'corellia-sr-'));
  tmpDirs.push(d);
  return d;
}

afterEach(() => {
  for (const d of tmpDirs) {
    try { rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
  }
  tmpDirs = [];
});

/**
 * Write a node script file to disk and return its relative path.
 * Uses `node -e <code>` via a wrapper so we don't need a shebang.
 */
function writeScript(dir: string, name: string, nodeCode: string): string {
  const rel = `scripts/${name}.mjs`;
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  // Write as a real .mjs module so node can run it directly.
  writeFileSync(join(dir, rel), nodeCode, 'utf8');
  return rel;
}

/** Build a minimal Goal fixture. */
const baseGoal: Goal = {
  id: 'g-test',
  type: 'implement',
  parentId: null,
  title: 'Test goal',
  spec: {},
  intent: 'production',
  scope: ['src/'],
  budget: { attempts: 3, tokens: 1000, toolCalls: 10, wallClockMs: 60_000 },
  memories: [],
};

// ── Chunk 1: ScriptRunner core ───────────────────────────────────────────────

describe('npm-script declared entries', () => {
  it('runs an npm-script:<name> entry via the package manager, shell-free', async () => {
    const repo = mkdtempSync(join(tmpdir(), 'runner-npm-'));
    writeFileSync(join(repo, 'package.json'), JSON.stringify({
      name: 'fixture', version: '0.0.0',
      scripts: { ok: 'node -e "process.exit(0)"', bad: 'node -e "process.exit(3)"' },
    }));
    const runner = createScriptRunner(repo, { ok: 'npm-script:ok', bad: 'npm-script:bad' });
    const green = await runner.run('ok', undefined, 60_000);
    expect(green.exitStatus).toBe(0);
    const red = await runner.run('bad', undefined, 60_000);
    expect(red.exitStatus).toBe(3);
    rmSync(repo, { recursive: true, force: true });
  });

  it('appends a validated target to the args (echoed back by the script)', async () => {
    const repoRoot = makeTmp();
    // Script echoes its argv tail so we can confirm the target was forwarded.
    const rel = writeScript(repoRoot, 'echo', `process.stdout.write(process.argv.slice(2).join(' '));`);
    const runner = createScriptRunner(repoRoot, { echo: rel });
    const result = await runner.run('echo', 'tests/util/x.test.ts');
    expect(result.ok).toBe(true);
    expect(result.output).toContain('tests/util/x.test.ts');
  });

  it('refuses an invalid target (shell metacharacters / traversal) with no spawn', async () => {
    const repoRoot = makeTmp();
    const rel = writeScript(repoRoot, 'echo', `process.stdout.write('ran');`);
    const runner = createScriptRunner(repoRoot, { echo: rel });
    for (const bad of ['../etc/passwd', 'a; rm -rf /', '/abs/path', '$(whoami)', 'a && b']) {
      const result = await runner.run('echo', bad);
      expect(result.ok).toBe(false);
      expect(result.exitStatus).toBeNull();
      expect(result.output).toContain('Invalid script target');
    }
  });
});

describe('make:<target> declared entries (stack-agnostic verify)', () => {
  it('runs a make:<target> entry via `make`, shell-free', async () => {
    const repo = makeTmp();
    // A Makefile with a green and a red target — proves exit status is captured.
    writeFileSync(
      join(repo, 'Makefile'),
      'test:\n\t@echo cats-test-ran\n\nfail:\n\t@exit 4\n',
      'utf8',
    );
    const runner = createScriptRunner(repo, { test: 'make:test', fail: 'make:fail' });

    const green = await runner.run('test', undefined, 60_000);
    expect(green.ok).toBe(true);
    expect(green.exitStatus).toBe(0);
    expect(green.output).toContain('cats-test-ran');

    const red = await runner.run('fail', undefined, 60_000);
    expect(red.ok).toBe(false);
    // make exits non-zero (its own code 2) when a recipe fails — the runner
    // surfaces that as ok:false. We assert the failure is captured, not make's
    // exact code, which is make's contract, not ours.
    expect(red.exitStatus).not.toBe(0);
    expect(red.exitStatus).not.toBeNull();
  });

  it('passes the validated target to make as a second GOAL — not a recipe arg', async () => {
    // HONEST behavior (AC-4 cats run #1 finding 3): unlike npm's `--`, make has no
    // way to forward a positional arg INTO a recipe — `make test <path>` makes
    // <path> a second goal. With a catch-all `%:` rule the extra goal is absorbed
    // (the target reaches make's argv, here echoed via MAKECMDGOALS); WITHOUT one,
    // a real Makefile errors "No rule to make target". So `make:` targeting is
    // effectively whole-target-only; callers should not rely on per-file targeting.
    const repo = makeTmp();
    writeFileSync(
      join(repo, 'Makefile'),
      'test:\n\t@echo goals=$(MAKECMDGOALS)\n\n%:\n\t@:\n',
      'utf8',
    );
    const runner = createScriptRunner(repo, { test: 'make:test' });
    const result = await runner.run('test', 'tests/unit/x.py');
    expect(result.ok).toBe(true);
    // The path reached make's argv as a goal (the recipe did not receive it as an arg).
    expect(result.output).toContain('tests/unit/x.py');
  });

  it('a target against a Makefile with no catch-all rule fails (target is an unknown goal)', async () => {
    // The real-world case that bit cats: no `%:` rule, so the extra goal has no
    // rule and make exits non-zero. Documents why the harness declares whole
    // targets and does not lean on per-file targeting through make.
    const repo = makeTmp();
    writeFileSync(join(repo, 'Makefile'), 'test:\n\t@echo ran\n', 'utf8');
    const runner = createScriptRunner(repo, { test: 'make:test' });
    const result = await runner.run('test', 'tests/unit/x.py');
    expect(result.ok).toBe(false);
    expect(result.exitStatus).not.toBe(0);
  });

  it('refuses an invalid target (shell metacharacters) with no spawn', async () => {
    const repo = makeTmp();
    writeFileSync(join(repo, 'Makefile'), 'test:\n\t@echo ran\n', 'utf8');
    const runner = createScriptRunner(repo, { test: 'make:test' });
    const result = await runner.run('test', 'a; rm -rf /');
    expect(result.ok).toBe(false);
    expect(result.exitStatus).toBeNull();
    expect(result.output).toContain('Invalid script target');
  });
});

describe('validateScriptTarget', () => {
  it('accepts relative in-repo paths and patterns', () => {
    for (const ok of ['tests/util/x.test.ts', 'src/a.py', 'tests/**/*.spec.js', 'a_b-c.test.ts']) {
      expect(validateScriptTarget(ok)).toBe(ok);
    }
  });
  it('rejects absolute, traversal, and shell-metachar targets', () => {
    for (const bad of ['/abs', '~/x', '../up', 'a/../b', 'a b', 'a;b', 'a|b', 'a$(x)', 'a`b`', '']) {
      expect(validateScriptTarget(bad)).toBeNull();
    }
  });
});

describe('createScriptRunner — green script', () => {
  it('returns ok:true with exit status 0 and captured output', async () => {
    const repoRoot = makeTmp();
    const rel = writeScript(repoRoot, 'green', `process.stdout.write('hello world\\n');`);
    const runner = createScriptRunner(repoRoot, { green: rel });

    const result = await runner.run('green');

    expect(result.ok).toBe(true);
    expect(result.exitStatus).toBe(0);
    expect(result.timedOut).toBe(false);
    expect(result.output).toContain('hello world');
    expect(result.fullOutput).toContain('hello world');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });
});

describe('createScriptRunner — red script', () => {
  it('returns ok:false with non-zero exit status', async () => {
    const repoRoot = makeTmp();
    const rel = writeScript(repoRoot, 'red', `process.exit(1);`);
    const runner = createScriptRunner(repoRoot, { red: rel });

    const result = await runner.run('red');

    expect(result.ok).toBe(false);
    expect(result.exitStatus).toBe(1);
    expect(result.timedOut).toBe(false);
  });
});

describe('createScriptRunner — undeclared name', () => {
  it('refuses with no spawn when name is not in declared set', async () => {
    const repoRoot = makeTmp();
    const runner = createScriptRunner(repoRoot, {});

    const result = await runner.run('undeclared');

    expect(result.ok).toBe(false);
    expect(result.exitStatus).toBeNull();
    expect(result.durationMs).toBe(0);
    expect(result.output).toContain('"undeclared"');
  });

  it('refuses shell metacharacter names as undeclared (structurally impossible)', async () => {
    const repoRoot = makeTmp();
    const rel = writeScript(repoRoot, 'green', `process.stdout.write('should not run');`);
    const runner = createScriptRunner(repoRoot, { green: rel });

    // A name containing shell metacharacters is just not in the declared map.
    const result = await runner.run('green; rm -rf /');

    expect(result.ok).toBe(false);
    expect(result.exitStatus).toBeNull();
    expect(result.output).toContain('"green; rm -rf /"');
  });
});

describe('createScriptRunner — output truncation', () => {
  it('truncates output to OUTPUT_TRUNCATION_CAP bytes and preserves fullOutput', async () => {
    const repoRoot = makeTmp();
    // Produce output clearly larger than the cap.
    const bigOutput = `process.stdout.write('x'.repeat(${OUTPUT_TRUNCATION_CAP * 2}));`;
    const rel = writeScript(repoRoot, 'big', bigOutput);
    const runner = createScriptRunner(repoRoot, { big: rel });

    const result = await runner.run('big');

    expect(result.ok).toBe(true);
    expect(result.output.length).toBeLessThanOrEqual(OUTPUT_TRUNCATION_CAP);
    expect(result.fullOutput.length).toBeGreaterThan(OUTPUT_TRUNCATION_CAP);
  });
});

describe('createScriptRunner — wall-clock timeout', () => {
  it('kills the hanging script at the bound and the child is dead after', async () => {
    const repoRoot = makeTmp();
    const pidFile = join(repoRoot, 'child.pid');
    // Script writes its PID to disk then hangs — lets us verify the child died.
    const code = [
      `import { writeFileSync } from 'node:fs';`,
      `writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));`,
      `setTimeout(() => {}, 60_000);`,
    ].join('\n');
    const rel = writeScript(repoRoot, 'hang', code);
    const runner = createScriptRunner(repoRoot, { hang: rel });

    const result = await runner.run('hang', undefined, 300);

    expect(result.ok).toBe(false);
    expect(result.timedOut).toBe(true);
    expect(result.exitStatus).toBeNull();
    expect(result.durationMs).toBeGreaterThanOrEqual(200);

    // Give the OS a moment to reap the child, then confirm it is gone.
    await new Promise<void>((r) => setTimeout(r, 100));

    const pidStr = (() => {
      try { return readFileSync(pidFile, 'utf8').trim(); } catch { return null; }
    })();

    if (pidStr !== null) {
      const pid = Number(pidStr);
      expect(pid).toBeGreaterThan(0);
      // process.kill(pid, 0) throws ESRCH when the process no longer exists.
      expect(() => process.kill(pid, 0)).toThrow();
    }
    // If pid file was never written (very fast kill), the child definitely died.
  }, 10_000);
});

// ── Chunk 2: runScriptTool ────────────────────────────────────────────────────

describe('runScriptTool — ToolImpl shape', () => {
  it('has def.name === "run_script" and describes a script parameter', () => {
    const repoRoot = makeTmp();
    const runner = createScriptRunner(repoRoot, {});
    const tool = runScriptTool(runner);

    expect(tool.def.name).toBe('run_script');
    expect(tool.def.parameters).toBeDefined();
    const props = (tool.def.parameters as { properties?: Record<string, unknown> }).properties ?? {};
    expect(props['script']).toBeDefined();
  });

  it('execute returns ok:true and output containing exit status for a green script', async () => {
    const repoRoot = makeTmp();
    const rel = writeScript(repoRoot, 'test', `process.stdout.write('tests passed\\n');`);
    const runner = createScriptRunner(repoRoot, { test: rel });
    const tool = runScriptTool(runner);

    const r = await tool.execute(baseGoal, { script: 'test' });

    expect(r.ok).toBe(true);
    expect(r.output).toContain('exit 0');
    expect(r.output).toContain('tests passed');
  });

  it('execute returns ok:false for a red script with exit status', async () => {
    const repoRoot = makeTmp();
    const rel = writeScript(repoRoot, 'fail', `process.exit(2);`);
    const runner = createScriptRunner(repoRoot, { fail: rel });
    const tool = runScriptTool(runner);

    const r = await tool.execute(baseGoal, { script: 'fail' });

    expect(r.ok).toBe(false);
    expect(r.output).toContain('exit 2');
  });

  it('execute returns ok:false with reason for undeclared name', async () => {
    const repoRoot = makeTmp();
    const runner = createScriptRunner(repoRoot, {});
    const tool = runScriptTool(runner);

    const r = await tool.execute(baseGoal, { script: 'missing' });

    expect(r.ok).toBe(false);
    expect(r.output).toContain('"missing"');
  });
});

// ── Chunk 4: loggingScriptRunner ─────────────────────────────────────────────

describe('loggingScriptRunner — event emission', () => {
  it('emits exactly one script-ran event per run with required fields', async () => {
    const repoRoot = makeTmp();
    const rel = writeScript(repoRoot, 'ok', `process.exit(0);`);
    const runner = createScriptRunner(repoRoot, { ok: rel });
    const store = new InMemoryEventStore();

    let tick = 1000;
    const now = () => ++tick;

    const logged = loggingScriptRunner(store, runner, 'goal-1', now);
    await logged.run('ok');

    const events = await store.list({ type: 'script-ran' });
    expect(events).toHaveLength(1);

    const ev = events[0] as Extract<FactoryEvent, { type: 'script-ran' }>;
    expect(ev.type).toBe('script-ran');
    expect(ev.goalId).toBe('goal-1');
    expect(ev.command).toBe('ok');
    expect(ev.exitStatus).toBe(0);
    expect(typeof ev.durationMs).toBe('number');
    expect(typeof ev.outputRef).toBe('string');
    expect(ev.outputRef.length).toBeGreaterThan(0);
  });

  it('emits exitStatus:null on timeout', async () => {
    const repoRoot = makeTmp();
    const rel = writeScript(repoRoot, 'hang', `setTimeout(() => {}, 60_000);`);
    const runner = createScriptRunner(repoRoot, { hang: rel });
    const store = new InMemoryEventStore();

    const logged = loggingScriptRunner(store, runner, 'goal-2');
    await logged.run('hang', undefined, 150);

    const events = await store.list({ type: 'script-ran' });
    expect(events).toHaveLength(1);

    const ev = events[0] as Extract<FactoryEvent, { type: 'script-ran' }>;
    expect(ev.exitStatus).toBeNull();
  }, 10_000);

  it('emits exactly one event even on refusal (undeclared name)', async () => {
    const repoRoot = makeTmp();
    const runner = createScriptRunner(repoRoot, {});
    const store = new InMemoryEventStore();

    const logged = loggingScriptRunner(store, runner, 'goal-3');
    await logged.run('nope');

    const events = await store.list({ type: 'script-ran' });
    expect(events).toHaveLength(1);
  });

  it('outputRef is unique across multiple runs', async () => {
    const repoRoot = makeTmp();
    const rel = writeScript(repoRoot, 'quick', `process.exit(0);`);
    const runner = createScriptRunner(repoRoot, { quick: rel });
    const store = new InMemoryEventStore();

    let tick = 2000;
    const now = () => ++tick;

    const logged = loggingScriptRunner(store, runner, 'goal-4', now);
    await logged.run('quick');
    await logged.run('quick');

    const events = await store.list({ type: 'script-ran' });
    expect(events).toHaveLength(2);
    const refs = events.map((e) => (e as Extract<FactoryEvent, { type: 'script-ran' }>).outputRef);
    expect(new Set(refs).size).toBe(2);
  });
});

// ── Chunk 5: verifyEntryPoints ────────────────────────────────────────────────

describe('verifyEntryPoints', () => {
  it('returns ok:true when all declared scripts exist', async () => {
    const repoRoot = makeTmp();
    const rel = writeScript(repoRoot, 'test', `process.exit(0);`);
    const result = await verifyEntryPoints(repoRoot, { test: rel });

    expect(result.ok).toBe(true);
  });

  it('returns ok:true for empty declared map', async () => {
    const repoRoot = makeTmp();
    const result = await verifyEntryPoints(repoRoot, {});

    expect(result.ok).toBe(true);
  });

  it('returns ok:false naming the missing entry when one script is absent', async () => {
    const repoRoot = makeTmp();
    const result = await verifyEntryPoints(repoRoot, { test: 'scripts/missing.mjs' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('"test"');
      expect(result.reason).toContain('scripts/missing.mjs');
    }
  });

  it('returns ok:false when some scripts exist but one is missing', async () => {
    const repoRoot = makeTmp();
    const rel = writeScript(repoRoot, 'good', `process.exit(0);`);
    const result = await verifyEntryPoints(repoRoot, {
      good: rel,
      missing: 'scripts/absent.mjs',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('"missing"');
    }
  });

  it('skips scheme-prefixed entries (npm-script:, make:) — they are not disk paths', async () => {
    const repoRoot = makeTmp();
    // Neither names a file on disk; both must be skipped, not reported missing.
    const result = await verifyEntryPoints(repoRoot, {
      test: 'make:test',
      lint: 'npm-script:lint',
    });
    expect(result.ok).toBe(true);
  });
});

// ── run_command — general worktree shell (ADR-016 amendment) ─────────────────

describe('networkCommandBlock', () => {
  it('blocks network-reaching commands, including when chained past a first word', () => {
    expect(networkCommandBlock('git push origin main')).toBe('git push');
    expect(networkCommandBlock('git fetch')).toBe('git fetch');
    expect(networkCommandBlock('npm test && curl http://evil')).toBe('curl');
    expect(networkCommandBlock('echo hi; wget x')).toBe('wget');
    expect(networkCommandBlock('npm install lodash')).toMatch(/npm\s+install/);
    expect(networkCommandBlock('npx tsc')).toBe('npx');
    expect(networkCommandBlock('git pull --rebase')).toBe('git pull');
  });

  it('allows local commands including local git', () => {
    expect(networkCommandBlock('git status')).toBeNull();
    expect(networkCommandBlock('git checkout src/x.ts')).toBeNull();
    expect(networkCommandBlock('git restore src/x.ts')).toBeNull();
    expect(networkCommandBlock('git add -A && git commit -m "x"')).toBeNull();
    expect(networkCommandBlock('git diff HEAD')).toBeNull();
    expect(networkCommandBlock('npm run test')).toBeNull();
    expect(networkCommandBlock('node -e "console.log(1)"')).toBeNull();
  });
});

describe('createCommandRunner', () => {
  it('runs a command in the worktree cwd and captures output', async () => {
    const root = makeTmp();
    writeFileSync(join(root, 'marker.txt'), 'hello-worktree');
    const runner = createCommandRunner(root);
    const r = await runner.run('cat marker.txt');
    expect(r.ok).toBe(true);
    expect(r.exitStatus).toBe(0);
    expect(r.fullOutput).toContain('hello-worktree');
  });

  it('cwd is pinned to the worktree (pwd is the worktree root)', async () => {
    const root = makeTmp();
    const runner = createCommandRunner(root);
    const r = await runner.run('pwd');
    expect(r.ok).toBe(true);
    // macOS /tmp symlinks to /private/tmp; compare the basename to avoid that.
    expect(r.fullOutput.trim().endsWith(root.split('/').pop()!)).toBe(true);
  });

  it('refuses a network-reaching command without spawning (no exit status)', async () => {
    const root = makeTmp();
    const runner = createCommandRunner(root);
    const r = await runner.run('git push origin main');
    expect(r.ok).toBe(false);
    expect(r.exitStatus).toBeNull();
    expect(r.output).toContain('reaches the network');
    expect(r.durationMs).toBe(0); // never spawned
  });

  it('does not pass scrubbed secrets to the child env', async () => {
    const root = makeTmp();
    // The scrubbed env omits *_TOKEN; the child should see no value.
    const scrubbed = { ...process.env };
    delete scrubbed['GITHUB_TOKEN'];
    const runner = createCommandRunner(root, scrubbed);
    const r = await runner.run('node -e "process.stdout.write(String(process.env.GITHUB_TOKEN))"');
    expect(r.fullOutput).toContain('undefined');
  });

  it('kills a command that exceeds the time limit', async () => {
    const root = makeTmp();
    const runner = createCommandRunner(root);
    const r = await runner.run('node -e "setTimeout(()=>{}, 10000)"', 300);
    expect(r.timedOut).toBe(true);
    expect(r.ok).toBe(false);
  }, 5000);

  it('refuses an empty command', async () => {
    const root = makeTmp();
    const r = await createCommandRunner(root).run('   ');
    expect(r.ok).toBe(false);
    expect(r.output).toContain('empty command');
  });
});

describe('runCommandTool + loggingCommandRunner', () => {
  const goal = { id: 'g-cmd' } as unknown as Goal;

  it('formats the tool output with command + status', async () => {
    const root = makeTmp();
    writeFileSync(join(root, 'f.txt'), 'X');
    const tool = runCommandTool(createCommandRunner(root));
    const out = await tool.execute(goal, { command: 'cat f.txt' });
    expect(out.ok).toBe(true);
    expect(out.output).toContain('[run_command: cat f.txt]');
    expect(out.output).toContain('exit 0');
  });

  it('logs a script-ran event with the full command as the label', async () => {
    const root = makeTmp();
    const store = new InMemoryEventStore();
    const runner = loggingCommandRunner(store, createCommandRunner(root), 'g-cmd', () => 123);
    await runner.run('git status');
    const events = (await store.list()).filter((e: FactoryEvent) => e.type === 'script-ran');
    expect(events).toHaveLength(1);
    expect(events[0]!.type === 'script-ran' && events[0]!.command).toBe('git status');
  });
});
