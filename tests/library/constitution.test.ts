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
});
