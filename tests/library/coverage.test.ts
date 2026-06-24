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

// ── ADR-029 Decision 2: relevance-bounded comprehension ───────────────────────

describe('greenfield root split — no whole-repo comprehension pulled', () => {
  it('root split over an entirely NEW scope does not demand architecture or stack', () => {
    const result = coverageCheck(
      makeGoal({
        isRootSplit: true,
        scope: ['src/util/'],
        existsByRegion: { 'src/util': false },
      }),
      makeKnowledge(), // no artifacts at all
    );
    expect(result.ok).toBe(true);
    expect(result.missing).toHaveLength(0);
  });

  it('root split with a MIX of new and existing scope still demands whole-repo maps', () => {
    const result = coverageCheck(
      makeGoal({
        isRootSplit: true,
        scope: ['src/util/', 'src/engine/'],
        existsByRegion: { 'src/util': false, 'src/engine': true },
      }),
      makeKnowledge(),
    );
    expect(result.ok).toBe(false);
    const cats = result.missing.map((m) => m.category);
    expect(cats).toContain('architecture');
    expect(cats).toContain('stack');
  });

  it('scope-less root split (whole-repo intent) still demands whole-repo maps', () => {
    const result = coverageCheck(
      makeGoal({ isRootSplit: true, scope: [] }),
      makeKnowledge(),
    );
    expect(result.ok).toBe(false);
    const cats = result.missing.map((m) => m.category);
    expect(cats).toContain('architecture');
    expect(cats).toContain('stack');
  });

  it('existing-scope root split (existsByRegion all true) still demands whole-repo maps', () => {
    const result = coverageCheck(
      makeGoal({
        isRootSplit: true,
        scope: ['src/engine/'],
        existsByRegion: { 'src/engine': true },
      }),
      makeKnowledge(),
    );
    expect(result.ok).toBe(false);
    const cats = result.missing.map((m) => m.category);
    expect(cats).toContain('architecture');
    expect(cats).toContain('stack');
  });
});

describe('region dives bounded to existing regions', () => {
  it('a NEW region in a code-leaf scope is not demanded as a deep-dive', () => {
    const result = coverageCheck(
      makeGoal({
        typeName: 'implement',
        scope: ['src/util/'],
        existsByRegion: { 'src/util': false },
      }),
      makeKnowledge({
        artifacts: [
          { category: 'architecture', generatedAtSha: HEAD, repoRoot: '/repo' },
          { category: 'conventions', generatedAtSha: HEAD, repoRoot: '/repo' },
        ],
        regionFacts: [],
      }),
    );
    expect(result.ok).toBe(true);
    const regions = result.missing.filter((m) => m.region).map((m) => m.region);
    expect(regions).not.toContain('src/util');
  });

  it('an EXISTING uncovered region in a code-leaf scope is still demanded', () => {
    const result = coverageCheck(
      makeGoal({
        typeName: 'implement',
        scope: ['src/payments/'],
        existsByRegion: { 'src/payments': true },
      }),
      makeKnowledge({
        artifacts: [
          { category: 'architecture', generatedAtSha: HEAD, repoRoot: '/repo' },
          { category: 'conventions', generatedAtSha: HEAD, repoRoot: '/repo' },
        ],
        regionFacts: [],
      }),
    );
    expect(result.ok).toBe(false);
    const regions = result.missing.filter((m) => m.region).map((m) => m.region);
    expect(regions).toContain('src/payments');
  });

  it('mixed new + existing scope dives only the existing region', () => {
    const result = coverageCheck(
      makeGoal({
        typeName: 'implement',
        scope: ['src/util/', 'src/payments/'],
        existsByRegion: { 'src/util': false, 'src/payments': true },
      }),
      makeKnowledge({
        artifacts: [
          { category: 'architecture', generatedAtSha: HEAD, repoRoot: '/repo' },
          { category: 'conventions', generatedAtSha: HEAD, repoRoot: '/repo' },
        ],
        regionFacts: [],
      }),
    );
    expect(result.ok).toBe(false);
    const regions = result.missing.filter((m) => m.region).map((m) => m.region);
    expect(regions).toContain('src/payments');
    expect(regions).not.toContain('src/util');
  });
});

