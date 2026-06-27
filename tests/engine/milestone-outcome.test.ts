import { describe, expect, it } from 'vitest';
import type { ChildPlan } from '../../src/contract/decision.js';
import {
  decideMilestoneOutcome,
  extractCriteriaArtifact,
  withUnmetAcceptanceBlockers,
} from '../../src/engine/milestone/outcome.js';
import { failVerdict, passVerdict, textArtifact } from './stubs.js';

const baseAssessment = {
  passingCount: 1,
  criteriaTotal: 2,
  judgeVerdict: passVerdict(),
};

describe('milestone outcome policy', () => {
  it('finishes only when every criterion passes and the judge accepts', () => {
    expect(decideMilestoneOutcome({
      assessment: { passingCount: 2, criteriaTotal: 2, judgeVerdict: passVerdict() },
      priorPassingCount: 1,
      flatRounds: 0,
      roundIndex: 0,
      effectiveMaxRounds: 3,
    })).toEqual({ outcome: 'done', flatRounds: 0 });

    expect(decideMilestoneOutcome({
      assessment: { passingCount: 2, criteriaTotal: 2, judgeVerdict: failVerdict('rough') },
      priorPassingCount: 1,
      flatRounds: 0,
      roundIndex: 0,
      effectiveMaxRounds: 3,
    })).toEqual({ outcome: 'continue', flatRounds: 0 });
  });

  it('allows one flat round before halting for no progress', () => {
    expect(decideMilestoneOutcome({
      assessment: baseAssessment,
      priorPassingCount: 1,
      flatRounds: 0,
      roundIndex: 1,
      effectiveMaxRounds: 4,
    })).toEqual({ outcome: 'continue', flatRounds: 1 });

    expect(decideMilestoneOutcome({
      assessment: baseAssessment,
      priorPassingCount: 1,
      flatRounds: 1,
      roundIndex: 2,
      effectiveMaxRounds: 4,
    })).toEqual({ outcome: 'halt-no-progress', flatRounds: 2 });
  });

  it('halts at the max round backstop after done and no-progress checks', () => {
    expect(decideMilestoneOutcome({
      assessment: baseAssessment,
      priorPassingCount: 0,
      flatRounds: 1,
      roundIndex: 2,
      effectiveMaxRounds: 3,
    })).toEqual({ outcome: 'halt-max-rounds', flatRounds: 0 });
  });

  it('finds the frozen acceptance-criteria artifact from round children', () => {
    const criteria = textArtifact('criteria');
    const children: { plan: ChildPlan; report: { artifact: typeof criteria; blockers: string[]; lessons: never[] } }[] = [
      {
        plan: {
          localId: 'implementation',
          type: 'build-code',
          title: 'build',
          spec: {},
          dependsOn: [],
          scope: ['src/'],
          budgetShare: 0.5,
        },
        report: { artifact: textArtifact('code'), blockers: [], lessons: [] },
      },
      {
        plan: {
          localId: 'criteria',
          type: 'author-acceptance-criteria',
          title: 'criteria',
          spec: {},
          dependsOn: [],
          scope: ['src/'],
          budgetShare: 0.5,
        },
        report: { artifact: criteria, blockers: [], lessons: [] },
      },
    ];

    expect(extractCriteriaArtifact(children)).toBe(criteria);
  });

  it('adds unmet criteria and judge blockers to partial milestone reports', () => {
    const report = withUnmetAcceptanceBlockers(
      { artifact: textArtifact('partial'), blockers: ['existing'], lessons: [] },
      {
        passingCount: 1,
        criteriaTotal: 2,
        judgeVerdict: failVerdict('needs polish'),
        checkResults: [
          { id: 'c1', ok: true, detail: 'done' },
          { id: 'c2', ok: false, detail: 'missing docs' },
        ],
      },
    );

    expect(report.blockers).toEqual([
      'existing',
      'Acceptance criteria not yet met (1/2): c2 (missing docs)',
      'judge-acceptance did not pass: needs polish',
    ]);
  });
});
