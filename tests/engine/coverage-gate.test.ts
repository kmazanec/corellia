import { describe, expect, it } from 'vitest';
import type { ChildPlan } from '../../src/contract/decision.js';
import {
  encodeMissing,
  filterMissingCoveredByRefresh,
  gateMissingLabels,
  injectCoverageChildren,
} from '../../src/engine/coverage-gate.js';

const child = (overrides: Partial<ChildPlan> & Pick<ChildPlan, 'localId'>): ChildPlan => ({
  localId: overrides.localId,
  type: overrides.type ?? 'impl',
  title: overrides.title ?? overrides.localId,
  spec: overrides.spec ?? {},
  dependsOn: overrides.dependsOn ?? [],
  scope: overrides.scope ?? [],
  budgetShare: overrides.budgetShare ?? 0.2,
});

describe('coverage gate helpers', () => {
  it('encodes category and region misses for gate events', () => {
    expect(encodeMissing({ category: 'architecture', reason: 'missing' })).toBe('architecture');
    expect(encodeMissing({ category: 'architecture', region: 'src/engine', reason: 'missing' }))
      .toBe('architecture:src/engine');
  });

  it('filters misses already covered by refresh children', () => {
    const filtered = filterMissingCoveredByRefresh(
      [
        { category: 'architecture', reason: 'stale' },
        { category: 'stack', reason: 'missing' },
      ],
      new Set(['architecture']),
    );

    expect(filtered).toEqual([{ category: 'stack', reason: 'missing' }]);
  });

  it('labels both policy misses and refresh children for gate events', () => {
    expect(gateMissingLabels(
      [{ category: 'conventions', region: 'src', reason: 'missing' }],
      [child({ localId: 'refresh-arch', type: 'map-repo' })],
    )).toEqual(['conventions:src', 'refresh:map-repo:refresh-arch']);
  });

  it('injects only scope-relevant region dependencies', () => {
    const augmented = injectCoverageChildren({
      children: [
        child({ localId: 'build-src', scope: ['src/engine'] }),
        child({ localId: 'build-docs', scope: ['docs'] }),
      ],
      missing: [{ category: 'conventions', region: 'src', reason: 'missing' }],
      refreshChildren: [],
      mintComprehension: () => [child({ localId: 'dive-src', type: 'deep-dive-region', scope: ['src'] })],
    });

    expect(augmented.find((plan) => plan.localId === 'build-src')?.dependsOn).toEqual(['dive-src']);
    expect(augmented.find((plan) => plan.localId === 'build-docs')?.dependsOn).toEqual([]);
  });

  it('makes scope-less injected children dependencies of every existing child', () => {
    const augmented = injectCoverageChildren({
      children: [
        child({ localId: 'build-src', scope: ['src'] }),
        child({ localId: 'build-docs', scope: ['docs'] }),
      ],
      missing: [],
      refreshChildren: [child({ localId: 'refresh-arch', type: 'map-repo', scope: [], dependsOn: ['stale'] })],
      mintComprehension: () => [],
    });

    expect(augmented.find((plan) => plan.localId === 'refresh-arch')?.dependsOn).toEqual([]);
    expect(augmented.find((plan) => plan.localId === 'build-src')?.dependsOn).toEqual(['refresh-arch']);
    expect(augmented.find((plan) => plan.localId === 'build-docs')?.dependsOn).toEqual(['refresh-arch']);
  });

  it('renormalizes augmented budget shares before validation', () => {
    const augmented = injectCoverageChildren({
      children: [
        child({ localId: 'a', budgetShare: 0.7 }),
        child({ localId: 'b', budgetShare: 0.7 }),
      ],
      missing: [{ category: 'architecture', reason: 'missing' }],
      refreshChildren: [],
      mintComprehension: () => [child({ localId: 'map', type: 'map-repo', budgetShare: 0.7 })],
    });

    const total = augmented.reduce((sum, plan) => sum + plan.budgetShare, 0);
    expect(total).toBeCloseTo(1);
  });
});
