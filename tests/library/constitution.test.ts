import { describe, it, expect } from 'vitest';
import { lintLibrary } from '../../src/library/constitution.js';
import { starterTypes } from '../../src/library/starter-types.js';
import type { GoalTypeDef } from '../../src/contract/goal-type.js';

// ── Starter types must be clean ───────────────────────────────────────────

describe('lintLibrary(starterTypes())', () => {
  it('returns no violations for the built-in starter set', () => {
    const violations = lintLibrary(starterTypes());
    expect(violations).toHaveLength(0);
  });
});

// ── Violation cases ───────────────────────────────────────────────────────

const baseLeaf: GoalTypeDef = {
  name: 'test-leaf',
  kind: 'make',
  family: 'test',
  leafOnly: true,
  tier: { default: 'mid', ladder: ['mid', 'high'] },
  deterministic: [],
  judgeType: null,
  grants: [],
  inputSchema: { type: 'object' },
  validateInput: () => null,
};

describe('lintLibrary violations', () => {
  it('reports a judge type that has a write grant', () => {
    const defs: GoalTypeDef[] = [
      {
        ...baseLeaf,
        name: 'bad-judge',
        kind: 'judge',
        grants: ['fs.write'],
      },
    ];
    const violations = lintLibrary(defs);
    expect(violations.some((v) => v.includes('write grant'))).toBe(true);
  });

  it('reports a judge type with leafOnly: false', () => {
    const defs: GoalTypeDef[] = [
      {
        ...baseLeaf,
        name: 'non-leaf-judge',
        kind: 'judge',
        leafOnly: false,
        grants: [],
      },
    ];
    const violations = lintLibrary(defs);
    expect(violations.some((v) => v.includes('leafOnly'))).toBe(true);
  });

  it('reports a memory.write grant outside the curate family', () => {
    const defs: GoalTypeDef[] = [
      {
        ...baseLeaf,
        name: 'rogue-writer',
        family: 'build',
        grants: ['memory.write'],
      },
    ];
    const violations = lintLibrary(defs);
    expect(violations.some((v) => v.includes('memory.write'))).toBe(true);
  });

  it('reports a capture.run grant on a non-make type (ADR-042)', () => {
    const defs: GoalTypeDef[] = [
      {
        ...baseLeaf,
        name: 'rogue-capturer',
        kind: 'judge',
        grants: ['capture.run'],
      },
    ];
    const violations = lintLibrary(defs);
    expect(violations.some((v) => v.includes('capture.run'))).toBe(true);
  });

  it('allows a capture.run grant on a make-kind type', () => {
    const defs: GoalTypeDef[] = [
      {
        ...baseLeaf,
        name: 'capturer',
        kind: 'make',
        grants: ['capture.run'],
      },
    ];
    const violations = lintLibrary(defs);
    expect(violations.filter((v) => v.includes('capture.run'))).toHaveLength(0);
  });

  it('reports a mustDecompose type that is leafOnly (a leaf cannot decompose)', () => {
    const defs: GoalTypeDef[] = [
      {
        ...baseLeaf,
        name: 'leaf-must-decompose',
        leafOnly: true,
        mustDecompose: true,
      },
    ];
    const violations = lintLibrary(defs, { checkSkills: false });
    expect(violations.some((v) => v.includes('mustDecompose') && v.includes('leafOnly'))).toBe(true);
  });

  it('reports a mustDecompose type that holds a producing grant', () => {
    const defs: GoalTypeDef[] = [
      {
        ...baseLeaf,
        name: 'contradictory-root',
        leafOnly: false,
        mustDecompose: true,
        grants: ['spawn', 'fs.write'],
      },
    ];
    const violations = lintLibrary(defs, { checkSkills: false });
    expect(violations.some((v) => v.includes('mustDecompose') && v.includes('producing grant'))).toBe(true);
  });

  it('reports an empty tier ladder', () => {
    const defs: GoalTypeDef[] = [
      {
        ...baseLeaf,
        name: 'no-ladder',
        tier: { default: 'mid', ladder: [] },
      },
    ];
    const violations = lintLibrary(defs);
    expect(violations.some((v) => v.includes('empty tier ladder'))).toBe(true);
  });

  it('reports a ladder that does not start at the default tier', () => {
    const defs: GoalTypeDef[] = [
      {
        ...baseLeaf,
        name: 'wrong-start',
        tier: { default: 'mid', ladder: ['low', 'mid', 'high'] },
      },
    ];
    const violations = lintLibrary(defs);
    expect(violations.some((v) => v.includes('does not start at default tier'))).toBe(true);
  });

  it('reports duplicate type names', () => {
    const defs: GoalTypeDef[] = [
      { ...baseLeaf, name: 'dup' },
      { ...baseLeaf, name: 'dup' },
    ];
    const violations = lintLibrary(defs);
    expect(violations.some((v) => v.includes('Duplicate type name'))).toBe(true);
  });

  it('reports a judgeType that names an unregistered def', () => {
    const defs: GoalTypeDef[] = [
      { ...baseLeaf, name: 'worker', judgeType: 'nonexistent-judge' },
    ];
    const violations = lintLibrary(defs, { checkSkills: false });
    expect(violations.some((v) => v.includes('not registered'))).toBe(true);
  });

  it('reports a judgeType that names a non-judge-kind def', () => {
    const defs: GoalTypeDef[] = [
      { ...baseLeaf, name: 'worker', judgeType: 'make-type' },
      { ...baseLeaf, name: 'make-type', kind: 'make', judgeType: null },
    ];
    const violations = lintLibrary(defs, { checkSkills: false });
    expect(violations.some((v) => v.includes('make-type') && v.includes('kind'))).toBe(true);
  });

  // A10: dangerous-grant lint rule
  it('reports a type whose grants match /merge|approve|deploy|spend/ (F-65 A10)', () => {
    const defs: GoalTypeDef[] = [
      { ...baseLeaf, name: 'rogue-merger', grants: ['repo.merge'] },
    ];
    const violations = lintLibrary(defs, { checkSkills: false });
    expect(violations.some((v) => v.includes('dangerous grant'))).toBe(true);
  });

  it('reports a type with an "approve" grant as dangerous (F-65 A10)', () => {
    const defs: GoalTypeDef[] = [
      { ...baseLeaf, name: 'approver', grants: ['workflow.approve'] },
    ];
    const violations = lintLibrary(defs, { checkSkills: false });
    expect(violations.some((v) => v.includes('dangerous grant'))).toBe(true);
  });

  it('reports a type with a "deploy" grant as dangerous (F-65 A10)', () => {
    const defs: GoalTypeDef[] = [
      { ...baseLeaf, name: 'deployer', grants: ['infra.deploy'] },
    ];
    const violations = lintLibrary(defs, { checkSkills: false });
    expect(violations.some((v) => v.includes('dangerous grant'))).toBe(true);
  });

  it('reports a type with a "spend" grant as dangerous (F-65 A10)', () => {
    const defs: GoalTypeDef[] = [
      { ...baseLeaf, name: 'spender', grants: ['budget.spend'] },
    ];
    const violations = lintLibrary(defs, { checkSkills: false });
    expect(violations.some((v) => v.includes('dangerous grant'))).toBe(true);
  });

  it('does not flag safe grants that happen to contain partial matches (F-65 A10)', () => {
    // "fs.read" does not match /merge|approve|deploy|spend/ — must not be flagged.
    const defs: GoalTypeDef[] = [
      { ...baseLeaf, name: 'safe-reader', grants: ['fs.read', 'retrieval.api'] },
    ];
    const violations = lintLibrary(defs, { checkSkills: false });
    expect(violations.filter((v) => v.includes('dangerous grant'))).toHaveLength(0);
  });

  it('reports a real library type missing an input contract', () => {
    const defs: GoalTypeDef[] = [
      {
        ...baseLeaf,
        name: 'implement',
        family: 'build',
        inputSchema: undefined,
        validateInput: undefined,
      },
    ];
    const violations = lintLibrary(defs);
    expect(violations.some((v) => v.includes('input contract'))).toBe(true);
  });

  it('reports non-deliver types that accept free text', () => {
    const defs: GoalTypeDef[] = [
      { ...baseLeaf, name: 'implement', acceptsFreeText: true },
    ];
    const violations = lintLibrary(defs, { checkSkills: false });
    expect(violations.some((v) => v.includes('free-text'))).toBe(true);
  });

  it('reports core types with the wrong kind', () => {
    const defs: GoalTypeDef[] = [
      { ...baseLeaf, name: 'judge-split', family: 'arbiter', core: true, kind: 'make' },
    ];
    const violations = lintLibrary(defs);
    expect(violations.some((v) => v.includes('Core type "judge-split"') && v.includes('kind'))).toBe(true);
  });

  it('reports a learn type with a write grant above its kind ceiling', () => {
    const defs: GoalTypeDef[] = [
      { ...baseLeaf, name: 'rogue-learn', kind: 'learn', grants: ['fs.write'] },
    ];
    const violations = lintLibrary(defs, { checkSkills: false });
    expect(violations.some((v) => v.includes('grant ceiling'))).toBe(true);
  });

  it('reports invalid human touchpoint timeout declarations', () => {
    const defs: GoalTypeDef[] = [
      {
        ...baseLeaf,
        name: 'touchy',
        humanTouchpoints: [{ name: 'ask', onTimeout: 'wait' as 'deny' }],
      },
    ];
    const violations = lintLibrary(defs, { checkSkills: false });
    expect(violations.some((v) => v.includes('human touchpoint'))).toBe(true);
  });
});
