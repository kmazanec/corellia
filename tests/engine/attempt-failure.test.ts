import { describe, expect, it } from 'vitest';
import { ZERO_USAGE } from '../../src/contract/goal.js';
import { resolveAttemptFailure } from '../../src/engine/attempt/failure.js';
import {
  failVerdict,
  makeGoal,
  MemoryEventStore,
  ScriptedBrain,
  textArtifact,
} from './stubs.js';

const budget = { attempts: 1, tokens: 100, toolCalls: 3, wallClockMs: 1_000 };

describe('attempt failure resolver', () => {
  it('blocks immediately for escalated findings', async () => {
    const store = new MemoryEventStore();

    const result = await resolveAttemptFailure({
      goal: makeGoal(),
      artifact: textArtifact('bad'),
      verdict: failVerdict('needs redesign', undefined, true),
      budget,
      tier: 'low',
      tierIndex: 0,
      tierLadder: ['low', 'mid'],
      priorAttempt: undefined,
      brain: new ScriptedBrain(),
      store,
      now: () => 1,
      onBrief: undefined,
      debitUsage: () => {},
      hasReachedCeiling: () => false,
      onCeilingReached: async () => {
        throw new Error('ceiling should not run');
      },
    });

    expect(result.kind).toBe('blocked');
    expect(result.kind === 'blocked' ? result.report.blockers[0] : '').toContain('Escalated finding');
    expect(store.types()).toEqual(['blocked', 'emitted']);
  });

  it('blocks repeated failure signatures as isomorphic failures', async () => {
    const store = new MemoryEventStore();
    const verdict = failVerdict('same failure', undefined, undefined, 'same-signature');

    const result = await resolveAttemptFailure({
      goal: makeGoal(),
      artifact: textArtifact('bad'),
      verdict,
      budget,
      tier: 'mid',
      tierIndex: 1,
      tierLadder: ['low', 'mid', 'high'],
      priorAttempt: { artifact: textArtifact('prior'), verdict },
      brain: new ScriptedBrain(),
      store,
      now: () => 2,
      onBrief: undefined,
      debitUsage: () => {},
      hasReachedCeiling: () => false,
      onCeilingReached: async () => {
        throw new Error('ceiling should not run');
      },
    });

    expect(result.kind).toBe('blocked');
    expect(result.kind === 'blocked' ? result.report.blockers[0] : '').toContain('Isomorphic failure');
    expect(store.types()).toEqual(['blocked', 'emitted']);
  });

  it('carries salvaged partial work on the blocked report instead of a null artifact', async () => {
    const store = new MemoryEventStore();
    const verdict = failVerdict('same failure', undefined, undefined, 'same-signature');
    const salvaged = { kind: 'files' as const, files: [{ path: 'src/x.ts', content: 'export type X = 1;\n' }] };

    const result = await resolveAttemptFailure({
      goal: makeGoal(),
      artifact: textArtifact('a prose summary, not files'),
      verdict,
      budget,
      tier: 'mid',
      tierIndex: 1,
      tierLadder: ['low', 'mid', 'high'],
      priorAttempt: { artifact: textArtifact('prior'), verdict },
      salvagedArtifact: salvaged,
      brain: new ScriptedBrain(),
      store,
      now: () => 2,
      onBrief: undefined,
      debitUsage: () => {},
      hasReachedCeiling: () => false,
      onCeilingReached: async () => {
        throw new Error('ceiling should not run');
      },
    });

    expect(result.kind).toBe('blocked');
    expect(result.kind === 'blocked' ? result.report.artifact : null).toEqual(salvaged);
  });

  it('repairs prescribed gating findings', async () => {
    const store = new MemoryEventStore();
    let usageDebited = false;

    const result = await resolveAttemptFailure({
      goal: makeGoal(),
      artifact: textArtifact('bad'),
      verdict: failVerdict('fixable', 'apply patch'),
      budget,
      tier: 'low',
      tierIndex: 0,
      tierLadder: ['low', 'mid'],
      priorAttempt: undefined,
      brain: new ScriptedBrain().queueRepairWithUsage(textArtifact('fixed'), {
        ...ZERO_USAGE,
        outputTokens: 5,
      }),
      store,
      now: () => 3,
      onBrief: undefined,
      debitUsage: () => {
        usageDebited = true;
      },
      hasReachedCeiling: () => false,
      onCeilingReached: async () => {
        throw new Error('ceiling should not run');
      },
    });

    expect(result).toMatchObject({ kind: 'repaired', artifact: textArtifact('fixed'), budget });
    expect(usageDebited).toBe(true);
    expect(store.types()).toEqual(['repair-applied']);
  });

  it('returns a ceiling block when repair trips the spend ceiling', async () => {
    const store = new MemoryEventStore();

    const result = await resolveAttemptFailure({
      goal: makeGoal(),
      artifact: textArtifact('bad'),
      verdict: failVerdict('fixable', 'apply patch'),
      budget,
      tier: 'low',
      tierIndex: 0,
      tierLadder: ['low', 'mid'],
      priorAttempt: undefined,
      brain: new ScriptedBrain().queueRepair(textArtifact('fixed')),
      store,
      now: () => 4,
      onBrief: undefined,
      debitUsage: () => {},
      hasReachedCeiling: () => true,
      onCeilingReached: async () => ({
        artifact: null,
        proof: [],
        lessons: [],
        memoriesUsed: [],
        blockers: ['ceiling'],
        findings: [],
        learned: '',
      }),
    });

    expect(result).toMatchObject({ kind: 'blocked', report: { blockers: ['ceiling'] } });
    expect(store.types()).toEqual(['repair-applied']);
  });

  it('escalates to the next tier when no prescription is available', async () => {
    const store = new MemoryEventStore();

    const result = await resolveAttemptFailure({
      goal: makeGoal(),
      artifact: textArtifact('bad'),
      verdict: failVerdict('not good enough'),
      budget,
      tier: 'low',
      tierIndex: 0,
      tierLadder: ['low', 'mid'],
      priorAttempt: undefined,
      brain: new ScriptedBrain(),
      store,
      now: () => 5,
      onBrief: undefined,
      debitUsage: () => {},
      hasReachedCeiling: () => false,
      onCeilingReached: async () => {
        throw new Error('ceiling should not run');
      },
    });

    expect(result).toEqual({ kind: 'escalated', tier: 'mid', budget });
    expect(store.types()).toEqual(['tier-escalated']);
  });

  it('blocks as non-convergent when the tier ladder is exhausted', async () => {
    const store = new MemoryEventStore();

    const result = await resolveAttemptFailure({
      goal: makeGoal(),
      artifact: textArtifact('bad'),
      verdict: failVerdict('not good enough'),
      budget,
      tier: 'high',
      tierIndex: 0,
      tierLadder: ['high'],
      priorAttempt: undefined,
      brain: new ScriptedBrain(),
      store,
      now: () => 6,
      onBrief: undefined,
      debitUsage: () => {},
      hasReachedCeiling: () => false,
      onCeilingReached: async () => {
        throw new Error('ceiling should not run');
      },
    });

    expect(result.kind).toBe('blocked');
    expect(result.kind === 'blocked' ? result.report.blockers[0] : '').toContain('cannot converge');
    expect(store.types()).toEqual(['blocked', 'emitted']);
  });
});

