/**
 * Tests for the coverage policy table and coverageCheck pure function.
 * Validates every table row, exemptions, and scope-aware region coverage.
 */

import { describe, it, expect } from 'vitest';
import {
  coverageCheck,
  COVERAGE_POLICY_TABLE,
  type CoverageGoal,
  type KnowledgeForCoverage,
} from '../../src/library/coverage.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

const HEAD = 'abc123';
const STALE = 'old000';

function makeGoal(overrides: Partial<CoverageGoal> = {}): CoverageGoal {
  return {
    kind: 'make',
    isRootSplit: false,
    scope: [],
    typeName: 'implement',
    ...overrides,
  };
}

function makeKnowledge(overrides: Partial<KnowledgeForCoverage> = {}): KnowledgeForCoverage {
  return {
    artifacts: [],
    regionFacts: [],
    headSha: HEAD,
    ...overrides,
  };
}

// ── Policy table constant sanity ─────────────────────────────────────────────

describe('COVERAGE_POLICY_TABLE', () => {
  it('root split requires architecture and stack', () => {
    expect(COVERAGE_POLICY_TABLE.ROOT_SPLIT_CATEGORIES).toContain('architecture');
    expect(COVERAGE_POLICY_TABLE.ROOT_SPLIT_CATEGORIES).toContain('stack');
  });

  it('code leaf requires architecture and conventions', () => {
    expect(COVERAGE_POLICY_TABLE.CODE_LEAF_CATEGORIES).toContain('architecture');
    expect(COVERAGE_POLICY_TABLE.CODE_LEAF_CATEGORIES).toContain('conventions');
  });

  it('characterize requires architecture, conventions, and test-scaffold', () => {
    expect(COVERAGE_POLICY_TABLE.CHARACTERIZE_CATEGORIES).toContain('architecture');
    expect(COVERAGE_POLICY_TABLE.CHARACTERIZE_CATEGORIES).toContain('conventions');
    expect(COVERAGE_POLICY_TABLE.CHARACTERIZE_CATEGORIES).toContain('test-scaffold');
  });
});

// ── learn exemption ───────────────────────────────────────────────────────────

describe('learn-kind exemption', () => {
  it('passes with no artifacts for learn goals', () => {
    const result = coverageCheck(
      makeGoal({ kind: 'learn' }),
      makeKnowledge(),
    );
    expect(result.ok).toBe(true);
    expect(result.missing).toHaveLength(0);
  });

  it('passes even with stale artifacts for learn goals', () => {
    const result = coverageCheck(
      makeGoal({ kind: 'learn', isRootSplit: true }),
      makeKnowledge({
        artifacts: [{ category: 'architecture', generatedAtSha: STALE, repoRoot: '/repo' }],
      }),
    );
    expect(result.ok).toBe(true);
    expect(result.missing).toHaveLength(0);
  });
});

// ── judge / evolve exemption ──────────────────────────────────────────────────

describe('judge and evolve exemption', () => {
  it('judge goals pass with no artifacts', () => {
    const result = coverageCheck(makeGoal({ kind: 'judge' }), makeKnowledge());
    expect(result.ok).toBe(true);
  });

  it('evolve goals pass with no artifacts', () => {
    const result = coverageCheck(makeGoal({ kind: 'evolve' }), makeKnowledge());
    expect(result.ok).toBe(true);
  });
});

// ── root split row ────────────────────────────────────────────────────────────

