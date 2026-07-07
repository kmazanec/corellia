/**
 * Tests for the deterministic check library.
 */

import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  artifactPresent,
  filesWithinScope,
  fileContains,
  sandboxFileContains,
  processClean,
  runScriptCheck,
  captureSucceeded,
} from '../../src/library/checks.js';
import { isInScope } from '../../src/engine/tools.js';
import type { Goal } from '../../src/contract/goal.js';
import type { Artifact } from '../../src/contract/report.js';
import type { CheckContext } from '../../src/contract/goal-type.js';
import type { ScriptResult } from '../../src/contract/tool.js';

const baseGoal: Goal = {
  id: 'g1',
  type: 'implement',
  parentId: null,
  title: 'Test goal',
  spec: {},
  intent: 'production',
  scope: ['src/', 'tests/'],
  budget: { attempts: 3, tokens: 1000, toolCalls: 10, wallClockMs: 60000 },
  memories: [],
};

const filesArtifact = (files: { path: string; content: string }[]): Artifact => ({
  kind: 'files',
  files,
});

const textArtifact = (text: string): Artifact => ({ kind: 'text', text });

// ---------------------------------------------------------------------------
// artifactPresent
// ---------------------------------------------------------------------------

describe('artifactPresent', () => {
  it('fails on null artifact', async () => {
    const r = await artifactPresent.run(baseGoal, null);
    expect(r.ok).toBe(false);
  });

  it('fails on files artifact with no files', async () => {
    const r = await artifactPresent.run(baseGoal, filesArtifact([]));
    expect(r.ok).toBe(false);
  });

  it('fails on text artifact with empty string', async () => {
    const r = await artifactPresent.run(baseGoal, textArtifact(''));
    expect(r.ok).toBe(false);
  });

  it('passes on files artifact with at least one file', async () => {
    const r = await artifactPresent.run(
      baseGoal,
      filesArtifact([{ path: 'src/foo.ts', content: 'export {}' }]),
    );
    expect(r.ok).toBe(true);
  });

  it('passes on text artifact with non-empty content', async () => {
    const r = await artifactPresent.run(baseGoal, textArtifact('hello'));
    expect(r.ok).toBe(true);
  });

  // A tool-driven implement leaf delivers by WRITING files, and its returned
  // artifact is often empty. artifact-present must not fail it when the worktree
  // changed within scope (build run live-self-bd479522: file_issue wrote 14 files
  // via tools, emitted empty text, and was wrongly blocked + not collected).
  it('passes on an empty artifact when the leaf wrote files within scope', async () => {
    const root = mkdtempSync(join(tmpdir(), 'corellia-artpresent-'));
    try {
      execFileSync('git', ['-C', root, 'init', '-q'], { stdio: 'pipe' });
      execFileSync('git', ['-C', root, 'config', 'user.email', 't@t'], { stdio: 'pipe' });
      execFileSync('git', ['-C', root, 'config', 'user.name', 't'], { stdio: 'pipe' });
      mkdirSync(join(root, 'src'), { recursive: true });
      // An untracked file under the goal's scope (src/) — the leaf's tool write.
      writeFileSync(join(root, 'src', 'new-tool.ts'), 'export const x = 1;\n');

      const ctx: CheckContext = { sandboxRoot: root };
      const goalInSrc: Goal = { ...baseGoal, scope: ['src/'] };

      // Empty text artifact + a scoped worktree change → passes.
      expect((await artifactPresent.run(goalInSrc, textArtifact(''), ctx)).ok).toBe(true);
      // Null artifact + a scoped worktree change → also passes.
      expect((await artifactPresent.run(goalInSrc, null, ctx)).ok).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('still fails on an empty artifact when the worktree has no scoped change', async () => {
    const root = mkdtempSync(join(tmpdir(), 'corellia-artpresent-empty-'));
    try {
      execFileSync('git', ['-C', root, 'init', '-q'], { stdio: 'pipe' });
      const ctx: CheckContext = { sandboxRoot: root };
      // No file written → empty artifact still fails.
      expect((await artifactPresent.run({ ...baseGoal, scope: ['src/'] }, textArtifact(''), ctx)).ok).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// filesWithinScope
// ---------------------------------------------------------------------------

describe('filesWithinScope', () => {
  it('passes when artifact is null', async () => {
    const r = await filesWithinScope.run(baseGoal, null);
    expect(r.ok).toBe(true);
  });

  it('passes when artifact is text kind', async () => {
    const r = await filesWithinScope.run(baseGoal, textArtifact('something'));
    expect(r.ok).toBe(true);
  });

  it('passes when all files start with a scope prefix', async () => {
    const r = await filesWithinScope.run(
      baseGoal,
      filesArtifact([
        { path: 'src/a.ts', content: '' },
        { path: 'tests/b.test.ts', content: '' },
      ]),
    );
    expect(r.ok).toBe(true);
  });

  it('fails when a file is outside scope', async () => {
    const r = await filesWithinScope.run(
      baseGoal,
      filesArtifact([
        { path: 'src/a.ts', content: '' },
        { path: 'lib/util.ts', content: '' },
      ]),
    );
    expect(r.ok).toBe(false);
    expect(r.detail).toContain('lib/util.ts');
  });

  it('fails when ALL files are outside scope', async () => {
    const r = await filesWithinScope.run(
      baseGoal,
      filesArtifact([{ path: 'outside/x.ts', content: '' }]),
    );
    expect(r.ok).toBe(false);
  });

  it('fix 4 — rejects path traversal: out/greeting/../../../etc/passwd', async () => {
    const goal = { ...baseGoal, scope: ['out/greeting/'] };
    const r = await filesWithinScope.run(
      goal,
      filesArtifact([{ path: 'out/greeting/../../../etc/passwd', content: '' }]),
    );
    expect(r.ok).toBe(false);
    expect(r.detail).toContain('out/greeting/../../../etc/passwd');
  });

  it('fix 4 — rejects absolute paths: /etc/passwd', async () => {
    const goal = { ...baseGoal, scope: ['out/greeting/'] };
    const r = await filesWithinScope.run(
      goal,
      filesArtifact([{ path: '/etc/passwd', content: '' }]),
    );
    expect(r.ok).toBe(false);
    expect(r.detail).toContain('/etc/passwd');
  });

  it('fix 4 — accepts a legitimate in-scope path: out/greeting/cli.mjs', async () => {
    const goal = { ...baseGoal, scope: ['out/greeting/'] };
    const r = await filesWithinScope.run(
      goal,
      filesArtifact([{ path: 'out/greeting/cli.mjs', content: '' }]),
    );
    expect(r.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// fileContains
// ---------------------------------------------------------------------------

describe('fileContains', () => {
  it('fails when artifact is null', async () => {
    const check = fileContains('src/foo.ts', 'needle');
    const r = await check.run(baseGoal, null);
    expect(r.ok).toBe(false);
  });

  it('fails when the target file is not in the artifact', async () => {
    const check = fileContains('src/missing.ts', 'needle');
    const r = await check.run(
      baseGoal,
      filesArtifact([{ path: 'src/other.ts', content: 'needle is here' }]),
    );
    expect(r.ok).toBe(false);
    expect(r.detail).toContain('src/missing.ts');
  });

  it('fails when the file does not contain the needle', async () => {
    const check = fileContains('src/foo.ts', 'needle');
    const r = await check.run(
      baseGoal,
      filesArtifact([{ path: 'src/foo.ts', content: 'no match here' }]),
    );
    expect(r.ok).toBe(false);
  });

  it('passes when the file contains the needle', async () => {
    const check = fileContains('src/foo.ts', 'export const x');
    const r = await check.run(
      baseGoal,
      filesArtifact([{ path: 'src/foo.ts', content: 'export const x = 1;' }]),
    );
    expect(r.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// sandboxFileContains
// ---------------------------------------------------------------------------

describe('sandboxFileContains', () => {
  it('passes via the worktree even when the artifact does not list the file', async () => {
    const root = mkdtempSync(join(tmpdir(), 'corellia-sandboxfile-'));
    try {
      mkdirSync(join(root, 'src'), { recursive: true });
      writeFileSync(join(root, 'src', 'foo.ts'), 'export const x = 1;\n');
      const ctx: CheckContext = { sandboxRoot: root };
      const check = sandboxFileContains('src/foo.ts', 'export const x');
      // Artifact lists a DIFFERENT file — the worktree is the source of truth.
      const r = await check.run(baseGoal, filesArtifact([{ path: 'docs/log.md', content: 'x' }]), ctx);
      expect(r.ok).toBe(true);
      expect(r.detail).toContain('src/foo.ts');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('treats an empty needle as a worktree existence check', async () => {
    const root = mkdtempSync(join(tmpdir(), 'corellia-sandboxfile-exists-'));
    try {
      writeFileSync(join(root, 'package.json'), '{}\n');
      const ctx: CheckContext = { sandboxRoot: root };
      const r = await sandboxFileContains('package.json', '').run(baseGoal, null, ctx);
      expect(r.ok).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('fails when the file is absent from the worktree', async () => {
    const root = mkdtempSync(join(tmpdir(), 'corellia-sandboxfile-missing-'));
    try {
      const ctx: CheckContext = { sandboxRoot: root };
      const r = await sandboxFileContains('src/missing.ts', 'needle').run(baseGoal, null, ctx);
      expect(r.ok).toBe(false);
      expect(r.detail).toContain('not found in the worktree');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('fails when the worktree file does not contain the needle', async () => {
    const root = mkdtempSync(join(tmpdir(), 'corellia-sandboxfile-noneedle-'));
    try {
      writeFileSync(join(root, 'a.ts'), 'no match\n');
      const ctx: CheckContext = { sandboxRoot: root };
      const r = await sandboxFileContains('a.ts', 'needle').run(baseGoal, null, ctx);
      expect(r.ok).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects a traversal path instead of reading outside the worktree', async () => {
    const root = mkdtempSync(join(tmpdir(), 'corellia-sandboxfile-traversal-'));
    try {
      const ctx: CheckContext = { sandboxRoot: root };
      const r = await sandboxFileContains('../outside.ts', 'x').run(baseGoal, null, ctx);
      expect(r.ok).toBe(false);
      expect(r.detail).toContain('repo-relative');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('falls back to the artifact-based check when no sandbox is in context', async () => {
    const check = sandboxFileContains('src/foo.ts', 'export const x');
    const pass = await check.run(
      baseGoal,
      filesArtifact([{ path: 'src/foo.ts', content: 'export const x = 1;' }]),
    );
    expect(pass.ok).toBe(true);
    const fail = await check.run(baseGoal, null);
    expect(fail.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// processClean
// ---------------------------------------------------------------------------

describe('processClean', () => {
  it('passes on null artifact', async () => {
    const r = await processClean.run(baseGoal, null);
    expect(r.ok).toBe(true);
  });

  it('passes on text artifact', async () => {
    const r = await processClean.run(baseGoal, textArtifact('some text'));
    expect(r.ok).toBe(true);
  });

  it('passes on clean files', async () => {
    const r = await processClean.run(
      baseGoal,
      filesArtifact([{ path: 'src/a.ts', content: '// A normal comment\nexport const x = 1;' }]),
    );
    expect(r.ok).toBe(true);
  });

  it('fails when a file contains F-[0-9] pattern', async () => {
    const r = await processClean.run(
      baseGoal,
      filesArtifact([{ path: 'src/a.ts', content: '// See F-1 for context' }]),
    );
    expect(r.ok).toBe(false);
    expect(r.detail).toContain('src/a.ts');
  });

  it('fails when a file contains "build plan"', async () => {
    const r = await processClean.run(
      baseGoal,
      filesArtifact([{ path: 'src/b.ts', content: '// build plan: do the thing' }]),
    );
    expect(r.ok).toBe(false);
  });

  it('fails when a file contains "per the plan" (case-insensitive)', async () => {
    const r = await processClean.run(
      baseGoal,
      filesArtifact([{ path: 'src/c.ts', content: '// Per the plan, we do X' }]),
    );
    expect(r.ok).toBe(false);
  });

  it('fails when a file contains "per the spec"', async () => {
    const r = await processClean.run(
      baseGoal,
      filesArtifact([{ path: 'src/d.ts', content: '// per the spec we do Y' }]),
    );
    expect(r.ok).toBe(false);
  });

  it('stops at the first offending file and names it', async () => {
    const r = await processClean.run(
      baseGoal,
      filesArtifact([
        { path: 'src/clean.ts', content: '// fine' },
        { path: 'src/dirty.ts', content: '// Build Plan: step 1' },
      ]),
    );
    expect(r.ok).toBe(false);
    expect(r.detail).toContain('src/dirty.ts');
  });
});

// ---------------------------------------------------------------------------
// runScriptCheck
// ---------------------------------------------------------------------------

function makeGreenCtx(): CheckContext {
  const result: ScriptResult = {
    ok: true,
    exitStatus: 0,
    output: 'all tests passed',
    fullOutput: 'all tests passed',
    durationMs: 42,
    timedOut: false,
  };
  return { runScript: async () => result };
}

function makeRedCtx(exitCode = 1, output = 'FAIL: assertion failed'): CheckContext {
  const result: ScriptResult = {
    ok: false,
    exitStatus: exitCode,
    output,
    fullOutput: output,
    durationMs: 100,
    timedOut: false,
  };
  return { runScript: async () => result };
}

function makeRefusalCtx(): CheckContext {
  const result: ScriptResult = {
    ok: false,
    exitStatus: null,
    output: '"missing-script" is not in the declared set.',
    fullOutput: '"missing-script" is not in the declared set.',
    durationMs: 0,
    timedOut: false,
  };
  return { runScript: async () => result };
}

describe('runScriptCheck', () => {
  it('returns ok:true when the script exits 0', async () => {
    const check = runScriptCheck('test');
    const r = await check.run(baseGoal, null, makeGreenCtx());
    expect(r.ok).toBe(true);
    expect(r.detail).toContain('test');
  });

  it('returns ok:false when the script exits non-zero, detail includes exit status and output', async () => {
    const check = runScriptCheck('test');
    const r = await check.run(baseGoal, null, makeRedCtx(1, 'FAIL: assertion failed'));
    expect(r.ok).toBe(false);
    expect(r.detail).toContain('exit 1');
    expect(r.detail).toContain('FAIL: assertion failed');
  });

  it('returns ok:false for a refused (undeclared) name with reason in detail', async () => {
    const check = runScriptCheck('missing-script');
    const r = await check.run(baseGoal, null, makeRefusalCtx());
    expect(r.ok).toBe(false);
    expect(r.detail).toContain('missing-script');
  });

  it('returns ok:false with "no exec context" when ctx is absent', async () => {
    const check = runScriptCheck('test');
    const r = await check.run(baseGoal, null);
    expect(r.ok).toBe(false);
    expect(r.detail).toBe('no exec context');
  });

  it('returns ok:false with "no exec context" when ctx.runScript is absent', async () => {
    const check = runScriptCheck('test');
    const r = await check.run(baseGoal, null, { sandboxRoot: '/some/path' });
    expect(r.ok).toBe(false);
    expect(r.detail).toBe('no exec context');
  });

  it('name follows run-script:<scriptName> convention', () => {
    const check = runScriptCheck('my-tests');
    expect(check.name).toBe('run-script:my-tests');
  });

  it('existing artifact-only checks still accept the new optional ctx param', async () => {
    const r = await artifactPresent.run(baseGoal, null, makeGreenCtx());
    expect(r.ok).toBe(false);
    expect(r.detail).toContain('No artifact');
  });
});

// ---------------------------------------------------------------------------
// isWithinScope shared predicate (reused from tools.ts in diffWithinScope)
//
// These tests verify that the isInScope helper used by diffWithinScope matches
// the boundary logic embedded in filesWithinScope — one definition of scope
// containment in the repo.
// ---------------------------------------------------------------------------

describe('isWithinScope shared predicate', () => {
  it('returns true for a file directly inside a scope prefix directory', () => {
    expect(isInScope('src/index.ts', ['src/'])).toBe(true);
  });

  it('returns true for a file in a nested subdirectory of a scope prefix', () => {
    expect(isInScope('src/engine/tools.ts', ['src/'])).toBe(true);
  });

  it('returns false for a file outside all scope prefixes', () => {
    expect(isInScope('lib/util.ts', ['src/', 'tests/'])).toBe(false);
  });

  it('returns true when scope is empty (no scope declared: allow all)', () => {
    expect(isInScope('anything/path.ts', [])).toBe(true);
  });

  it('matches a file that is exactly the scope prefix (no trailing slash)', () => {
    expect(isInScope('src', ['src'])).toBe(true);
  });

  it('does not match a file that starts with the prefix string but is not inside it', () => {
    // 'src-other/foo.ts' starts with 'src' but is NOT inside the 'src/' boundary.
    expect(isInScope('src-other/foo.ts', ['src/'])).toBe(false);
  });

  it('matches behavior with filesWithinScope: in-scope path passes', async () => {
    const goal = { ...baseGoal, scope: ['src/'] };
    const r = await filesWithinScope.run(
      goal,
      { kind: 'files', files: [{ path: 'src/a.ts', content: '' }] },
    );
    // Both must agree: isInScope passes, filesWithinScope passes.
    expect(isInScope('src/a.ts', ['src/'])).toBe(true);
    expect(r.ok).toBe(true);
  });

  it('matches behavior with filesWithinScope: out-of-scope path fails', async () => {
    const goal = { ...baseGoal, scope: ['src/'] };
    const r = await filesWithinScope.run(
      goal,
      { kind: 'files', files: [{ path: 'lib/x.ts', content: '' }] },
    );
    // Both must agree: isInScope fails, filesWithinScope fails.
    expect(isInScope('lib/x.ts', ['src/'])).toBe(false);
    expect(r.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// captureSucceeded — the runtime/visual deterministic floor (ADR-042)
// ---------------------------------------------------------------------------

describe('captureSucceeded', () => {
  it('fails safe with "no capture context" when no runCapture is present', async () => {
    const r = await captureSucceeded('shot').run(baseGoal, null, {});
    expect(r.ok).toBe(false);
    expect(r.detail).toContain('no capture context');
  });

  it('passes when the named capture produces output', async () => {
    const ctx: CheckContext = {
      runCapture: async (name) => ({ ok: true, kind: 'render-document', outputRef: `${name}.png`, detail: 'ok', durationMs: 3 }),
    };
    const r = await captureSucceeded('shot').run(baseGoal, null, ctx);
    expect(r.ok).toBe(true);
    expect(r.detail).toContain('shot.png');
  });

  it('fails when the capture produced no output', async () => {
    const ctx: CheckContext = {
      runCapture: async () => ({ ok: false, kind: 'render-document', detail: 'render exited 1', durationMs: 3 }),
    };
    const r = await captureSucceeded('shot').run(baseGoal, null, ctx);
    expect(r.ok).toBe(false);
    expect(r.detail).toContain('did not produce output');
  });
});

describe('sandboxFileContains directory tolerance', () => {
  it('a bare existence check passes on a DIRECTORY target', async () => {
    const root = mkdtempSync(join(tmpdir(), 'corellia-sandboxdir-'));
    try {
      mkdirSync(join(root, 'docs', 'iterations'), { recursive: true });
      const ctx: CheckContext = { sandboxRoot: root };
      const r = await sandboxFileContains('docs/iterations/', '').run(baseGoal, null, ctx);
      expect(r.ok).toBe(true);
      expect(r.detail).toContain('Directory');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('a needle check still fails on a directory target', async () => {
    const root = mkdtempSync(join(tmpdir(), 'corellia-sandboxdir2-'));
    try {
      mkdirSync(join(root, 'docs'), { recursive: true });
      const ctx: CheckContext = { sandboxRoot: root };
      const r = await sandboxFileContains('docs', 'needle').run(baseGoal, null, ctx);
      expect(r.ok).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
