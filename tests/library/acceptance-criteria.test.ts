/**
 * Tests for the milestone-loop acceptance-criteria done-condition (ADR-032):
 * the `criteriaWellFormed` deterministic floor, the shared parser, and the
 * criterion→DeterministicCheck mapping.
 */

import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  criteriaWellFormed,
  parseAcceptanceCriteria,
  criterionToCheck,
  type AcceptanceCriterion,
} from '../../src/library/acceptance-criteria.js';
import { criteriaWellFormed as criteriaWellFormedReExport } from '../../src/library/checks.js';
import type { Goal } from '../../src/contract/goal.js';
import type { Artifact } from '../../src/contract/report.js';
import type { CheckContext } from '../../src/contract/goal-type.js';
import type { ScriptResult } from '../../src/contract/tool.js';

const baseGoal: Goal = {
  id: 'g1',
  type: 'author-acceptance-criteria',
  parentId: null,
  title: 'Mint criteria',
  spec: {},
  intent: 'production',
  scope: ['src/'],
  budget: { attempts: 1, tokens: 1000, toolCalls: 10, wallClockMs: 60000 },
  memories: [],
};

/** A text artifact carrying the JSON-encoded criteria checklist. */
const criteriaArtifact = (criteria: unknown): Artifact => ({
  kind: 'text',
  text: JSON.stringify({ criteria }),
});

const goodCriteria = [
  { id: 'c1', claim: 'the build typechecks', check: { script: 'typecheck' } },
  { id: 'c2', claim: 'the parser module exists', check: { file: 'src/parser.ts', anchor: 'export' } },
  { id: 'c3', claim: 'a config file exists', check: { file: 'config.json' } },
];

// ---------------------------------------------------------------------------
// criteriaWellFormed — accept
// ---------------------------------------------------------------------------