describe('transport failures and isomorphism', () => {
  it('does NOT isomorphic-block two consecutive step-loop:transport failures', async () => {
    // A transport failure says nothing about the subject; two in a row is a
    // flaky provider window. The tier ladder retries instead of blocking.
    const store = new MemoryEventStore();
    const verdict = failVerdict('Step loop failed: timeout', undefined, undefined, 'step-loop:transport');

    const result = await resolveAttemptFailure({
      goal: makeGoal(),
      artifact: textArtifact('partial'),
      verdict,
      budget,
      tier: 'low',
      tierIndex: 0,
      tierLadder: ['low', 'mid', 'high'],
      priorAttempt: { artifact: textArtifact('prior'), verdict },
      brain: new ScriptedBrain(),
      store,
      now: () => 3,
      onBrief: undefined,
      debitUsage: () => {},
      hasReachedCeiling: () => false,
      onCeilingReached: async () => {
        throw new Error('ceiling should not run');
      },
    });

    // Escalates to the next tier (a different model) rather than blocking.
    expect(result.kind).toBe('escalated');
    expect(result.kind === 'escalated' ? result.tier : undefined).toBe('mid');
  });
});

describe('repair robustness', () => {
  it('falls through to tier escalation when the repair call throws (provider timeout)', async () => {
    const store = new MemoryEventStore();
    const brain = new ScriptedBrain();
    brain.repair = async () => {
      const err = new Error('The operation was aborted due to timeout');
      err.name = 'TimeoutError';
      throw err;
    };

    const result = await resolveAttemptFailure({
      goal: makeGoal(),
      artifact: textArtifact('bad'),
      verdict: failVerdict('fixable', 'apply patch'),
      budget,
      tier: 'low',
      tierIndex: 0,
      tierLadder: ['low', 'mid'],
      priorAttempt: undefined,
      brain,
      store,
      now: () => 7,
      onBrief: undefined,
      debitUsage: () => {},
      hasReachedCeiling: () => false,
      onCeilingReached: async () => {
        throw new Error('ceiling should not run');
      },
    });

    // No throw out of the resolver; the ladder takes over.
    expect(result.kind).toBe('escalated');
    expect(result.kind === 'escalated' ? result.tier : undefined).toBe('mid');
    expect(await store.list({ type: 'repair-applied' })).toHaveLength(0);
  });
});

