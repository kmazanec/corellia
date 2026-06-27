import { describe, expect, it } from 'vitest';
import { judgeLeafArtifact } from '../../src/engine/leaf-judge.js';
import {
  buildRegistry,
  failVerdict,
  leafTypeDef,
  makeGoal,
  passVerdict,
  ScriptedBrain,
  textArtifact,
  MemoryEventStore,
} from './stubs.js';

describe('leaf judge', () => {
  it('judges the artifact and appends a judge verdict event', async () => {
    const store = new MemoryEventStore();
    const typeDef = leafTypeDef({ name: 'impl', judgeType: 'judge-impl' });
    const brain = new ScriptedBrain().queueJudge(passVerdict());

    const result = await judgeLeafArtifact({
      goal: makeGoal({ type: 'impl' }),
      artifact: textArtifact('done'),
      typeDef,
      judgeType: 'judge-impl',
      tier: 'low',
      registry: buildRegistry([
        typeDef,
        leafTypeDef({ name: 'judge-impl', family: 'judge' }),
      ]),
      brain,
      store,
      now: () => 1,
      goldenCapture: false,
    });

    expect(result.verdict.pass).toBe(true);
    expect((await store.list()).map((event) => event.type)).toEqual(['judge-verdict']);
  });

  it('captures golden candidates when enabled', async () => {
    const store = new MemoryEventStore();
    const typeDef = leafTypeDef({ name: 'impl', judgeType: 'judge-impl' });
    const brain = new ScriptedBrain().queueJudge(passVerdict());

    await judgeLeafArtifact({
      goal: makeGoal({ type: 'impl' }),
      artifact: textArtifact('done'),
      typeDef,
      judgeType: 'judge-impl',
      tier: 'low',
      registry: buildRegistry([
        typeDef,
        leafTypeDef({ name: 'judge-impl', family: 'judge' }),
      ]),
      brain,
      store,
      now: () => 2,
      goldenCapture: true,
      brainConfig: { modelByTier: { low: 'test-model' } },
    });

    expect((await store.list()).map((event) => event.type)).toEqual([
      'judge-verdict',
      'golden-candidate',
    ]);
    const golden = (await store.list({ type: 'golden-candidate' }))[0];
    expect(golden).toMatchObject({ type: 'golden-candidate', model: 'test-model' });
  });

  it('returns failing verdicts to the attempt loop', async () => {
    const store = new MemoryEventStore();
    const typeDef = leafTypeDef({ name: 'impl', judgeType: 'judge-impl' });
    const brain = new ScriptedBrain().queueJudge(failVerdict('not enough'));

    const result = await judgeLeafArtifact({
      goal: makeGoal({ type: 'impl' }),
      artifact: textArtifact('partial'),
      typeDef,
      judgeType: 'judge-impl',
      tier: 'low',
      registry: buildRegistry([
        typeDef,
        leafTypeDef({ name: 'judge-impl', family: 'judge' }),
      ]),
      brain,
      store,
      now: () => 3,
      goldenCapture: false,
    });

    expect(result.verdict).toMatchObject({
      pass: false,
      findings: [{ title: 'not enough' }],
    });
  });
});
