import { describe, expect, it } from 'vitest';
import type { ChildPlan } from '../../src/contract/decision.js';
import {
  invalidSplitStructureVerdict,
  isomorphicSplitFailure,
  judgeSplitDecision,
  splitPlanArtifact,
} from '../../src/engine/decision/split-eval.js';
import {
  buildRegistry,
  leafTypeDef,
  makeGoal,
  MemoryEventStore,
  passVerdict,
  ScriptedBrain,
} from './stubs.js';

const child: ChildPlan = {
  localId: 'child',
  type: 'impl',
  title: 'Implement',
  spec: {},
  dependsOn: [],
  scope: [],
  budgetShare: 1,
};

describe('decision split eval', () => {
  it('serializes split children as the split plan artifact', () => {
    expect(splitPlanArtifact([child])).toEqual({
      kind: 'text',
      text: JSON.stringify([child]),
    });
  });

  it('builds invalid split structure verdicts with stable signatures', () => {
    expect(invalidSplitStructureVerdict('bad dep')).toMatchObject({
      pass: false,
      failureSignature: 'invalid-split:bad dep',
      findings: [{
        title: 'Invalid split structure',
        prescription: 'bad dep',
        gating: true,
      }],
    });
  });

  it('detects isomorphic split failures by failure signature', () => {
    const verdict = invalidSplitStructureVerdict('bad dep');

    expect(isomorphicSplitFailure(undefined, verdict)).toBe(false);
    expect(isomorphicSplitFailure(verdict, verdict)).toBe(true);
    expect(isomorphicSplitFailure(verdict, invalidSplitStructureVerdict('other'))).toBe(false);
  });

  it('judges split decisions and captures golden candidates when enabled', async () => {
    const store = new MemoryEventStore();
    const brain = new ScriptedBrain().queueJudge(passVerdict());

    const result = await judgeSplitDecision({
      goal: makeGoal({ type: 'splitter' }),
      children: [child],
      tier: 'low',
      registry: buildRegistry([
        leafTypeDef({ name: 'splitter', leafOnly: false }),
        leafTypeDef({ name: 'judge-split', family: 'arbiter', kind: 'judge' }),
      ]),
      brain,
      store,
      now: () => 1,
      goldenCapture: true,
      brainConfig: { modelByTier: { low: 'test-model' } },
    });

    expect(result.verdict.pass).toBe(true);
    expect((await store.list()).map((event) => event.type)).toEqual([
      'judge-verdict',
      'golden-candidate',
    ]);
  });
});
