import { describe, expect, it } from 'vitest';
import { ZERO_USAGE } from '../../src/contract/goal.js';
import type { Decision } from '../../src/contract/decision.js';
import {
  rejectedSplitSatisfyReport,
  runMustDecomposeGuard,
} from '../../src/engine/decision/must-decompose-guard.js';
import {
  failVerdict,
  makeGoal,
  MemoryEventStore,
  passVerdict,
  rawBrain,
  textArtifact,
} from './stubs.js';

const splitDecision: Decision = {
  kind: 'split',
  children: [{
    localId: 'child',
    type: 'impl',
    title: 'Implement',
    spec: {},
    dependsOn: [],
    scope: [],
    budgetShare: 1,
  }],
};

describe('must decompose guard', () => {
  it('leaves non-satisfy or disabled decisions unchanged', async () => {
    const store = new MemoryEventStore();
    const goal = makeGoal({ type: 'deliver-intent' });

    const result = await runMustDecomposeGuard({
      enabled: false,
      goal,
      decision: { kind: 'satisfy' },
      decideUsage: undefined,
      tier: 'low',
      skill: undefined,
      repoShape: undefined,
      brain: rawBrain({
        decide: async () => {
          throw new Error('guard should not re-decide');
        },
        produce: async () => textArtifact('unused'),
        judge: async () => passVerdict(),
        repair: async () => textArtifact('unused'),
      }),
      store,
      now: () => 1,
      debitUsage: () => {},
      hasReachedCeiling: () => false,
    });

    expect(result).toEqual({
      kind: 'unchanged',
      decision: { kind: 'satisfy' },
      decideUsage: undefined,
    });
    expect(await store.list()).toEqual([]);
  });

  it('records the rejected satisfy decision and adopts a corrected split', async () => {
    const store = new MemoryEventStore();
    const goal = makeGoal({ type: 'deliver-intent' });
    let correctedContext = '';
    let debited = false;

    const result = await runMustDecomposeGuard({
      enabled: true,
      goal,
      decision: { kind: 'satisfy' },
      decideUsage: ZERO_USAGE,
      tier: 'mid',
      skill: 'family skill',
      repoShape: 'repo shape',
      brain: rawBrain({
        decide: async (_goal, ctx) => {
          correctedContext = `${ctx.tier}:${ctx.mustDecompose}:${ctx.skill}:${ctx.repoShape}`;
          return splitDecision;
        },
        produce: async () => textArtifact('unused'),
        judge: async () => passVerdict(),
        repair: async () => textArtifact('unused'),
      }),
      store,
      now: () => 2,
      debitUsage: () => { debited = true; },
      hasReachedCeiling: () => false,
    });

    expect(result).toEqual({ kind: 'adopted', decision: splitDecision, decideUsage: ZERO_USAGE });
    expect(correctedContext).toBe('mid:true:family skill:repo shape');
    expect(debited).toBe(true);
    expect((await store.list()).map((event) => event.type)).toEqual(['decided']);
  });

  it('blocks when the corrected decision still satisfies', async () => {
    const store = new MemoryEventStore();
    const goal = makeGoal({ type: 'deliver-intent' });

    const result = await runMustDecomposeGuard({
      enabled: true,
      goal,
      decision: { kind: 'satisfy' },
      decideUsage: undefined,
      tier: 'low',
      skill: undefined,
      repoShape: undefined,
      brain: rawBrain({
        decide: async () => ({ kind: 'satisfy' }),
        produce: async () => textArtifact('unused'),
        judge: async () => failVerdict(),
        repair: async () => textArtifact('unused'),
      }),
      store,
      now: () => 3,
      debitUsage: () => {},
      hasReachedCeiling: () => false,
    });

    expect(result.kind).toBe('blocked');
    expect((await store.list()).map((event) => event.type)).toEqual(['decided', 'decided', 'emitted']);
  });

  it('returns ceiling after debiting a corrected decision that reaches the spend ceiling', async () => {
    const store = new MemoryEventStore();
    const goal = makeGoal({ type: 'deliver-intent' });

    const result = await runMustDecomposeGuard({
      enabled: true,
      goal,
      decision: { kind: 'satisfy' },
      decideUsage: undefined,
      tier: 'low',
      skill: undefined,
      repoShape: undefined,
      brain: rawBrain({
        decide: async () => splitDecision,
        produce: async () => textArtifact('unused'),
        judge: async () => passVerdict(),
        repair: async () => textArtifact('unused'),
      }),
      store,
      now: () => 4,
      debitUsage: () => {},
      hasReachedCeiling: () => true,
    });

    expect(result).toEqual({ kind: 'ceiling' });
    expect((await store.list()).map((event) => event.type)).toEqual(['decided', 'decided']);
  });

  it('builds the rejected-split satisfy report', () => {
    expect(rejectedSplitSatisfyReport(makeGoal({ type: 'deliver-intent' })).blockers[0])
      .toContain('after a rejected split');
  });
});