describe('root split — architecture + stack required', () => {
  it('fails when no artifacts exist', () => {
    const result = coverageCheck(
      makeGoal({ isRootSplit: true }),
      makeKnowledge(),
    );
    expect(result.ok).toBe(false);
    const cats = result.missing.map((m) => m.category);
    expect(cats).toContain('architecture');
    expect(cats).toContain('stack');
  });

  it('fails when only architecture is fresh', () => {
    const result = coverageCheck(
      makeGoal({ isRootSplit: true }),
      makeKnowledge({
        artifacts: [{ category: 'architecture', generatedAtSha: HEAD, repoRoot: '/repo' }],
      }),
    );
    expect(result.ok).toBe(false);
    const cats = result.missing.map((m) => m.category);
    expect(cats).not.toContain('architecture');
    expect(cats).toContain('stack');
  });

  it('passes when both architecture and stack are fresh', () => {
    const result = coverageCheck(
      makeGoal({ isRootSplit: true }),
      makeKnowledge({
        artifacts: [
          { category: 'architecture', generatedAtSha: HEAD, repoRoot: '/repo' },
          { category: 'stack', generatedAtSha: HEAD, repoRoot: '/repo' },
        ],
      }),
    );
    expect(result.ok).toBe(true);
    expect(result.missing).toHaveLength(0);
  });

  it('fails when architecture artifact is stale', () => {
    const result = coverageCheck(
      makeGoal({ isRootSplit: true }),
      makeKnowledge({
        artifacts: [
          { category: 'architecture', generatedAtSha: STALE, repoRoot: '/repo' },
          { category: 'stack', generatedAtSha: HEAD, repoRoot: '/repo' },
        ],
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.missing[0]?.category).toBe('architecture');
  });

  it('root split does not check region dives even with scope', () => {
    // root splits require architecture + stack; no region dive row applies
    const result = coverageCheck(
      makeGoal({ isRootSplit: true, scope: ['src/auth'] }),
      makeKnowledge({
        artifacts: [
          { category: 'architecture', generatedAtSha: HEAD, repoRoot: '/repo' },
          { category: 'stack', generatedAtSha: HEAD, repoRoot: '/repo' },
        ],
      }),
    );
    expect(result.ok).toBe(true);
  });
});

// ── code-emitting leaf row ────────────────────────────────────────────────────

describe('code-emitting leaf (make kind)', () => {
  it('fails when no artifacts exist', () => {
    const result = coverageCheck(
      makeGoal({ typeName: 'implement' }),
      makeKnowledge(),
    );
    expect(result.ok).toBe(false);
    const cats = result.missing.map((m) => m.category);
    expect(cats).toContain('architecture');
    expect(cats).toContain('conventions');
  });

  it('passes when architecture and conventions are fresh and scope is empty', () => {
    const result = coverageCheck(
      makeGoal({ typeName: 'implement', scope: [] }),
      makeKnowledge({
        artifacts: [
          { category: 'architecture', generatedAtSha: HEAD, repoRoot: '/repo' },
          { category: 'conventions', generatedAtSha: HEAD, repoRoot: '/repo' },
        ],
      }),
    );
    expect(result.ok).toBe(true);
  });

  it('fails when scope region has no deep-dive-region fact', () => {
    const result = coverageCheck(
      makeGoal({ typeName: 'implement', scope: ['src/payments'] }),
      makeKnowledge({
        artifacts: [
          { category: 'architecture', generatedAtSha: HEAD, repoRoot: '/repo' },
          { category: 'conventions', generatedAtSha: HEAD, repoRoot: '/repo' },
        ],
        regionFacts: [],
      }),
    );
    expect(result.ok).toBe(false);
    const regions = result.missing.filter((m) => m.region !== undefined).map((m) => m.region);
    expect(regions).toContain('src/payments');
  });

  it('passes when scope region has a fresh deep-dive-region fact', () => {
    const result = coverageCheck(
      makeGoal({ typeName: 'implement', scope: ['src/payments'] }),
      makeKnowledge({
        artifacts: [
          { category: 'architecture', generatedAtSha: HEAD, repoRoot: '/repo' },
          { category: 'conventions', generatedAtSha: HEAD, repoRoot: '/repo' },
        ],
        regionFacts: [
          { repoRoot: '/repo', region: 'src/payments', generatedAtSha: HEAD },
        ],
      }),
    );
    expect(result.ok).toBe(true);
  });

  it('fails when scope region dive is stale', () => {
    const result = coverageCheck(
      makeGoal({ typeName: 'implement', scope: ['src/payments'] }),
      makeKnowledge({
        artifacts: [
          { category: 'architecture', generatedAtSha: HEAD, repoRoot: '/repo' },
          { category: 'conventions', generatedAtSha: HEAD, repoRoot: '/repo' },
        ],
        regionFacts: [
          { repoRoot: '/repo', region: 'src/payments', generatedAtSha: STALE },
        ],
      }),
    );
    expect(result.ok).toBe(false);
    const regionMiss = result.missing.find((m) => m.region === 'src/payments');
    expect(regionMiss).toBeDefined();
  });

  it('handles multiple scope regions independently', () => {
    const result = coverageCheck(
      makeGoal({ typeName: 'implement', scope: ['src/auth', 'src/payments'] }),
      makeKnowledge({
        artifacts: [
          { category: 'architecture', generatedAtSha: HEAD, repoRoot: '/repo' },
          { category: 'conventions', generatedAtSha: HEAD, repoRoot: '/repo' },
        ],
        regionFacts: [
          { repoRoot: '/repo', region: 'src/auth', generatedAtSha: HEAD },
          // src/payments missing
        ],
      }),
    );
    expect(result.ok).toBe(false);
    const regions = result.missing.filter((m) => m.region).map((m) => m.region);
    expect(regions).not.toContain('src/auth');
    expect(regions).toContain('src/payments');
  });
});

// ── characterize/test work row ────────────────────────────────────────────────

describe('characterize/test work', () => {
  it('requires architecture, conventions, and test-scaffold', () => {
    const result = coverageCheck(
      makeGoal({ typeName: 'characterize' }),
      makeKnowledge(),
    );
    expect(result.ok).toBe(false);
    const cats = result.missing.map((m) => m.category);
    expect(cats).toContain('architecture');
    expect(cats).toContain('conventions');
    expect(cats).toContain('test-scaffold');
  });

  it('passes when all three categories are fresh and no scope', () => {
    const result = coverageCheck(
      makeGoal({ typeName: 'characterize', scope: [] }),
      makeKnowledge({
        artifacts: [
          { category: 'architecture', generatedAtSha: HEAD, repoRoot: '/repo' },
          { category: 'conventions', generatedAtSha: HEAD, repoRoot: '/repo' },
          { category: 'test-scaffold', generatedAtSha: HEAD, repoRoot: '/repo' },
        ],
      }),
    );
    expect(result.ok).toBe(true);
  });

  it('still fails on missing region dive for characterize goals', () => {
    const result = coverageCheck(
      makeGoal({ typeName: 'characterize', scope: ['src/billing'] }),
      makeKnowledge({
        artifacts: [
          { category: 'architecture', generatedAtSha: HEAD, repoRoot: '/repo' },
          { category: 'conventions', generatedAtSha: HEAD, repoRoot: '/repo' },
          { category: 'test-scaffold', generatedAtSha: HEAD, repoRoot: '/repo' },
        ],
        regionFacts: [],
      }),
    );
    expect(result.ok).toBe(false);
    const regions = result.missing.filter((m) => m.region).map((m) => m.region);
    expect(regions).toContain('src/billing');
  });
});

// ── stale artifact detection ──────────────────────────────────────────────────

describe('stale artifact detection', () => {
  it('reports stale reason when SHA differs from HEAD', () => {
    const result = coverageCheck(
      makeGoal({ isRootSplit: true }),
      makeKnowledge({
        artifacts: [
          { category: 'architecture', generatedAtSha: STALE, repoRoot: '/repo' },
          { category: 'stack', generatedAtSha: HEAD, repoRoot: '/repo' },
        ],
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.missing[0]?.reason).toMatch(/stale/i);
  });

  it('last artifact for a category wins (dedup)', () => {
    // Two architecture artifacts: first stale, second fresh — fresh wins
    const result = coverageCheck(
      makeGoal({ isRootSplit: true }),
      makeKnowledge({
        artifacts: [
          { category: 'architecture', generatedAtSha: STALE, repoRoot: '/repo' },
          { category: 'architecture', generatedAtSha: HEAD, repoRoot: '/repo' },
          { category: 'stack', generatedAtSha: HEAD, repoRoot: '/repo' },
        ],
      }),
    );
    expect(result.ok).toBe(true);
  });
});

// ── validatedCategories — stale-but-validated artifacts treated as fresh ──────

describe('validatedCategories parameter', () => {
  it('stale artifact in validatedCategories is treated as fresh (no miss)', () => {
    const validated = new Set<import('../../src/contract/knowledge.js').KnowledgeCategory>(
      ['architecture' as const],
    );
    const result = coverageCheck(
      makeGoal({ isRootSplit: true }),
      makeKnowledge({
        artifacts: [
          { category: 'architecture', generatedAtSha: STALE, repoRoot: '/repo' },
          { category: 'stack', generatedAtSha: HEAD, repoRoot: '/repo' },
        ],
      }),
      validated,
    );
    expect(result.ok).toBe(true);
    expect(result.missing).toHaveLength(0);
  });

  it('stale artifact NOT in validatedCategories is still reported as missing', () => {
    const validated = new Set<import('../../src/contract/knowledge.js').KnowledgeCategory>();
    const result = coverageCheck(
      makeGoal({ isRootSplit: true }),
      makeKnowledge({
        artifacts: [
          { category: 'architecture', generatedAtSha: STALE, repoRoot: '/repo' },
          { category: 'stack', generatedAtSha: HEAD, repoRoot: '/repo' },
        ],
      }),
      validated,
    );
    expect(result.ok).toBe(false);
    const cats = result.missing.map((m) => m.category);
    expect(cats).toContain('architecture');
  });

  it('default empty set behaves identically to the two-arg form', () => {
    const knowledge = makeKnowledge({
      artifacts: [
        { category: 'architecture', generatedAtSha: STALE, repoRoot: '/repo' },
        { category: 'stack', generatedAtSha: HEAD, repoRoot: '/repo' },
      ],
    });
    const twoArg = coverageCheck(makeGoal({ isRootSplit: true }), knowledge);
    const threeArg = coverageCheck(
      makeGoal({ isRootSplit: true }),
      knowledge,
      new Set(),
    );
    expect(twoArg.ok).toBe(threeArg.ok);
    expect(twoArg.missing.length).toBe(threeArg.missing.length);
  });
});
