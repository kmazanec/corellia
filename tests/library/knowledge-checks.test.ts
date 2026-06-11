/**
 * Tests for the knowledge artifact self-validation checks.
 *
 * All checks run against either in-memory JSON artifacts or tiny tmp-dir
 * fixture repos. No network, no real import scanner — architecture tests
 * use injected synthetic scan functions.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  architectureCheck,
  stackCheck,
  conventionsCheck,
  testScaffoldCheck,
  diveAnchorCheck,
  mapRepoCheck,
} from '../../src/library/knowledge-checks.js';
import type { ArchScanFn } from '../../src/library/knowledge-checks.js';
import type { Goal } from '../../src/contract/goal.js';
import type { Artifact } from '../../src/contract/report.js';
import type { CheckContext } from '../../src/contract/goal-type.js';
import type { KnowledgeArtifact, RegionFacts } from '../../src/contract/knowledge.js';
import type { ScriptResult } from '../../src/contract/tool.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let tmpDirs: string[] = [];

function makeTmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'corellia-kc-'));
  tmpDirs.push(d);
  return d;
}

afterEach(() => {
  for (const d of tmpDirs) {
    try { rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
  }
  tmpDirs = [];
});

const baseGoal: Goal = {
  id: 'g1',
  type: 'map-repo',
  parentId: null,
  title: 'Test goal',
  spec: {},
  intent: 'production',
  scope: [],
  budget: { attempts: 3, tokens: 1000, toolCalls: 10, wallClockMs: 60000 },
  memories: [],
};

function textArt(text: string): Artifact {
  return { kind: 'text', text };
}

function knowledgeArtifact(overrides: Partial<KnowledgeArtifact> = {}): KnowledgeArtifact {
  return {
    repoRoot: '/repo',
    category: 'architecture',
    generatedAtSha: 'abc123',
    confidence: 'high',
    status: 'provisional',
    pointers: [],
    summary: 'Test artifact',
    ...overrides,
  };
}

function regionFacts(overrides: Partial<RegionFacts> = {}): RegionFacts {
  return {
    repoRoot: '/repo',
    region: 'src/auth',
    generatedAtSha: 'abc123',
    facts: [],
    ...overrides,
  };
}

function makeGreenCtx(root?: string): CheckContext {
  const result: ScriptResult = {
    ok: true,
    exitStatus: 0,
    output: 'all tests passed',
    fullOutput: 'all tests passed',
    durationMs: 42,
    timedOut: false,
  };
  return { sandboxRoot: root, runScript: async () => result };
}

function makeRedCtx(root?: string, exitCode = 1, output = 'FAIL'): CheckContext {
  const result: ScriptResult = {
    ok: false,
    exitStatus: exitCode,
    output,
    fullOutput: output,
    durationMs: 100,
    timedOut: false,
  };
  return { sandboxRoot: root, runScript: async () => result };
}

const noScanFn: ArchScanFn = async () => [];

// ---------------------------------------------------------------------------
// Common bad-input cases (shared across all checks)
// ---------------------------------------------------------------------------

describe('artifact JSON packaging tolerance', () => {
  it('accepts JSON wrapped in a markdown fence', async () => {
    const repoRoot = makeTmp();
    const artifact = knowledgeArtifact({ category: 'stack', repoRoot, pointers: [] });
    const wrapped = textArt('```json\n' + JSON.stringify(artifact) + '\n```');
    const r = await stackCheck().run(baseGoal, wrapped, { sandboxRoot: repoRoot });
    expect(r.ok).toBe(true);
  });

  it('accepts a single-file files artifact carrying the JSON', async () => {
    const repoRoot = makeTmp();
    const artifact = knowledgeArtifact({ category: 'stack', repoRoot, pointers: [] });
    const filesArt: Artifact = {
      kind: 'files',
      files: [{ path: 'artifact.json', content: JSON.stringify(artifact) }],
    };
    const r = await stackCheck().run(baseGoal, filesArt, { sandboxRoot: repoRoot });
    expect(r.ok).toBe(true);
  });

  it('still rejects a multi-file artifact', async () => {
    const filesArt: Artifact = {
      kind: 'files',
      files: [
        { path: 'a.json', content: '{}' },
        { path: 'b.json', content: '{}' },
      ],
    };
    const r = await stackCheck().run(baseGoal, filesArt);
    expect(r.ok).toBe(false);
  });
});

describe('check — null artifact', () => {
  it('architectureCheck fails on null artifact', async () => {
    const r = await architectureCheck(noScanFn).run(baseGoal, null);
    expect(r.ok).toBe(false);
  });

  it('stackCheck fails on null artifact', async () => {
    const r = await stackCheck().run(baseGoal, null);
    expect(r.ok).toBe(false);
  });

  it('conventionsCheck fails on null artifact', async () => {
    const r = await conventionsCheck().run(baseGoal, null);
    expect(r.ok).toBe(false);
  });

  it('testScaffoldCheck fails on null artifact', async () => {
    const r = await testScaffoldCheck().run(baseGoal, null, makeGreenCtx());
    expect(r.ok).toBe(false);
  });

  it('diveAnchorCheck fails on null artifact', async () => {
    const r = await diveAnchorCheck().run(baseGoal, null);
    expect(r.ok).toBe(false);
  });
});

describe('check — non-text artifact', () => {
  const filesArt: Artifact = { kind: 'files', files: [] };

  it('architectureCheck fails on files artifact', async () => {
    const r = await architectureCheck(noScanFn).run(baseGoal, filesArt);
    expect(r.ok).toBe(false);
    expect(r.detail).toContain('text artifact');
  });

  it('diveAnchorCheck fails on files artifact', async () => {
    const r = await diveAnchorCheck().run(baseGoal, filesArt);
    expect(r.ok).toBe(false);
  });
});

describe('check — invalid JSON', () => {
  it('architectureCheck fails on malformed JSON', async () => {
    const r = await architectureCheck(noScanFn).run(baseGoal, textArt('{not json}'));
    expect(r.ok).toBe(false);
    expect(r.detail).toContain('not valid JSON');
  });

  it('stackCheck fails on malformed JSON', async () => {
    const r = await stackCheck().run(baseGoal, textArt('!!!'));
    expect(r.ok).toBe(false);
  });
});

describe('check — wrong category', () => {
  it('architectureCheck fails when category is "stack"', async () => {
    const art = JSON.stringify(knowledgeArtifact({ category: 'stack' }));
    const r = await architectureCheck(noScanFn).run(baseGoal, textArt(art));
    expect(r.ok).toBe(false);
    expect(r.detail).toContain('architecture');
  });

  it('stackCheck fails when category is "conventions"', async () => {
    const art = JSON.stringify(knowledgeArtifact({ category: 'conventions' }));
    const r = await stackCheck().run(baseGoal, textArt(art));
    expect(r.ok).toBe(false);
    expect(r.detail).toContain('stack');
  });

  it('conventionsCheck fails when category is "architecture"', async () => {
    const art = JSON.stringify(knowledgeArtifact({ category: 'architecture' }));
    const r = await conventionsCheck().run(baseGoal, textArt(art));
    expect(r.ok).toBe(false);
    expect(r.detail).toContain('conventions');
  });

  it('testScaffoldCheck fails when category is "architecture"', async () => {
    const art = JSON.stringify(knowledgeArtifact({ category: 'architecture' }));
    const r = await testScaffoldCheck().run(baseGoal, textArt(art), makeGreenCtx());
    expect(r.ok).toBe(false);
    expect(r.detail).toContain('test-scaffold');
  });
});

// ---------------------------------------------------------------------------
// architectureCheck
// ---------------------------------------------------------------------------

describe('architectureCheck', () => {
  it('passes when artifact has no pointers and scan fn is not called', async () => {
    const art = JSON.stringify(knowledgeArtifact({ category: 'architecture', pointers: [] }));
    const r = await architectureCheck(noScanFn).run(baseGoal, textArt(art));
    expect(r.ok).toBe(true);
  });

  it('passes when all pointer paths exist on disk and scan covers them', async () => {
    const repoRoot = makeTmp();
    mkdirSync(join(repoRoot, 'src'), { recursive: true });
    writeFileSync(join(repoRoot, 'src', 'index.ts'), 'export {}');
    writeFileSync(join(repoRoot, 'src', 'auth.ts'), 'export {}');

    const scanFn: ArchScanFn = async () => [
      { from: 'src/index.ts', to: 'src/auth.ts' },
    ];

    const artifact = knowledgeArtifact({
      category: 'architecture',
      repoRoot,
      pointers: [
        { path: 'src/index.ts', note: 'entry point' },
        { path: 'src/auth.ts', note: 'auth module' },
      ],
    });
    const ctx: CheckContext = { sandboxRoot: repoRoot };
    const r = await architectureCheck(scanFn).run(baseGoal, textArt(JSON.stringify(artifact)), ctx);
    expect(r.ok).toBe(true);
    expect(r.detail).toContain('2 pointer');
  });

  it('fails when a pointer path does not exist on disk', async () => {
    const repoRoot = makeTmp();
    writeFileSync(join(repoRoot, 'exists.ts'), '');

    const artifact = knowledgeArtifact({
      category: 'architecture',
      repoRoot,
      pointers: [
        { path: 'exists.ts', note: 'ok' },
        { path: 'missing.ts', note: 'gone' },
      ],
    });
    const ctx: CheckContext = { sandboxRoot: repoRoot };
    const r = await architectureCheck(noScanFn).run(baseGoal, textArt(JSON.stringify(artifact)), ctx);
    expect(r.ok).toBe(false);
    expect(r.detail).toContain('missing.ts');
  });

  it('fails when no claimed pointer appears in the scan graph (and scan is non-empty)', async () => {
    const repoRoot = makeTmp();
    writeFileSync(join(repoRoot, 'claimed.ts'), '');

    const scanFn: ArchScanFn = async () => [
      { from: 'other/a.ts', to: 'other/b.ts' },
    ];

    const artifact = knowledgeArtifact({
      category: 'architecture',
      repoRoot,
      pointers: [{ path: 'claimed.ts', note: 'module' }],
    });
    const ctx: CheckContext = { sandboxRoot: repoRoot };
    const r = await architectureCheck(scanFn).run(baseGoal, textArt(JSON.stringify(artifact)), ctx);
    expect(r.ok).toBe(false);
    expect(r.detail).toContain('fresh scan');
  });

  it('passes (soft) when scan returns no edges at all — no contradiction possible', async () => {
    const repoRoot = makeTmp();
    writeFileSync(join(repoRoot, 'claimed.ts'), '');

    const artifact = knowledgeArtifact({
      category: 'architecture',
      repoRoot,
      pointers: [{ path: 'claimed.ts', note: 'module' }],
    });
    const ctx: CheckContext = { sandboxRoot: repoRoot };
    const r = await architectureCheck(noScanFn).run(baseGoal, textArt(JSON.stringify(artifact)), ctx);
    expect(r.ok).toBe(true);
  });

  it('fails when scan fn throws', async () => {
    const repoRoot = makeTmp();
    writeFileSync(join(repoRoot, 'x.ts'), '');

    const badScan: ArchScanFn = async () => { throw new Error('scan error'); };
    const artifact = knowledgeArtifact({
      category: 'architecture',
      repoRoot,
      pointers: [{ path: 'x.ts', note: 'module' }],
    });
    const ctx: CheckContext = { sandboxRoot: repoRoot };
    const r = await architectureCheck(badScan).run(baseGoal, textArt(JSON.stringify(artifact)), ctx);
    expect(r.ok).toBe(false);
    expect(r.detail).toContain('scan error');
  });

  it('check name is knowledge:architecture', () => {
    expect(architectureCheck(noScanFn).name).toBe('knowledge:architecture');
  });
});

// ---------------------------------------------------------------------------
// stackCheck
// ---------------------------------------------------------------------------

describe('stackCheck', () => {
  it('passes when no package.json exists (no version claims to contradict)', async () => {
    const repoRoot = makeTmp();
    const artifact = knowledgeArtifact({ category: 'stack', repoRoot, pointers: [] });
    const ctx: CheckContext = { sandboxRoot: repoRoot };
    const r = await stackCheck().run(baseGoal, textArt(JSON.stringify(artifact)), ctx);
    expect(r.ok).toBe(true);
    expect(r.detail).toContain('No package.json');
  });

  it('passes when no pointer note contains a version claim', async () => {
    const repoRoot = makeTmp();
    writeFileSync(join(repoRoot, 'package.json'), JSON.stringify({
      dependencies: { express: '^4.18.0' },
    }));

    const artifact = knowledgeArtifact({
      category: 'stack',
      repoRoot,
      pointers: [{ path: 'package.json', note: 'manifest — no version claim here' }],
    });
    const ctx: CheckContext = { sandboxRoot: repoRoot };
    const r = await stackCheck().run(baseGoal, textArt(JSON.stringify(artifact)), ctx);
    expect(r.ok).toBe(true);
  });

  it('passes when claimed version matches manifest (exact semver)', async () => {
    const repoRoot = makeTmp();
    writeFileSync(join(repoRoot, 'package.json'), JSON.stringify({
      dependencies: { typescript: '^5.4.0' },
    }));

    const artifact = knowledgeArtifact({
      category: 'stack',
      repoRoot,
      pointers: [{ path: 'package.json', note: 'version:typescript@5.4.0 is the declared version' }],
    });
    const ctx: CheckContext = { sandboxRoot: repoRoot };
    const r = await stackCheck().run(baseGoal, textArt(JSON.stringify(artifact)), ctx);
    expect(r.ok).toBe(true);
  });

  it('fails when claimed version contradicts manifest', async () => {
    const repoRoot = makeTmp();
    writeFileSync(join(repoRoot, 'package.json'), JSON.stringify({
      dependencies: { typescript: '^5.4.0' },
    }));

    const artifact = knowledgeArtifact({
      category: 'stack',
      repoRoot,
      pointers: [{ path: 'package.json', note: 'version:typescript@3.9.0 (stale claim)' }],
    });
    const ctx: CheckContext = { sandboxRoot: repoRoot };
    const r = await stackCheck().run(baseGoal, textArt(JSON.stringify(artifact)), ctx);
    expect(r.ok).toBe(false);
    expect(r.detail).toContain('typescript');
    expect(r.detail).toContain('mismatch');
  });

  it('passes when claimed package is not in manifest (cannot contradict)', async () => {
    const repoRoot = makeTmp();
    writeFileSync(join(repoRoot, 'package.json'), JSON.stringify({
      dependencies: { express: '^4.18.0' },
    }));

    const artifact = knowledgeArtifact({
      category: 'stack',
      repoRoot,
      pointers: [{ path: 'package.json', note: 'version:unknown-package@1.0.0' }],
    });
    const ctx: CheckContext = { sandboxRoot: repoRoot };
    const r = await stackCheck().run(baseGoal, textArt(JSON.stringify(artifact)), ctx);
    expect(r.ok).toBe(true);
  });

  it('check name is knowledge:stack', () => {
    expect(stackCheck().name).toBe('knowledge:stack');
  });
});

// ---------------------------------------------------------------------------
// conventionsCheck
// ---------------------------------------------------------------------------

describe('conventionsCheck', () => {
  it('passes when artifact has no pointers', async () => {
    const artifact = knowledgeArtifact({ category: 'conventions', pointers: [] });
    const r = await conventionsCheck().run(baseGoal, textArt(JSON.stringify(artifact)));
    expect(r.ok).toBe(true);
  });

  it('passes when all exemplar pointer paths exist on disk', async () => {
    const repoRoot = makeTmp();
    mkdirSync(join(repoRoot, 'src'), { recursive: true });
    writeFileSync(join(repoRoot, 'src', 'example.ts'), '// exemplar');

    const artifact = knowledgeArtifact({
      category: 'conventions',
      repoRoot,
      pointers: [{ path: 'src/example.ts', note: 'shows the naming convention' }],
    });
    const ctx: CheckContext = { sandboxRoot: repoRoot };
    const r = await conventionsCheck().run(baseGoal, textArt(JSON.stringify(artifact)), ctx);
    expect(r.ok).toBe(true);
    expect(r.detail).toContain('1 exemplar');
  });

  it('fails when an exemplar pointer path does not exist', async () => {
    const repoRoot = makeTmp();

    const artifact = knowledgeArtifact({
      category: 'conventions',
      repoRoot,
      pointers: [{ path: 'src/deleted.ts', note: 'deleted exemplar' }],
    });
    const ctx: CheckContext = { sandboxRoot: repoRoot };
    const r = await conventionsCheck().run(baseGoal, textArt(JSON.stringify(artifact)), ctx);
    expect(r.ok).toBe(false);
    expect(r.detail).toContain('src/deleted.ts');
  });

  it('fails when only one of multiple exemplar paths is missing', async () => {
    const repoRoot = makeTmp();
    writeFileSync(join(repoRoot, 'ok.ts'), '');

    const artifact = knowledgeArtifact({
      category: 'conventions',
      repoRoot,
      pointers: [
        { path: 'ok.ts', note: 'exists' },
        { path: 'missing.ts', note: 'gone' },
      ],
    });
    const ctx: CheckContext = { sandboxRoot: repoRoot };
    const r = await conventionsCheck().run(baseGoal, textArt(JSON.stringify(artifact)), ctx);
    expect(r.ok).toBe(false);
    expect(r.detail).toContain('missing.ts');
  });

  it('check name is knowledge:conventions', () => {
    expect(conventionsCheck().name).toBe('knowledge:conventions');
  });
});

// ---------------------------------------------------------------------------
// testScaffoldCheck
// ---------------------------------------------------------------------------

describe('testScaffoldCheck', () => {
  it('fails with "no exec context" when ctx is absent', async () => {
    const artifact = knowledgeArtifact({ category: 'test-scaffold' });
    const r = await testScaffoldCheck().run(baseGoal, textArt(JSON.stringify(artifact)));
    expect(r.ok).toBe(false);
    expect(r.detail).toBe('no exec context');
  });

  it('fails with "no exec context" when ctx.runScript is absent', async () => {
    const artifact = knowledgeArtifact({ category: 'test-scaffold' });
    const r = await testScaffoldCheck().run(
      baseGoal,
      textArt(JSON.stringify(artifact)),
      { sandboxRoot: '/tmp' },
    );
    expect(r.ok).toBe(false);
    expect(r.detail).toBe('no exec context');
  });

  it('passes when the default "test" script runs green', async () => {
    const artifact = knowledgeArtifact({ category: 'test-scaffold', pointers: [] });
    const r = await testScaffoldCheck().run(
      baseGoal,
      textArt(JSON.stringify(artifact)),
      makeGreenCtx(),
    );
    expect(r.ok).toBe(true);
    expect(r.detail).toContain('"test"');
  });

  it('fails when the script exits non-zero', async () => {
    const artifact = knowledgeArtifact({ category: 'test-scaffold', pointers: [] });
    const r = await testScaffoldCheck().run(
      baseGoal,
      textArt(JSON.stringify(artifact)),
      makeRedCtx(undefined, 1, 'assertion failed'),
    );
    expect(r.ok).toBe(false);
    expect(r.detail).toContain('exit 1');
    expect(r.detail).toContain('assertion failed');
  });

  it('uses the script name from pointer note when present', async () => {
    let capturedName = '';
    const captureCtx: CheckContext = {
      runScript: async (name) => {
        capturedName = name;
        return { ok: true, exitStatus: 0, output: '', fullOutput: '', durationMs: 1, timedOut: false };
      },
    };

    const artifact = knowledgeArtifact({
      category: 'test-scaffold',
      pointers: [{ path: 'tests/', note: 'run via script:vitest-run' }],
    });
    await testScaffoldCheck().run(baseGoal, textArt(JSON.stringify(artifact)), captureCtx);
    expect(capturedName).toBe('vitest-run');
  });

  it('falls back to "test" when no script: token in pointer notes', async () => {
    let capturedName = '';
    const captureCtx: CheckContext = {
      runScript: async (name) => {
        capturedName = name;
        return { ok: true, exitStatus: 0, output: '', fullOutput: '', durationMs: 1, timedOut: false };
      },
    };

    const artifact = knowledgeArtifact({
      category: 'test-scaffold',
      pointers: [{ path: 'tests/', note: 'test directory with no script token' }],
    });
    await testScaffoldCheck().run(baseGoal, textArt(JSON.stringify(artifact)), captureCtx);
    expect(capturedName).toBe('test');
  });

  it('check name is knowledge:test-scaffold', () => {
    expect(testScaffoldCheck().name).toBe('knowledge:test-scaffold');
  });
});

// ---------------------------------------------------------------------------
// diveAnchorCheck
// ---------------------------------------------------------------------------

describe('diveAnchorCheck', () => {
  it('passes when there are no facts (empty dive)', async () => {
    const rf = regionFacts({ facts: [] });
    const r = await diveAnchorCheck().run(baseGoal, textArt(JSON.stringify(rf)));
    expect(r.ok).toBe(true);
  });

  it('passes when all anchor paths exist and line counts are valid', async () => {
    const repoRoot = makeTmp();
    writeFileSync(join(repoRoot, 'auth.ts'), 'line1\nline2\nline3\nline4\nline5\n');

    const rf = regionFacts({
      repoRoot,
      facts: [
        {
          claim: 'auth is guarded by middleware',
          anchors: [{ path: 'auth.ts', line: 3 }],
          sha: 'abc',
          confidence: 'high',
        },
      ],
    });
    const ctx: CheckContext = { sandboxRoot: repoRoot };
    const r = await diveAnchorCheck().run(baseGoal, textArt(JSON.stringify(rf)), ctx);
    expect(r.ok).toBe(true);
    expect(r.detail).toContain('1 fact');
    expect(r.detail).toContain('1 anchor');
  });

  it('fails when an anchor path does not exist', async () => {
    const repoRoot = makeTmp();

    const rf = regionFacts({
      repoRoot,
      facts: [
        {
          claim: 'deleted file',
          anchors: [{ path: 'missing.ts', line: 1 }],
          sha: 'abc',
          confidence: 'low',
        },
      ],
    });
    const ctx: CheckContext = { sandboxRoot: repoRoot };
    const r = await diveAnchorCheck().run(baseGoal, textArt(JSON.stringify(rf)), ctx);
    expect(r.ok).toBe(false);
    expect(r.detail).toContain('missing.ts');
    expect(r.detail).toContain('not found');
  });

  it('fails when anchor line exceeds the file line count', async () => {
    const repoRoot = makeTmp();
    writeFileSync(join(repoRoot, 'short.ts'), 'line1\nline2\n');

    const rf = regionFacts({
      repoRoot,
      facts: [
        {
          claim: 'claim at line 99',
          anchors: [{ path: 'short.ts', line: 99 }],
          sha: 'abc',
          confidence: 'high',
        },
      ],
    });
    const ctx: CheckContext = { sandboxRoot: repoRoot };
    const r = await diveAnchorCheck().run(baseGoal, textArt(JSON.stringify(rf)), ctx);
    expect(r.ok).toBe(false);
    expect(r.detail).toContain('short.ts:99');
    expect(r.detail).toContain('line');
  });

  it('fails and names all failing anchors across multiple facts', async () => {
    const repoRoot = makeTmp();
    writeFileSync(join(repoRoot, 'only.ts'), 'single line');

    const rf = regionFacts({
      repoRoot,
      facts: [
        {
          claim: 'first claim',
          anchors: [{ path: 'missing-a.ts', line: 1 }],
          sha: 'abc',
          confidence: 'high',
        },
        {
          claim: 'second claim',
          anchors: [{ path: 'only.ts', line: 50 }],
          sha: 'abc',
          confidence: 'medium',
        },
      ],
    });
    const ctx: CheckContext = { sandboxRoot: repoRoot };
    const r = await diveAnchorCheck().run(baseGoal, textArt(JSON.stringify(rf)), ctx);
    expect(r.ok).toBe(false);
    expect(r.detail).toContain('missing-a.ts');
    expect(r.detail).toContain('only.ts:50');
  });

  it('fails when artifact JSON does not match RegionFacts shape', async () => {
    const r = await diveAnchorCheck().run(baseGoal, textArt(JSON.stringify({ wrong: 'shape' })));
    expect(r.ok).toBe(false);
    expect(r.detail).toContain('RegionFacts');
  });

  it('check name is knowledge:dive-anchor', () => {
    expect(diveAnchorCheck().name).toBe('knowledge:dive-anchor');
  });
});

// ---------------------------------------------------------------------------
// mapRepoCheck dispatcher
// ---------------------------------------------------------------------------

describe('mapRepoCheck — dispatcher', () => {
  it('dispatches to architectureCheck for category "architecture"', async () => {
    const artifact = knowledgeArtifact({ category: 'architecture', pointers: [] });
    const r = await mapRepoCheck(noScanFn).run(baseGoal, textArt(JSON.stringify(artifact)));
    expect(r.ok).toBe(true);
    expect(r.detail).toContain('Architecture artifact');
  });

  it('dispatches to stackCheck for category "stack"', async () => {
    const repoRoot = makeTmp();
    const artifact = knowledgeArtifact({ category: 'stack', repoRoot, pointers: [] });
    const ctx: CheckContext = { sandboxRoot: repoRoot };
    const r = await mapRepoCheck(noScanFn).run(baseGoal, textArt(JSON.stringify(artifact)), ctx);
    expect(r.ok).toBe(true);
    expect(r.detail).toContain('No package.json');
  });

  it('dispatches to conventionsCheck for category "conventions"', async () => {
    const artifact = knowledgeArtifact({ category: 'conventions', pointers: [] });
    const r = await mapRepoCheck(noScanFn).run(baseGoal, textArt(JSON.stringify(artifact)));
    expect(r.ok).toBe(true);
    expect(r.detail).toContain('Conventions artifact');
  });

  it('dispatches to testScaffoldCheck for category "test-scaffold"', async () => {
    const artifact = knowledgeArtifact({ category: 'test-scaffold', pointers: [] });
    const r = await mapRepoCheck(noScanFn).run(baseGoal, textArt(JSON.stringify(artifact)), makeGreenCtx());
    expect(r.ok).toBe(true);
  });

  it('passes through for unhandled categories (design-system, deps, credentials)', async () => {
    const artifact = knowledgeArtifact({ category: 'design-system', pointers: [] });
    const r = await mapRepoCheck(noScanFn).run(baseGoal, textArt(JSON.stringify(artifact)));
    expect(r.ok).toBe(true);
    expect(r.detail).toContain('design-system');
  });

  it('fails on null artifact (before dispatch)', async () => {
    const r = await mapRepoCheck(noScanFn).run(baseGoal, null);
    expect(r.ok).toBe(false);
  });

  it('fails on invalid JSON (before dispatch)', async () => {
    const r = await mapRepoCheck(noScanFn).run(baseGoal, textArt('not json'));
    expect(r.ok).toBe(false);
  });

  it('check name is knowledge:map-repo', () => {
    expect(mapRepoCheck(noScanFn).name).toBe('knowledge:map-repo');
  });
});

// ---------------------------------------------------------------------------
// Deterministic gate: a failing validation cannot emit a passing report
// the gate catches failure before any judge is consulted
// ---------------------------------------------------------------------------

describe('deterministic gate — failing validation blocks output', () => {
  it('architectureCheck with a missing pointer path returns ok:false (gate catches it)', async () => {
    const repoRoot = makeTmp();

    const artifact = knowledgeArtifact({
      category: 'architecture',
      repoRoot,
      pointers: [{ path: 'nonexistent.ts', note: 'gone' }],
    });
    const ctx: CheckContext = { sandboxRoot: repoRoot };
    const gateResult = await architectureCheck(noScanFn).run(
      baseGoal,
      textArt(JSON.stringify(artifact)),
      ctx,
    );
    expect(gateResult.ok).toBe(false);
    expect(gateResult.detail).toContain('nonexistent.ts');
  });

  it('testScaffoldCheck red run returns ok:false (gate catches it, no judge needed)', async () => {
    const artifact = knowledgeArtifact({ category: 'test-scaffold', pointers: [] });
    const gateResult = await testScaffoldCheck().run(
      baseGoal,
      textArt(JSON.stringify(artifact)),
      makeRedCtx(undefined, 1, 'FAIL: 3 tests failed'),
    );
    expect(gateResult.ok).toBe(false);
    expect(gateResult.detail).toContain('FAIL: 3 tests failed');
  });

  it('diveAnchorCheck with bad anchor returns ok:false (gate catches it)', async () => {
    const repoRoot = makeTmp();

    const rf = regionFacts({
      repoRoot,
      facts: [
        {
          claim: 'something at a missing file',
          anchors: [{ path: 'gone.ts', line: 1 }],
          sha: 'abc',
          confidence: 'low',
        },
      ],
    });
    const ctx: CheckContext = { sandboxRoot: repoRoot };
    const gateResult = await diveAnchorCheck().run(
      baseGoal,
      textArt(JSON.stringify(rf)),
      ctx,
    );
    expect(gateResult.ok).toBe(false);
    expect(gateResult.detail).toContain('gone.ts');
  });
});

// ---------------------------------------------------------------------------
// scoped-package version claim (version:@scope/pkg@x.y.z)
// ---------------------------------------------------------------------------

describe('stackCheck — scoped-package version claim', () => {
  it('passes when a scoped package version claim matches the manifest', async () => {
    const repoRoot = makeTmp();
    writeFileSync(join(repoRoot, 'package.json'), JSON.stringify({
      dependencies: { '@scope/pkg': '^2.3.0' },
    }));

    const artifact = knowledgeArtifact({
      category: 'stack',
      repoRoot,
      pointers: [{ path: 'package.json', note: 'version:@scope/pkg@2.3.0 is the runtime dep' }],
    });
    const ctx: CheckContext = { sandboxRoot: repoRoot };
    const r = await stackCheck().run(baseGoal, textArt(JSON.stringify(artifact)), ctx);
    expect(r.ok).toBe(true);
  });

  it('fails when a scoped package version claim contradicts the manifest', async () => {
    const repoRoot = makeTmp();
    writeFileSync(join(repoRoot, 'package.json'), JSON.stringify({
      dependencies: { '@scope/pkg': '^2.3.0' },
    }));

    const artifact = knowledgeArtifact({
      category: 'stack',
      repoRoot,
      pointers: [{ path: 'package.json', note: 'version:@scope/pkg@1.0.0 (stale)' }],
    });
    const ctx: CheckContext = { sandboxRoot: repoRoot };
    const r = await stackCheck().run(baseGoal, textArt(JSON.stringify(artifact)), ctx);
    expect(r.ok).toBe(false);
    expect(r.detail).toContain('@scope/pkg');
    expect(r.detail).toContain('mismatch');
  });

  it('bare name@version in note (no version: prefix) is ignored — no false positive', async () => {
    const repoRoot = makeTmp();
    writeFileSync(join(repoRoot, 'package.json'), JSON.stringify({
      dependencies: { typescript: '^5.4.0' },
    }));

    // Old bare format without version: prefix should now be ignored
    const artifact = knowledgeArtifact({
      category: 'stack',
      repoRoot,
      pointers: [{ path: 'package.json', note: 'typescript@3.9.0 (old format, no prefix)' }],
    });
    const ctx: CheckContext = { sandboxRoot: repoRoot };
    const r = await stackCheck().run(baseGoal, textArt(JSON.stringify(artifact)), ctx);
    // Without the version: prefix the claim is not parsed — no contradiction detected
    expect(r.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// architectureCheck — scan and existence halves use the same root
// ---------------------------------------------------------------------------

describe('architectureCheck — single resolved root for scan + existence', () => {
  it('uses sandboxRoot for both existence and scan when sandboxRoot is set and artifact repoRoot is bogus', async () => {
    const sandboxRoot = makeTmp();
    mkdirSync(join(sandboxRoot, 'src'), { recursive: true });
    writeFileSync(join(sandboxRoot, 'src', 'main.ts'), 'export {}');

    // The artifact carries a bogus repoRoot that does not exist on disk.
    // The sandboxRoot is set in ctx — both halves must use it.
    let scannedRoot = '';
    const captureScanFn: ArchScanFn = async (root) => {
      scannedRoot = root;
      return [{ from: 'src/main.ts', to: 'src/main.ts' }];
    };

    const artifact = knowledgeArtifact({
      category: 'architecture',
      repoRoot: '/bogus/nonexistent/path',
      pointers: [{ path: 'src/main.ts', note: 'entry point' }],
    });
    const ctx: CheckContext = { sandboxRoot };
    const r = await architectureCheck(captureScanFn).run(baseGoal, textArt(JSON.stringify(artifact)), ctx);

    // Existence check must succeed (file is under sandboxRoot, not bogus repoRoot)
    expect(r.ok).toBe(true);
    // Scan function must have received sandboxRoot, not the bogus repoRoot
    expect(scannedRoot).toBe(sandboxRoot);
  });
});

// ---------------------------------------------------------------------------
// diveAnchorCheck — binary file anchor (best-effort, no crash)
// ---------------------------------------------------------------------------

describe('diveAnchorCheck — binary file anchor', () => {
  it('handles a binary file anchor without crashing (best-effort utf8 line count)', async () => {
    const repoRoot = makeTmp();
    // Write a file with null bytes to simulate binary content
    const binaryContent = Buffer.from([0x00, 0x01, 0x02, 0x0a, 0x03, 0x04, 0x0a]);
    writeFileSync(join(repoRoot, 'image.bin'), binaryContent);

    const rf = regionFacts({
      repoRoot,
      facts: [
        {
          claim: 'binary asset referenced',
          // Line 1 exists (binary content has 2 newlines → at least 2 lines)
          anchors: [{ path: 'image.bin', line: 1 }],
          sha: 'abc',
          confidence: 'low',
        },
      ],
    });
    const ctx: CheckContext = { sandboxRoot: repoRoot };
    // Should not throw; result is determined by whether utf8 line-count >= anchor line
    const r = await diveAnchorCheck().run(baseGoal, textArt(JSON.stringify(rf)), ctx);
    // The file exists and has a valid utf8 interpretation with lines, so it should pass
    expect(r.ok).toBe(true);
  });
});