describe('transport failure at the top rung', () => {
  const transportVerdict = failVerdict('Step loop failed: timeout', undefined, undefined, 'step-loop:transport');

  it('grants one same-tier retry when there is no next rung', async () => {
    const result = await resolveAttemptFailure({
      goal: makeGoal(),
      artifact: textArtifact('partial'),
      verdict: transportVerdict,
      budget,
      tier: 'high',
      tierIndex: 0,
      tierLadder: ['high'],
      priorAttempt: undefined,
      brain: new ScriptedBrain(),
      store: new MemoryEventStore(),
      now: () => 8,
      onBrief: undefined,
      debitUsage: () => {},
      hasReachedCeiling: () => false,
      onCeilingReached: async () => {
        throw new Error('ceiling should not run');
      },
    });

    expect(result.kind).toBe('escalated');
    expect(result.kind === 'escalated' ? result.tier : undefined).toBe('high');
  });

  it('blocks on the SECOND consecutive transport failure at the top rung', async () => {
    const store = new MemoryEventStore();
    const result = await resolveAttemptFailure({
      goal: makeGoal(),
      artifact: textArtifact('partial'),
      verdict: transportVerdict,
      budget,
      tier: 'high',
      tierIndex: 0,
      tierLadder: ['high'],
      priorAttempt: { artifact: textArtifact('prior'), verdict: transportVerdict },
      brain: new ScriptedBrain(),
      store,
      now: () => 9,
      onBrief: undefined,
      debitUsage: () => {},
      hasReachedCeiling: () => false,
      onCeilingReached: async () => {
        throw new Error('ceiling should not run');
      },
    });

    expect(result.kind).toBe('blocked');
    expect(result.kind === 'blocked' ? result.report.blockers[0] : '').toContain('cannot converge');
    // The block still names the transport cause via findings.
    expect(result.kind === 'blocked' ? result.report.findings.join(' ') : '').toContain('timeout');
  });
});
