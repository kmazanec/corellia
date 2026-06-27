import { describe, expect, it } from 'vitest';
import type { SplitMemo } from '../../src/contract/pattern.js';
import {
  buildDecisionContext,
  memoStatus,
  shouldRunTerracedScan,
} from '../../src/engine/decision/context.js';
import { makeGoal, nonLeafTypeDef } from './stubs.js';

const splitMemo: SplitMemo = {
  shape: 'shape',
  status: 'provisional',
  decision: {
    kind: 'split',
    children: [],
  },
  uses: 1,
  successes: 1,
  failures: 0,
};

describe('decision context', () => {
  it('derives memo status from absent and present split memos', () => {
    expect(memoStatus(null)).toBe('none');
    expect(memoStatus(splitMemo)).toBe('provisional');
    expect(memoStatus({ ...splitMemo, status: 'trusted' })).toBe('trusted');
  });

  it('builds the brain context from goal, type policy, and hints', () => {
    expect(buildDecisionContext({
      goal: makeGoal({
        memories: [{
          id: 'm1',
          layer: 'project',
          content: 'topic',
          provenance: 'trusted',
        }],
      }),
      typeDef: nonLeafTypeDef({ mustDecompose: true }),
      tier: 'mid',
      memo: splitMemo,
      skill: 'skill block',
      repoShape: 'repo shape',
    })).toMatchObject({
      tier: 'mid',
      memories: [{ id: 'm1' }],
      skill: 'skill block',
      repoShape: 'repo shape',
      mustDecompose: true,
      patternHint: splitMemo,
    });
  });

  it('does not include a trusted memo as a brain hint', () => {
    const ctx = buildDecisionContext({
      goal: makeGoal(),
      typeDef: nonLeafTypeDef(),
      tier: 'low',
      memo: { ...splitMemo, status: 'trusted' },
      skill: undefined,
      repoShape: undefined,
    });

    expect('patternHint' in ctx).toBe(false);
  });

  it('runs terraced scan only for novel shapes with judge support', () => {
    expect(shouldRunTerracedScan({
      scan: { k: 2, lenses: ['a'] },
      memoStatus: 'none',
      hasJudgeSplit: true,
    })).toBe(true);
    expect(shouldRunTerracedScan({
      scan: { k: 1, lenses: ['a'] },
      memoStatus: 'none',
      hasJudgeSplit: true,
    })).toBe(false);
    expect(shouldRunTerracedScan({
      scan: { k: 2, lenses: ['a'] },
      memoStatus: 'provisional',
      hasJudgeSplit: true,
    })).toBe(false);
  });
});
