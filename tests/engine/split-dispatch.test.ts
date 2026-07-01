import { describe, expect, it } from 'vitest';
import type { ChildPlan, Decision } from '../../src/contract/decision.js';
import type { Report } from '../../src/contract/report.js';
import { runSplitDispatch } from '../../src/engine/split-dispatch.js';
import { InMemoryPatternStore } from '../../src/substrate/memory-pattern-store.js';
import {
  leafTypeDef,
  makeGoal,
  MemoryEventStore,
  nonLeafTypeDef,
  textArtifact,
} from './stubs.js';

describe('runSplitDispatch', () => {
  it('runs a non-iterative split and records the pattern outcome', async () => {
    const store = new MemoryEventStore();
    const patterns = new InMemoryPatternStore();
    const decision = splitDecision();
    const splitReport = report();

    const result = await runSplitDispatch({
      goal: makeGoal({ id: 'root', type: 'splitter' }),
      typeDef: nonLeafTypeDef({ name: 'splitter' }),
      decision,
      terracedLoserFindings: ['alternative considered'],
      goalShape: 'splitter|{}|test goal',
      patterns,
      store,
      now: () => 1,
      runMilestone: async () => {
        throw new Error('runMilestone should not be called');
      },
      runSplit: async (children, findings) => {
        expect(children).toEqual(decision.children);
        expect(findings).toEqual(['alternative considered']);
        return splitReport;
      },
    });

    expect(result).toBe(splitReport);
    expect(await patterns.list()).toEqual([
      expect.objectContaining({ shape: 'splitter|{}|test goal', successes: 1 }),
    ]);
    expect(await store.list({ type: 'pattern-recorded' })).toEqual([
      expect.objectContaining({ shape: 'splitter|{}|test goal', outcome: 'success' }),
    ]);
  });

  it('blocks an iterative split when the effective round count is invalid', async () => {
    const store = new MemoryEventStore();

    const result = await runSplitDispatch({
      goal: makeGoal({ id: 'root', type: 'deliver', maxRounds: 0 }),
      typeDef: nonLeafTypeDef({
        name: 'deliver',
        iterative: { maxRounds: 3, acceptance: { criteria: ['done'] } },
      }),
      decision: splitDecision(),
      terracedLoserFindings: [],
      goalShape: 'deliver|{}|test goal',
      patterns: undefined,
      store,
      now: () => 1,
      runMilestone: async () => {
        throw new Error('runMilestone should not be called');
      },
      runSplit: async () => {
        throw new Error('runSplit should not be called');
      },
    });

    expect(result.blockers[0]).toContain('iterative maxRounds must be an integer >= 1');
    expect(await store.list({ type: 'emitted' })).toEqual([
      expect.objectContaining({ report: result }),
    ]);
  });
});

function splitDecision(): Extract<Decision, { kind: 'split' }> {
  return { kind: 'split', children: oneChildSplit() };
}

function oneChildSplit(): ChildPlan[] {
  return [
    {
      localId: 'leaf',
      type: 'leaf',
      title: 'leaf',
      spec: {},
      dependsOn: [],
      scope: [],
      budgetShare: 1,
    },
  ];
}

function report(): Report {
  return {
    artifact: textArtifact('done'),
    proof: [],
    lessons: [],
    memoriesUsed: [],
    blockers: [],
    findings: [],
    learned: '',
  };
}
