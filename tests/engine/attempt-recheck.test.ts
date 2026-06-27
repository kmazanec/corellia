import { describe, expect, it } from 'vitest';
import { ZERO_USAGE } from '../../src/contract/goal.js';
import { recheckArtifactAfterRepair } from '../../src/engine/attempt/recheck.js';
import {
  alwaysFailCheck,
  alwaysPassCheck,
  buildRegistry,
  failVerdict,
  leafTypeDef,
  makeGoal,
  MemoryEventStore,
  passVerdict,
  ScriptedBrain,
  textArtifact,
} from './stubs.js';

describe('attempt repair recheck', () => {
  it('returns the deterministic verdict without judging when checks still fail', async () => {
    const store = new MemoryEventStore();
    const typeDef = leafTypeDef({
      name: 'impl',
      deterministic: [alwaysFailCheck('lint', 'still bad')],
      judgeType: 'judge-impl',
    });

    const result = await recheckArtifactAfterRepair({
      goal: makeGoal({ type: 'impl' }),
      artifact: textArtifact('fixed?'),
      budget: { attempts: 1, tokens: 100, toolCalls: 3, wallClockMs: 1_000 },
      tier: 'low',
      typeDef,
      registry: buildRegistry([typeDef, leafTypeDef({ name: 'judge-impl', kind: 'judge' })]),
      brain: new ScriptedBrain(),
      store,
      now: () => 1,
      checkContext: undefined,
      goldenCapture: false,
      debitUsage: () => {},
      hasReachedCeiling: () => false,
    });

    expect(result.passed).toBe(false);
    expect(result.verdict).toMatchObject({ pass: false });
    expect(store.types()).toEqual(['deterministic-checked']);
  });

  it('passes without judging when deterministic checks pass and the type has no judge', async () => {
    const store = new MemoryEventStore();
    const typeDef = leafTypeDef({
      name: 'impl',
      deterministic: [alwaysPassCheck('lint')],
      judgeType: null,
    });

    const result = await recheckArtifactAfterRepair({
      goal: makeGoal({ type: 'impl' }),
      artifact: textArtifact('fixed'),
      budget: { attempts: 1, tokens: 100, toolCalls: 3, wallClockMs: 1_000 },
      tier: 'mid',
      typeDef,
      registry: buildRegistry([typeDef]),
      brain: new ScriptedBrain(),
      store,
      now: () => 2,
      checkContext: undefined,
      goldenCapture: false,
      debitUsage: () => {},
      hasReachedCeiling: () => false,
    });

    expect(result).toMatchObject({ passed: true, verdict: null, tier: 'mid' });
    expect(store.types()).toEqual(['deterministic-checked']);
  });

  it('judges after deterministic checks pass and returns judge failures', async () => {
    const store = new MemoryEventStore();
    const typeDef = leafTypeDef({
      name: 'impl',
      deterministic: [alwaysPassCheck('lint')],
      judgeType: 'judge-impl',
    });

    const result = await recheckArtifactAfterRepair({
      goal: makeGoal({ type: 'impl' }),
      artifact: textArtifact('partial'),
      budget: { attempts: 1, tokens: 100, toolCalls: 3, wallClockMs: 1_000 },
      tier: 'high',
      typeDef,
      registry: buildRegistry([typeDef, leafTypeDef({ name: 'judge-impl', kind: 'judge' })]),
      brain: new ScriptedBrain().queueJudge(failVerdict('still incomplete')),
      store,
      now: () => 3,
      checkContext: undefined,
      goldenCapture: false,
      debitUsage: () => {},
      hasReachedCeiling: () => false,
    });

    expect(result).toMatchObject({ passed: false, tier: 'high' });
    expect(result.verdict).toMatchObject({ pass: false, findings: [{ title: 'still incomplete' }] });
    expect(store.types()).toEqual(['deterministic-checked', 'judge-verdict']);
  });

  it('surfaces the spend ceiling after judge usage is debited', async () => {
    const store = new MemoryEventStore();
    const typeDef = leafTypeDef({
      name: 'impl',
      deterministic: [],
      judgeType: 'judge-impl',
    });
    let usageDebited = false;

    const result = await recheckArtifactAfterRepair({
      goal: makeGoal({ type: 'impl' }),
      artifact: textArtifact('fixed'),
      budget: { attempts: 1, tokens: 100, toolCalls: 3, wallClockMs: 1_000 },
      tier: 'low',
      typeDef,
      registry: buildRegistry([typeDef, leafTypeDef({ name: 'judge-impl', kind: 'judge' })]),
      brain: new ScriptedBrain().queueJudgeWithUsage(passVerdict(), {
        ...ZERO_USAGE,
        outputTokens: 10,
      }),
      store,
      now: () => 4,
      checkContext: undefined,
      goldenCapture: false,
      debitUsage: () => {
        usageDebited = true;
      },
      hasReachedCeiling: () => usageDebited,
    });

    expect(result).toMatchObject({ passed: false, verdict: null, ceiling: true });
    expect(store.types()).toEqual(['judge-verdict']);
  });
});
