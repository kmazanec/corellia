import { describe, expect, it } from 'vitest';
import type { Brain, BrainContext } from '../../src/contract/brain.js';
import type { ChildPlan, Decision } from '../../src/contract/decision.js';
import { ZERO_USAGE } from '../../src/contract/goal.js';
import { acceptSplitDecision } from '../../src/engine/decision/split-acceptance.js';
import {
  buildRegistry,
  leafTypeDef,
  makeGoal,
  MemoryEventStore,
  nonLeafTypeDef,
} from './stubs.js';

const child = (overrides: Partial<ChildPlan> & Pick<ChildPlan, 'localId'>): ChildPlan => ({
  localId: overrides.localId,
  type: overrides.type ?? 'child',
  title: overrides.title ?? overrides.localId,
  spec: overrides.spec ?? {},
  dependsOn: overrides.dependsOn ?? [],
  scope: overrides.scope ?? ['src/'],
  budgetShare: overrides.budgetShare ?? 0.5,
});

function registry() {
  return buildRegistry([
    nonLeafTypeDef({ name: 'root' }),
    leafTypeDef({ name: 'child' }),
    leafTypeDef({ name: 'anchored', requiresScope: true }),
  ]);
}

function decidingBrain(decisions: Decision[], contexts: BrainContext[]): Brain {
  return {
    async decide(_goal, ctx) {
      contexts.push(ctx);
      const decision = decisions.shift();
      if (decision === undefined) throw new Error('no scripted decision');
      return { value: decision, usage: ZERO_USAGE };
    },
    async produce() { throw new Error('not used'); },
    async judge() { throw new Error('not used'); },
    async repair() { throw new Error('not used'); },
    async step() { throw new Error('not used'); },
  };
}

describe('split acceptance policy', () => {
  it('accepts a valid split without re-decision when no split judge exists', async () => {
    const decision = {
      kind: 'split',
      children: [child({ localId: 'build' })],
    } satisfies Extract<Decision, { kind: 'split' }>;

    const result = await acceptSplitDecision({
      goal: makeGoal({ type: 'root' }),
      typeDef: registry().get('root'),
      decision,
      decideUsage: undefined,
      tier: 'mid',
      registry: registry(),
      brain: decidingBrain([], []),
      store: new MemoryEventStore(),
      now: () => 1,
      goldenCapture: false,
      debitUsage: () => {},
      hasReachedCeiling: () => false,
    });

    expect(result).toEqual({ kind: 'accepted', decision, decideUsage: undefined });
  });

  it('re-decides with priorAttempt context after structural split rejection', async () => {
    const contexts: BrainContext[] = [];
    const invalid = {
      kind: 'split',
      children: [child({ localId: 'bad', type: 'anchored', scope: [] })],
    } satisfies Extract<Decision, { kind: 'split' }>;
    const valid = {
      kind: 'split',
      children: [child({ localId: 'fixed', type: 'anchored', scope: ['src/engine'] })],
    } satisfies Extract<Decision, { kind: 'split' }>;

    const result = await acceptSplitDecision({
      goal: makeGoal({ type: 'root' }),
      typeDef: registry().get('root'),
      decision: invalid,
      decideUsage: undefined,
      tier: 'mid',
      registry: registry(),
      brain: decidingBrain([valid], contexts),
      store: new MemoryEventStore(),
      now: () => 2,
      goldenCapture: false,
      debitUsage: () => {},
      hasReachedCeiling: () => false,
    });

    expect(result).toEqual({ kind: 'accepted', decision: valid, decideUsage: ZERO_USAGE });
    expect(contexts[0]).toMatchObject({
      tier: 'mid',
      priorAttempt: {
        artifact: { kind: 'text' },
        verdict: {
          pass: false,
          findings: [{ title: 'Invalid split structure' }],
        },
      },
    });
  });

  it('blocks when a must-decompose goal re-decides to satisfy after a rejected split', async () => {
    const store = new MemoryEventStore();
    const invalid = {
      kind: 'split',
      children: [child({ localId: 'bad', type: 'anchored', scope: [] })],
    } satisfies Extract<Decision, { kind: 'split' }>;

    const result = await acceptSplitDecision({
      goal: makeGoal({ type: 'root' }),
      typeDef: { ...registry().get('root'), mustDecompose: true },
      decision: invalid,
      decideUsage: undefined,
      tier: 'mid',
      registry: registry(),
      brain: decidingBrain([{ kind: 'satisfy' }], []),
      store,
      now: () => 3,
      goldenCapture: false,
      debitUsage: () => {},
      hasReachedCeiling: () => false,
    });

    expect(result.kind).toBe('emitted');
    expect(result.kind === 'emitted' ? result.report.blockers[0] : '').toContain(
      'must decompose and cannot satisfy directly',
    );
    expect(store.types()).toEqual(['decided', 'emitted']);
  });
});
