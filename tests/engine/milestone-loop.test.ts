import { describe, expect, it } from 'vitest';
import type { ChildPlan } from '../../src/contract/decision.js';
import type { Artifact, Report } from '../../src/contract/report.js';
import { runMilestoneLoop } from '../../src/engine/milestone/loop.js';
import type { RoundAssessment } from '../../src/engine/milestone/round-assessment.js';
import { createTreeState } from '../../src/engine/tree-spend.js';
import {
  failVerdict,
  makeGoal,
  MemoryEventStore,
  passVerdict,
  textArtifact,
} from './stubs.js';

const criteriaChild: ChildPlan = {
  localId: 'criteria',
  type: 'author-acceptance-criteria',
  title: 'criteria',
  spec: {},
  dependsOn: [],
  scope: ['src/'],
  budgetShare: 0.5,
};

function report(artifact: Artifact | null): Report {
  return {
    artifact,
    proof: [],
    lessons: [],
    memoriesUsed: [],
    blockers: [],
    findings: [],
    learned: '',
  };
}

function assessment(overrides: Partial<RoundAssessment> = {}): RoundAssessment {
  return {
    passingCount: 1,
    criteriaTotal: 1,
    judgeVerdict: passVerdict(),
    criteria: [],
    checkResults: [{ id: 'c1', ok: true, detail: 'done' }],
    diffDigest: [],
    ...overrides,
  };
}

describe('milestone loop', () => {
  it('freezes criteria, assesses the round, and emits the done report', async () => {
    const store = new MemoryEventStore();
    const frozenCriteria = textArtifact('criteria');
    const persisted: Artifact[] = [];

    const finalReport = await runMilestoneLoop({
      goal: makeGoal(),
      initialChildren: [criteriaChild],
      effectiveMaxRounds: 3,
      treeState: createTreeState(),
      store,
      now: () => 1,
      runRound: async () => ({
        report: report(textArtifact('done')),
        mergedArtifact: textArtifact('done'),
        childOutcomes: [{ plan: criteriaChild, report: report(frozenCriteria) }],
      }),
      reDecideRound: async () => {
        throw new Error('not expected');
      },
      persistCriteria: async (artifact) => {
        persisted.push(artifact);
      },
      commitRound: () => 'round-0',
      assessRound: async () => assessment(),
      ceilingReachedOnce: async () => {
        throw new Error('not expected');
      },
      ceilingReport: async () => {
        throw new Error('not expected');
      },
    });

    expect(persisted).toEqual([frozenCriteria]);
    expect(finalReport.artifact).toEqual(textArtifact('done'));
    expect(store.types()).toEqual(['round-started', 'round-assessed', 'emitted']);
  });

  it('halts with halt-deadline when the tree deadline passes at a round boundary', async () => {
    // Regression (proof-word-count live run): after the tree deadline passed,
    // the loop started fresh rounds whose children all instantly blocked on
    // entry. The round boundary must consult the shared deadline and halt.
    const store = new MemoryEventStore();
    let clock = 2;
    const treeState = createTreeState(100, 5); // deadline at t=5

    const finalReport = await runMilestoneLoop({
      goal: makeGoal(),
      initialChildren: [criteriaChild],
      effectiveMaxRounds: 5,
      treeState,
      store,
      now: () => clock,
      runRound: async () => ({
        report: report(textArtifact('partial')),
        mergedArtifact: textArtifact('partial'),
        childOutcomes: [{ plan: criteriaChild, report: report(textArtifact('criteria')) }],
      }),
      reDecideRound: async () => {
        throw new Error('deadline should halt before re-decision');
      },
      persistCriteria: async () => {},
      commitRound: () => 'round-0',
      assessRound: async () => {
        clock = 10; // the round's work carried past the deadline
        return assessment({
          passingCount: 1,
          criteriaTotal: 2,
          judgeVerdict: failVerdict('not shippable'),
          checkResults: [
            { id: 'c1', ok: true, detail: 'done' },
            { id: 'c2', ok: false, detail: 'missing docs' },
          ],
          diffDigest: ['unmet:c2'],
        });
      },
      ceilingReachedOnce: async () => {
        throw new Error('deadline halt must not report a ceiling');
      },
      ceilingReport: async () => {
        throw new Error('deadline halt must not report a ceiling');
      },
    });

    const assessed = await store.list({ type: 'round-assessed' });
    expect(assessed).toHaveLength(2);
    expect(assessed.at(-1)).toMatchObject({ outcome: 'halt-deadline' });
    expect(finalReport.blockers).toEqual([
      'Acceptance criteria not yet met (1/2): c2 (missing docs)',
      'judge-acceptance did not pass: not shippable',
    ]);
  });

  it('halts with an honest partial when the ceiling trips after a round', async () => {
    const store = new MemoryEventStore();
    const treeState = createTreeState(1);
    let ceilingReached = false;

    const finalReport = await runMilestoneLoop({
      goal: makeGoal(),
      initialChildren: [criteriaChild],
      effectiveMaxRounds: 3,
      treeState,
      store,
      now: () => 2,
      runRound: async () => ({
        report: report(textArtifact('partial')),
        mergedArtifact: textArtifact('partial'),
        childOutcomes: [{ plan: criteriaChild, report: report(textArtifact('criteria')) }],
      }),
      reDecideRound: async () => {
        throw new Error('ceiling should halt before re-decision');
      },
      persistCriteria: async () => {},
      commitRound: () => 'round-0',
      assessRound: async () => {
        treeState.spentUsd = 1;
        return assessment({
          passingCount: 1,
          criteriaTotal: 2,
          judgeVerdict: failVerdict('not shippable'),
          checkResults: [
            { id: 'c1', ok: true, detail: 'done' },
            { id: 'c2', ok: false, detail: 'missing docs' },
          ],
          diffDigest: ['unmet:c2'],
        });
      },
      ceilingReachedOnce: async () => {
        ceilingReached = true;
      },
      ceilingReport: async () => {
        throw new Error('partial path should not use initial ceiling report');
      },
    });

    const assessed = await store.list({ type: 'round-assessed' });
    expect(ceilingReached).toBe(true);
    expect(assessed).toHaveLength(2);
    expect(assessed.at(-1)).toMatchObject({ outcome: 'halt-ceiling' });
    expect(finalReport.blockers).toEqual([
      'Acceptance criteria not yet met (1/2): c2 (missing docs)',
      'judge-acceptance did not pass: not shippable',
    ]);
  });
});
