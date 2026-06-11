/**
 * Tests for the deterministic check library.
 */

import { describe, it, expect } from 'vitest';
import {
  artifactPresent,
  filesWithinScope,
  fileContains,
  processClean,
  runScriptCheck,
} from '../../src/library/checks.js';
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
