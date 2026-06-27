import { describe, expect, it } from 'vitest';
import { assessMilestoneRound } from '../../src/engine/milestone/round-assessment.js';
import {
  buildRegistry,
  failVerdict,
  filesArtifact,
  leafTypeDef,
  makeGoal,
  MemoryEventStore,
  passVerdict,
  ScriptedBrain,
  textArtifact,
} from './stubs.js';

function registry() {
  return buildRegistry([
    leafTypeDef({
      name: 'deliver-intent',
      leafOnly: false,
      judgeType: 'judge-integration',
      iterative: { maxRounds: 3, acceptanceJudge: 'judge-acceptance' },
    }),
    leafTypeDef({ name: 'judge-acceptance', kind: 'judge', judgeType: null }),
  ]);
}

function criteriaArtifact(anchor = 'DONE') {
  return textArtifact(JSON.stringify({
    criteria: [{
      id: 'c1',
      claim: 'the build is done',
      check: { file: 'src/x.ts', anchor },
    }],
  }));
}

describe('milestone round assessment', () => {
  it('runs criteria checks and acceptance judge', async () => {
    const store = new MemoryEventStore();

    const assessment = await assessMilestoneRound({
      goal: makeGoal({ type: 'deliver-intent', scope: ['src/'] }),
      criteriaArtifact: criteriaArtifact('DONE'),
      mergedArtifact: filesArtifact([{ path: 'src/x.ts', content: '// DONE\n' }]),
      registry: registry(),
      brain: new ScriptedBrain().queueJudge(passVerdict()),
      store,
      now: () => 1,
      checkContext: undefined,
      goldenCapture: false,
      debitUsage: () => {},
    });

    expect(assessment).toMatchObject({
      passingCount: 1,
      criteriaTotal: 1,
      judgeVerdict: { pass: true },
      diffDigest: [],
    });
    expect(assessment.checkResults).toEqual([{
      id: 'c1',
      ok: true,
      detail: 'File "src/x.ts" contains "DONE".',
    }]);
    expect(store.types()).toEqual([]);
  });

  it('records unmet criteria in the diff digest', async () => {
    const assessment = await assessMilestoneRound({
      goal: makeGoal({ type: 'deliver-intent', scope: ['src/'] }),
      criteriaArtifact: criteriaArtifact('DONE'),
      mergedArtifact: filesArtifact([{ path: 'src/x.ts', content: '// not done\n' }]),
      registry: registry(),
      brain: new ScriptedBrain().queueJudge(passVerdict()),
      store: new MemoryEventStore(),
      now: () => 2,
      checkContext: undefined,
      goldenCapture: false,
      debitUsage: () => {},
    });

    expect(assessment.passingCount).toBe(0);
    expect(assessment.diffDigest).toEqual(['unmet:c1']);
  });

  it('appends judge-verdict and golden-candidate events when capture is enabled', async () => {
    const store = new MemoryEventStore();
    let usageDebited = false;

    await assessMilestoneRound({
      goal: makeGoal({ type: 'deliver-intent', scope: ['src/'] }),
      criteriaArtifact: criteriaArtifact('DONE'),
      mergedArtifact: filesArtifact([{ path: 'src/x.ts', content: '// DONE\n' }]),
      registry: registry(),
      brain: new ScriptedBrain().queueJudge(failVerdict('not shippable')),
      store,
      now: () => 3,
      checkContext: undefined,
      goldenCapture: true,
      brainConfig: { modelByTier: { low: 'low-model' } },
      debitUsage: () => {
        usageDebited = true;
      },
    });

    expect(usageDebited).toBe(true);
    expect(store.types()).toEqual(['judge-verdict', 'golden-candidate']);
  });

  it('returns a failing empty judge verdict when no merged artifact exists', async () => {
    const assessment = await assessMilestoneRound({
      goal: makeGoal({ type: 'deliver-intent' }),
      criteriaArtifact: criteriaArtifact('DONE'),
      mergedArtifact: null,
      registry: registry(),
      brain: new ScriptedBrain(),
      store: new MemoryEventStore(),
      now: () => 4,
      checkContext: undefined,
      goldenCapture: false,
      debitUsage: () => {},
    });

    expect(assessment.judgeVerdict).toEqual({ pass: false, findings: [] });
  });
});