describe('criteriaWellFormed — accept', () => {
  const check = criteriaWellFormed();

  it('passes a checklist where every criterion names a runnable predicate', async () => {
    const r = await check.run(baseGoal, criteriaArtifact(goodCriteria));
    expect(r.ok).toBe(true);
  });

  it('accepts a script check, a file+anchor check, and a bare file check', async () => {
    const r = await check.run(
      baseGoal,
      criteriaArtifact([
        { id: 'a', claim: 'x', check: { script: 's' } },
        { id: 'b', claim: 'y', check: { file: 'f.ts', anchor: 'foo' } },
        { id: 'c', claim: 'z', check: { file: 'g.ts' } },
      ]),
    );
    expect(r.ok).toBe(true);
  });

  it('is re-exported from the checks library at its spec-named home', () => {
    expect(typeof criteriaWellFormedReExport).toBe('function');
    expect(criteriaWellFormedReExport().name).toBe('criteria-well-formed');
  });

  it('accepts a {capture} check whose name is in the declared captures', async () => {
    const r = await check.run(
      baseGoal,
      criteriaArtifact([{ id: 'a', claim: 'renders right', check: { capture: 'invoice-total' } }]),
      { declaredCaptures: { 'invoice-total': { kind: 'render-document', file: 'x', renderScript: 'r', outputPath: 'o' } } },
    );
    expect(r.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// criteriaWellFormed — reject
// ---------------------------------------------------------------------------

describe('criteriaWellFormed — reject', () => {
  const check = criteriaWellFormed();

  it('rejects a null artifact', async () => {
    const r = await check.run(baseGoal, null);
    expect(r.ok).toBe(false);
  });

  it('rejects a non-text (files) artifact', async () => {
    const r = await check.run(baseGoal, { kind: 'files', files: [{ path: 'a', content: 'b' }] });
    expect(r.ok).toBe(false);
  });

  it('rejects non-JSON text', async () => {
    const r = await check.run(baseGoal, { kind: 'text', text: 'not json at all' });
    expect(r.ok).toBe(false);
  });

  it('rejects a payload with no criteria array', async () => {
    const r = await check.run(baseGoal, { kind: 'text', text: JSON.stringify({ foo: 1 }) });
    expect(r.ok).toBe(false);
  });

  it('rejects an empty checklist', async () => {
    const r = await check.run(baseGoal, criteriaArtifact([]));
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/empty/i);
  });

  it('rejects a {capture} check naming an undeclared capture', async () => {
    const r = await check.run(
      baseGoal,
      criteriaArtifact([{ id: 'a', claim: 'renders', check: { capture: 'not-declared' } }]),
      { declaredCaptures: { 'invoice-total': { kind: 'render-document', file: 'x', renderScript: 'r', outputPath: 'o' } } },
    );
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/not declared/i);
  });

  it('rejects a {capture} check when no captures are declared at all', async () => {
    const r = await check.run(
      baseGoal,
      criteriaArtifact([{ id: 'a', claim: 'renders', check: { capture: 'anything' } }]),
    );
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/not declared/i);
  });

  it('rejects a duplicated id', async () => {
    const r = await check.run(
      baseGoal,
      criteriaArtifact([
        { id: 'dup', claim: 'x', check: { script: 's' } },
        { id: 'dup', claim: 'y', check: { script: 't' } },
      ]),
    );
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/duplicated/i);
  });

  it('rejects a blank id', async () => {
    const r = await check.run(
      baseGoal,
      criteriaArtifact([{ id: '   ', claim: 'x', check: { script: 's' } }]),
    );
    expect(r.ok).toBe(false);
  });

  it('rejects a blank claim', async () => {
    const r = await check.run(
      baseGoal,
      criteriaArtifact([{ id: 'c1', claim: '', check: { script: 's' } }]),
    );
    expect(r.ok).toBe(false);
  });

  it('rejects a prose-only rubric-line check (a string)', async () => {
    const r = await check.run(
      baseGoal,
      criteriaArtifact([{ id: 'c1', claim: 'clean code', check: 'the code should be clean' }]),
    );
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/runnable predicate/i);
  });

  it('rejects a check object with neither script nor file', async () => {
    const r = await check.run(
      baseGoal,
      criteriaArtifact([{ id: 'c1', claim: 'x', check: { rubric: 'looks good' } }]),
    );
    expect(r.ok).toBe(false);
  });

  it('rejects a check that mixes script and file', async () => {
    const r = await check.run(
      baseGoal,
      criteriaArtifact([{ id: 'c1', claim: 'x', check: { script: 's', file: 'f.ts' } }]),
    );
    expect(r.ok).toBe(false);
  });

  it('rejects an empty script name', async () => {
    const r = await check.run(
      baseGoal,
      criteriaArtifact([{ id: 'c1', claim: 'x', check: { script: '' } }]),
    );
    expect(r.ok).toBe(false);
  });

  it('rejects an anchor that is not a non-empty string', async () => {
    const r = await check.run(
      baseGoal,
      criteriaArtifact([{ id: 'c1', claim: 'x', check: { file: 'f.ts', anchor: '' } }]),
    );
    expect(r.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// parseAcceptanceCriteria
// ---------------------------------------------------------------------------

describe('parseAcceptanceCriteria', () => {
  it('returns the ordered criteria for a well-formed artifact', () => {
    const parsed = parseAcceptanceCriteria(criteriaArtifact(goodCriteria));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.criteria.map((c) => c.id)).toEqual(['c1', 'c2', 'c3']);
    }
  });

  it('tolerates a fenced JSON block', () => {
    const parsed = parseAcceptanceCriteria({
      kind: 'text',
      text: '```json\n' + JSON.stringify({ criteria: goodCriteria }) + '\n```',
    });
    expect(parsed.ok).toBe(true);
  });

  it('fails a null artifact', () => {
    expect(parseAcceptanceCriteria(null).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// criterionToCheck — maps to the existing runnable checks
// ---------------------------------------------------------------------------

describe('criterionToCheck', () => {
  const goal: Goal = { ...baseGoal, type: 'deliver-intent' };

  const scriptResult = (ok: boolean): ScriptResult => ({
    ok,
    exitStatus: ok ? 0 : 1,
    output: ok ? 'pass' : 'fail',
    timedOut: false,
  });

  it('maps a {script} criterion to a passing runScriptCheck when the script exits 0', async () => {
    const criterion: AcceptanceCriterion = { id: 'c', claim: 'x', check: { script: 'mytest' } };
    const ctx: CheckContext = { runScript: async () => scriptResult(true) };
    const r = await criterionToCheck(criterion).run(goal, null, ctx);
    expect(r.ok).toBe(true);
  });

  it('maps a {script} criterion to a failing check when the script exits non-zero', async () => {
    const criterion: AcceptanceCriterion = { id: 'c', claim: 'x', check: { script: 'mytest' } };
    const ctx: CheckContext = { runScript: async () => scriptResult(false) };
    const r = await criterionToCheck(criterion).run(goal, null, ctx);
    expect(r.ok).toBe(false);
  });

  it('maps a {file, anchor} criterion to a fileContains check that passes when present', async () => {
    const criterion: AcceptanceCriterion = {
      id: 'c',
      claim: 'x',
      check: { file: 'src/a.ts', anchor: 'export const' },
    };
    const artifact: Artifact = {
      kind: 'files',
      files: [{ path: 'src/a.ts', content: 'export const a = 1;' }],
    };
    const r = await criterionToCheck(criterion).run(goal, artifact);
    expect(r.ok).toBe(true);
  });

  it('a {file} criterion reads the worktree when a sandbox is in context, not just the artifact', async () => {
    const root = mkdtempSync(join(tmpdir(), 'corellia-criterion-worktree-'));
    try {
      mkdirSync(join(root, 'src'), { recursive: true });
      writeFileSync(join(root, 'src', 'a.ts'), 'export const a = 1;\n');
      const criterion: AcceptanceCriterion = {
        id: 'c',
        claim: 'x',
        check: { file: 'src/a.ts', anchor: 'export const' },
      };
      // The artifact does NOT list src/a.ts — only the worktree has it (e.g.
      // written by an earlier attempt and salvaged). The check must still pass.
      const ctx: CheckContext = { sandboxRoot: root };
      const r = await criterionToCheck(criterion).run(goal, null, ctx);
      expect(r.ok).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('maps a {file, anchor} criterion to a failing check when the anchor is absent', async () => {
    const criterion: AcceptanceCriterion = {
      id: 'c',
      claim: 'x',
      check: { file: 'src/a.ts', anchor: 'MISSING' },
    };
    const artifact: Artifact = {
      kind: 'files',
      files: [{ path: 'src/a.ts', content: 'export const a = 1;' }],
    };
    const r = await criterionToCheck(criterion).run(goal, artifact);
    expect(r.ok).toBe(false);
  });

  it('maps a {capture} criterion to captureSucceeded that passes when the capture produces output', async () => {
    const criterion: AcceptanceCriterion = { id: 'c', claim: 'renders right', check: { capture: 'shot' } };
    const ctx: CheckContext = {
      runCapture: async () => ({ ok: true, kind: 'render-document', outputRef: 'out.png', detail: 'ok', durationMs: 5 }),
    };
    const r = await criterionToCheck(criterion).run(goal, null, ctx);
    expect(r.ok).toBe(true);
  });

  it('maps a {capture} criterion to a failing check when the capture produces no output', async () => {
    const criterion: AcceptanceCriterion = { id: 'c', claim: 'renders right', check: { capture: 'shot' } };
    const ctx: CheckContext = {
      runCapture: async () => ({ ok: false, kind: 'render-document', detail: 'render exited 1', durationMs: 5 }),
    };
    const r = await criterionToCheck(criterion).run(goal, null, ctx);
    expect(r.ok).toBe(false);
  });

  it('a {capture} criterion fails safe when no capture context is present', async () => {
    const criterion: AcceptanceCriterion = { id: 'c', claim: 'renders right', check: { capture: 'shot' } };
    const r = await criterionToCheck(criterion).run(goal, null, {});
    expect(r.ok).toBe(false);
    expect(r.detail).toContain('no capture context');
  });
});

describe('declared-script validation at author time', () => {
  const criteriaText = (script: string): Artifact => ({
    kind: 'text',
    text: JSON.stringify({
      criteria: [{ id: 'c1', claim: 'suite green', check: { script } }],
    }),
  });

  it('rejects a {script} criterion naming an undeclared script, listing the declared set', async () => {
    const ctx: CheckContext = { declaredScriptNames: ['test', 'typecheck', 'lint'] };
    const r = await criteriaWellFormed().run(baseGoal, criteriaText('npm run test'), ctx);
    expect(r.ok).toBe(false);
    expect(r.detail).toContain('npm run test');
    expect(r.detail).toContain('test, typecheck, lint');
  });

  it('accepts a {script} criterion naming a declared script', async () => {
    const ctx: CheckContext = { declaredScriptNames: ['test', 'typecheck', 'lint'] };
    const r = await criteriaWellFormed().run(baseGoal, criteriaText('test'), ctx);
    expect(r.ok).toBe(true);
  });

  it('skips the validation when the context carries no declared names', async () => {
    const r = await criteriaWellFormed().run(baseGoal, criteriaText('anything'), {});
    expect(r.ok).toBe(true);
  });
});
