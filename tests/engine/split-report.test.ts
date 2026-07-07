import { describe, expect, it } from 'vitest';
import type { ChildPlan } from '../../src/contract/decision.js';
import type { Report } from '../../src/contract/report.js';
import {
  buildSplitRoundReport,
  childOutcomes,
  promoteChildReports,
} from '../../src/engine/split-report.js';
import { MemoryEventStore, makeGoal, textArtifact } from './stubs.js';

const report = (overrides: Partial<Report> = {}): Report => ({
  artifact: textArtifact('child'),
  proof: [],
  lessons: [],
  memoriesUsed: [],
  blockers: [],
  findings: [],
  learned: '',
  ...overrides,
});

const child = (localId: string): ChildPlan => ({
  localId,
  type: 'leaf',
  title: localId,
  spec: {},
  dependsOn: [],
  scope: [],
  budgetShare: 0.5,
});

describe('split report promotion', () => {
  it('promotes lessons and reinforces used memories', async () => {
    const store = new MemoryEventStore();
    const promotion = await promoteChildReports({
      childGoals: [makeGoal({ id: 'root/a' }), makeGoal({ id: 'root/b' })],
      childReports: [
        report({ lessons: ['reuse this', 'reuse this'], memoriesUsed: ['m1'], learned: 'learned A' }),
        report({ blockers: ['blocked'], memoriesUsed: ['m2'], learned: 'learned A' }),
      ],
      store,
      now: () => 1,
    });

    expect(promotion).toEqual({ lessons: ['reuse this'], learned: 'learned A' });
    expect(await store.list({ type: 'memory-written' })).toHaveLength(2);
    expect(await store.list({ type: 'memory-reinforced' })).toMatchObject([
      { goalId: 'root/a', memoryId: 'm1', outcome: 'success' },
      { goalId: 'root/b', memoryId: 'm2', outcome: 'failure' },
    ]);
  });
});

describe('split report assembly', () => {
  it('preserves blocker and finding ordering from integration, comprehend, then children', () => {
    const built = buildSplitRoundReport({
      mergedArtifact: textArtifact('merged'),
      childGoals: [makeGoal({ id: 'root/a', title: 'module A' })],
      childReports: [
        report({ blockers: ['child blocker'], findings: ['child finding'], memoriesUsed: ['m1'] }),
      ],
      promotion: { lessons: ['lesson'], learned: 'learned' },
      extraFindings: ['terraced loser'],
      integrationFindings: ['integration finding'],
      integrationBlockers: ['integration blocker'],
      comprehendFindings: ['comprehend finding'],
      comprehendBlockers: ['comprehend blocker'],
    });

    expect(built).toMatchObject({
      artifact: textArtifact('merged'),
      lessons: ['lesson'],
      memoriesUsed: ['m1'],
      blockers: ['integration blocker', 'comprehend blocker', 'child blocker'],
      findings: ['terraced loser', 'integration finding', 'comprehend finding', 'child finding'],
      learned: 'learned',
    });
  });

  it('enumerates blocked child modules in partialDelivery, keyed to their goals', () => {
    const built = buildSplitRoundReport({
      mergedArtifact: textArtifact('merged'),
      childGoals: [
        makeGoal({ id: 'root/green', title: 'green module' }),
        makeGoal({ id: 'root/blocked', title: 'blocked module' }),
      ],
      childReports: [
        report({ blockers: [] }),
        report({ blockers: ['step-loop:failed'], artifact: null }),
      ],
      promotion: { lessons: [], learned: '' },
      extraFindings: [],
      integrationFindings: [],
      integrationBlockers: [],
      comprehendFindings: [],
      comprehendBlockers: [],
    });

    expect(built.partialDelivery).toEqual({
      blockedModules: [
        { goalId: 'root/blocked', title: 'blocked module', blocker: 'step-loop:failed' },
      ],
      childBlockers: ['step-loop:failed'],
    });
  });

  it('omits partialDelivery when no child blocked', () => {
    const built = buildSplitRoundReport({
      mergedArtifact: textArtifact('merged'),
      childGoals: [makeGoal({ id: 'root/green', title: 'green module' })],
      childReports: [report({ blockers: [] })],
      promotion: { lessons: [], learned: '' },
      extraFindings: [],
      integrationFindings: [],
      integrationBlockers: [],
      comprehendFindings: [],
      comprehendBlockers: [],
    });

    expect(built.partialDelivery).toBeUndefined();
  });

  it('pairs child plans with their reports', () => {
    const reports = [report({ learned: 'a' }), report({ learned: 'b' })];

    expect(childOutcomes([child('a'), child('b')], reports)).toEqual([
      { plan: child('a'), report: reports[0] },
      { plan: child('b'), report: reports[1] },
    ]);
  });
});