// ── ADR-029 Decision 2, amended for brownfield (AC-4 cats run #3) ──────────────

describe('scoped code leaf pulls region dives only — no whole-repo map', () => {
  it('a scoped brownfield leaf with its region dived PASSES without any architecture/conventions artifact', () => {
    // The cats case: implement format_usd into an EXISTING dir. The region dive of
    // that dir is its comprehension; the whole-repo architecture/conventions maps
    // (which time out on a big repo) must NOT be demanded.
    const result = coverageCheck(
      makeGoal({
        typeName: 'implement',
        scope: ['src/cats/agents/common/'],
        existsByRegion: { 'src/cats/agents/common': true },
      }),
      makeKnowledge({
        artifacts: [], // NO whole-repo maps at all
        regionFacts: [
          { repoRoot: '/repo', region: 'src/cats/agents/common', generatedAtSha: HEAD },
        ],
      }),
    );
    expect(result.ok).toBe(true);
    expect(result.missing).toHaveLength(0);
  });

  it('a scoped leaf still demands the region dive (only the whole-repo map is dropped)', () => {
    const result = coverageCheck(
      makeGoal({
        typeName: 'implement',
        scope: ['src/cats/agents/common/'],
        existsByRegion: { 'src/cats/agents/common': true },
      }),
      makeKnowledge({ artifacts: [], regionFacts: [] }),
    );
    expect(result.ok).toBe(false);
    // The miss is the REGION dive, not a whole-repo architecture/conventions map.
    const regions = result.missing.filter((m) => m.region).map((m) => m.region);
    expect(regions).toContain('src/cats/agents/common');
    // No bare (region-less) whole-repo category miss.
    const wholeRepoMiss = result.missing.filter((m) => m.region === undefined);
    expect(wholeRepoMiss).toHaveLength(0);
  });

  it('an UNSCOPED code leaf still demands the whole-repo architecture + conventions maps', () => {
    // No scope to bound comprehension to → the whole-repo maps are the floor.
    const result = coverageCheck(
      makeGoal({ typeName: 'implement', scope: [] }),
      makeKnowledge({ artifacts: [], regionFacts: [] }),
    );
    expect(result.ok).toBe(false);
    const cats = result.missing.map((m) => m.category);
    expect(cats).toContain('architecture');
    expect(cats).toContain('conventions');
  });

  it('characterize work keeps the whole-repo maps even when scoped', () => {
    // Characterize genuinely reads the wider codebase to write tests — the narrow
    // carve-out is for plain code-emitting leaves only.
    const result = coverageCheck(
      makeGoal({
        typeName: 'characterize',
        scope: ['src/payments/'],
        existsByRegion: { 'src/payments': true },
      }),
      makeKnowledge({
        artifacts: [],
        regionFacts: [
          { repoRoot: '/repo', region: 'src/payments', generatedAtSha: HEAD },
        ],
      }),
    );
    expect(result.ok).toBe(false);
    const cats = result.missing.map((m) => m.category);
    expect(cats).toContain('architecture');
    expect(cats).toContain('conventions');
    expect(cats).toContain('test-scaffold');
  });
});

describe('existsByRegion backward compatibility (absent = treat as existing)', () => {
  it('omitting existsByRegion preserves the legacy region-dive demand', () => {
    const without = coverageCheck(
      makeGoal({ typeName: 'implement', scope: ['src/payments'] }),
      makeKnowledge({
        artifacts: [
          { category: 'architecture', generatedAtSha: HEAD, repoRoot: '/repo' },
          { category: 'conventions', generatedAtSha: HEAD, repoRoot: '/repo' },
        ],
        regionFacts: [],
      }),
    );
    expect(without.ok).toBe(false);
    expect(without.missing.some((m) => m.region === 'src/payments')).toBe(true);
  });

  it('omitting existsByRegion preserves the legacy root-split demand', () => {
    const without = coverageCheck(
      makeGoal({ isRootSplit: true, scope: ['src/auth'] }),
      makeKnowledge(),
    );
    expect(without.ok).toBe(false);
    const cats = without.missing.map((m) => m.category);
    expect(cats).toContain('architecture');
    expect(cats).toContain('stack');
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
