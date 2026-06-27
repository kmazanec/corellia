import { describe, expect, it } from 'vitest';
import type { Decision } from '../../src/contract/decision.js';
import { ZERO_USAGE } from '../../src/contract/goal.js';
import { runTerracedScan } from '../../src/engine/decision/terraced-scan.js';
import {
  buildRegistry,
  failVerdict,
  leafTypeDef,
  makeGoal,
  MemoryEventStore,
  passVerdict,
  ScriptedBrain,
} from './stubs.js';

const split = (localId: string): Extract<Decision, { kind: 'split' }> => ({
  kind: 'split',
  children: [{
    localId,
    type: 'impl',
    title: `Implement ${localId}`,
    spec: {},
    dependsOn: [],
    scope: [],
    budgetShare: 1,
  }],
});

const registry = buildRegistry([
  leafTypeDef({ name: 'splitter', leafOnly: false }),
  leafTypeDef({ name: 'judge-split', kind: 'judge', family: 'arbiter' }),
]);

describe('terraced scan', () => {
  it('returns a non-split candidate immediately as a meaningful decision', async () => {
    const brain = new ScriptedBrain().queueDecide({ kind: 'satisfy' });

    const result = await runTerracedScan({
      goal: makeGoal({ type: 'splitter' }),
      k: 2,
      lenses: ['first', 'second'],
      baseCtx: { tier: 'low', memories: [] },
      tier: 'low',
      brain,
      registry,
      store: new MemoryEventStore(),
      now: () => 1,
      goldenCapture: false,
      debitUsage: () => {},
      hasReachedCeiling: () => false,
    });

    expect(result).toEqual({ decision: { kind: 'satisfy' }, loserFindings: [], winnerUsage: ZERO_USAGE });
  });

  it('selects the first passing candidate and reports alternatives', async () => {
    const store = new MemoryEventStore();
    const brain = new ScriptedBrain()
      .queueDecide(split('a'), split('b'))
      .queueJudge(passVerdict(), failVerdict('too broad'));

    const result = await runTerracedScan({
      goal: makeGoal({ type: 'splitter' }),
      k: 2,
      lenses: ['architect', 'reuse'],
      baseCtx: { tier: 'low', memories: [] },
      tier: 'low',
      brain,
      registry,
      store,
      now: () => 2,
      goldenCapture: false,
      debitUsage: () => {},
      hasReachedCeiling: () => false,
    });

    expect(result).toMatchObject({
      decision: split('a'),
      loserFindings: ['alternative considered (lens=reuse): too broad'],
    });
    expect((await store.list({ type: 'judge-verdict' }))).toHaveLength(2);
  });

  it('falls back to one more decision with the best failed candidate as priorAttempt', async () => {
    const brain = new ScriptedBrain()
      .queueDecide(split('a'), split('b'), split('fallback'))
      .queueJudge(failVerdict('two issues'), failVerdict('one issue'));

    const result = await runTerracedScan({
      goal: makeGoal({ type: 'splitter' }),
      k: 2,
      lenses: ['architect', 'reuse'],
      baseCtx: { tier: 'low', memories: [] },
      tier: 'low',
      brain,
      registry,
      store: new MemoryEventStore(),
      now: () => 3,
      goldenCapture: false,
      debitUsage: () => {},
      hasReachedCeiling: () => false,
    });

    expect(result).toMatchObject({
      decision: split('fallback'),
      loserFindings: [
        'alternative considered (lens=architect): two issues',
        'alternative considered (lens=reuse): one issue',
      ],
    });
  });

  it('short-circuits when usage reaches the spend ceiling', async () => {
    const brain = new ScriptedBrain().queueDecide(split('a'));
    let debited = false;

    const result = await runTerracedScan({
      goal: makeGoal({ type: 'splitter' }),
      k: 1,
      lenses: ['architect'],
      baseCtx: { tier: 'low', memories: [] },
      tier: 'low',
      brain,
      registry,
      store: new MemoryEventStore(),
      now: () => 4,
      goldenCapture: false,
      debitUsage: () => { debited = true; },
      hasReachedCeiling: () => true,
    });

    expect(result).toEqual({ ceiling: true });
    expect(debited).toBe(true);
  });
});
