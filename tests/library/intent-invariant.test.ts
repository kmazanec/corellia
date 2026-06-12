/**
 * Hard invariant test: deterministic checks are intent-blind.
 *
 * Two halves:
 *
 *   1. Behavioral: the same artifact + goal produces the same check result across
 *      all three intents ('production', 'spike', 'characterization'), parameterized
 *      over every deterministic check registered in checks.ts and knowledge-checks.ts.
 *
 *   2. Static: the string 'intent' does not appear as source text in
 *      src/library/checks.ts or src/library/knowledge-checks.ts. The test reads
 *      the files directly and asserts on the source.
 *
 * Per GOAL-TYPES.md: "Deterministic-gate declarations take no intent input"
 * (constitution rule 5). The engine wiring of intent into judge rubrics is a
 * concurrent feature; the library layer must never let intent leak into a
 * deterministic check.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  artifactPresent,
  filesWithinScope,
  fileContains,
  processClean,
  runScriptCheck,
} from '../../src/library/checks.js';
import {
  architectureCheck,
  stackCheck,
  conventionsCheck,
  testScaffoldCheck,
  diveAnchorCheck,
  mapRepoCheck,
} from '../../src/library/knowledge-checks.js';
import type { Goal, Intent } from '../../src/contract/goal.js';
import type { Artifact } from '../../src/contract/report.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const INTENTS: Intent[] = ['production', 'spike', 'characterization'];

function goalWithIntent(intent: Intent): Goal {
  return {
    id: 'g-invariant',
    type: 'implement',
    parentId: null,
    title: 'Invariant test goal',
    spec: {},
    intent,
    scope: ['src/'],
    budget: { attempts: 3, tokens: 1000, toolCalls: 10, wallClockMs: 60000 },
    memories: [],
  };
}

// A representative artifact for checks from checks.ts
const textArt: Artifact = { kind: 'text', text: 'hello world' };
const filesArt: Artifact = {
  kind: 'files',
  files: [{ path: 'src/index.ts', content: 'export const x = 1;' }],
};
const nullArt: Artifact | null = null;

// A representative KnowledgeArtifact (architecture category, no pointers)
const knowledgeJson = JSON.stringify({
  repoRoot: '/repo',
  category: 'architecture',
  generatedAtSha: 'abc123',
  confidence: 'high',
  status: 'provisional',
  pointers: [],
  summary: 'test artifact',
});
const knowledgeArt: Artifact = { kind: 'text', text: knowledgeJson };

// A representative RegionFacts (empty facts)
const regionJson = JSON.stringify({
  repoRoot: '/repo',
  region: 'src/auth',
  generatedAtSha: 'abc123',
  facts: [],
});
const regionArt: Artifact = { kind: 'text', text: regionJson };

const noScanFn = async (): Promise<[]> => [];

// ---------------------------------------------------------------------------
// Helper: run a check across all three intents and assert identical results
// ---------------------------------------------------------------------------

async function assertIntentInvariant(
  checkName: string,
  checkFn: (goal: Goal, artifact: Artifact | null) => Promise<{ ok: boolean; detail: string }>,
  artifact: Artifact | null,
): Promise<void> {
  const results = await Promise.all(
    INTENTS.map((intent) => checkFn(goalWithIntent(intent), artifact)),
  );

  const [ref, ...rest] = results;
  for (const r of rest) {
    expect(r.ok, `${checkName}: ok should be identical across intents`).toBe(ref.ok);
    expect(r.detail, `${checkName}: detail should be identical across intents`).toBe(ref.detail);
  }
}

// ---------------------------------------------------------------------------
// Behavioral invariant: same artifact, same result, all three intents
// ---------------------------------------------------------------------------

describe('intent invariant — checks.ts checks are intent-blind', () => {
  it('artifactPresent: null artifact → same result for all intents', async () => {
    await assertIntentInvariant(
      'artifactPresent',
      (goal, art) => artifactPresent.run(goal, art),
      nullArt,
    );
  });

  it('artifactPresent: text artifact → same result for all intents', async () => {
    await assertIntentInvariant(
      'artifactPresent',
      (goal, art) => artifactPresent.run(goal, art),
      textArt,
    );
  });

  it('filesWithinScope: null artifact → same result for all intents', async () => {
    await assertIntentInvariant(
      'filesWithinScope',
      (goal, art) => filesWithinScope.run(goal, art),
      nullArt,
    );
  });

  it('filesWithinScope: files artifact within scope → same result for all intents', async () => {
    await assertIntentInvariant(
      'filesWithinScope',
      (goal, art) => filesWithinScope.run(goal, art),
      filesArt,
    );
  });

  it('filesWithinScope: files artifact out of scope → same result for all intents', async () => {
    const outOfScope: Artifact = {
      kind: 'files',
      files: [{ path: 'outside/lib.ts', content: '' }],
    };
    await assertIntentInvariant(
      'filesWithinScope',
      (goal, art) => filesWithinScope.run(goal, art),
      outOfScope,
    );
  });

  it('fileContains: present text → same result for all intents', async () => {
    const check = fileContains('src/index.ts', 'export');
    await assertIntentInvariant(
      'fileContains',
      (goal, art) => check.run(goal, art),
      filesArt,
    );
  });

  it('fileContains: absent text → same result for all intents', async () => {
    const check = fileContains('src/index.ts', 'MISSING_TOKEN_XYZ');
    await assertIntentInvariant(
      'fileContains',
      (goal, art) => check.run(goal, art),
      filesArt,
    );
  });

  it('processClean: no process refs → same result for all intents', async () => {
    await assertIntentInvariant(
      'processClean',
      (goal, art) => processClean.run(goal, art),
      filesArt,
    );
  });

  it('processClean: artifact with process ref → same result for all intents', async () => {
    const dirty: Artifact = {
      kind: 'files',
      files: [{ path: 'src/foo.ts', content: '// F-123 this is a process reference' }],
    };
    await assertIntentInvariant(
      'processClean',
      (goal, art) => processClean.run(goal, art),
      dirty,
    );
  });

  it('runScriptCheck: no ctx → same result for all intents', async () => {
    const check = runScriptCheck('test');
    await assertIntentInvariant(
      'runScriptCheck',
      (goal, art) => check.run(goal, art),
      nullArt,
    );
  });
});

describe('intent invariant — knowledge-checks.ts checks are intent-blind', () => {
  it('architectureCheck: knowledge artifact → same result for all intents', async () => {
    await assertIntentInvariant(
      'architectureCheck',
      (goal, art) => architectureCheck(noScanFn).run(goal, art),
      knowledgeArt,
    );
  });

  it('architectureCheck: null artifact → same result for all intents', async () => {
    await assertIntentInvariant(
      'architectureCheck',
      (goal, art) => architectureCheck(noScanFn).run(goal, art),
      nullArt,
    );
  });

  it('stackCheck: knowledge artifact → same result for all intents', async () => {
    const stackJson = JSON.stringify({
      repoRoot: '/repo',
      category: 'stack',
      generatedAtSha: 'abc123',
      confidence: 'high',
      status: 'provisional',
      pointers: [],
      summary: 'test',
    });
    const stackArt: Artifact = { kind: 'text', text: stackJson };
    await assertIntentInvariant(
      'stackCheck',
      (goal, art) => stackCheck().run(goal, art),
      stackArt,
    );
  });

  it('conventionsCheck: knowledge artifact → same result for all intents', async () => {
    const convJson = JSON.stringify({
      repoRoot: '/repo',
      category: 'conventions',
      generatedAtSha: 'abc123',
      confidence: 'high',
      status: 'provisional',
      pointers: [],
      summary: 'test',
    });
    const convArt: Artifact = { kind: 'text', text: convJson };
    await assertIntentInvariant(
      'conventionsCheck',
      (goal, art) => conventionsCheck().run(goal, art),
      convArt,
    );
  });

  it('testScaffoldCheck: null ctx → same result for all intents', async () => {
    const tsJson = JSON.stringify({
      repoRoot: '/repo',
      category: 'test-scaffold',
      generatedAtSha: 'abc123',
      confidence: 'high',
      status: 'provisional',
      pointers: [],
      summary: 'test',
    });
    const tsArt: Artifact = { kind: 'text', text: tsJson };
    // Without a ctx.runScript, testScaffoldCheck always fails deterministically
    await assertIntentInvariant(
      'testScaffoldCheck',
      (goal, art) => testScaffoldCheck().run(goal, art),
      tsArt,
    );
  });

  it('diveAnchorCheck: region artifact → same result for all intents', async () => {
    await assertIntentInvariant(
      'diveAnchorCheck',
      (goal, art) => diveAnchorCheck().run(goal, art),
      regionArt,
    );
  });

  it('diveAnchorCheck: null artifact → same result for all intents', async () => {
    await assertIntentInvariant(
      'diveAnchorCheck',
      (goal, art) => diveAnchorCheck().run(goal, art),
      nullArt,
    );
  });

  it('mapRepoCheck: architecture artifact → same result for all intents', async () => {
    await assertIntentInvariant(
      'mapRepoCheck',
      (goal, art) => mapRepoCheck(noScanFn).run(goal, art),
      knowledgeArt,
    );
  });

  it('mapRepoCheck: null artifact → same result for all intents', async () => {
    await assertIntentInvariant(
      'mapRepoCheck',
      (goal, art) => mapRepoCheck(noScanFn).run(goal, art),
      nullArt,
    );
  });
});

// ---------------------------------------------------------------------------
// Static invariant: 'intent' must not appear in the source of the check files
// ---------------------------------------------------------------------------

describe('static invariant — "intent" is absent from check source files', () => {
  // Resolve paths relative to this test file's location
  const thisFile = fileURLToPath(import.meta.url);
  // tests/library/ → ../../src/library/
  const srcRoot = join(thisFile, '..', '..', '..', 'src', 'library');

  it('src/library/checks.ts does not contain the word "intent" as a whole word', () => {
    const source = readFileSync(join(srcRoot, 'checks.ts'), 'utf8');
    // The word 'intent' (as a whole word) must not appear in the file.
    // This enforces constitution rule 5: deterministic gates take no intent input.
    // Using \b word-boundary so incidental substrings (e.g. 'intentional') do not
    // trigger false positives.
    expect(source).not.toMatch(/\bintent\b/);
  });

  it('src/library/knowledge-checks.ts does not contain the word "intent" as a whole word', () => {
    const source = readFileSync(join(srcRoot, 'knowledge-checks.ts'), 'utf8');
    // The word 'intent' (as a whole word) must not appear in the file.
    // This enforces constitution rule 5: deterministic gates take no intent input.
    // Using \b word-boundary so incidental substrings (e.g. 'intentional') do not
    // trigger false positives.
    expect(source).not.toMatch(/\bintent\b/);
  });
});
