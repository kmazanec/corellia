import { describe, expect, it } from 'vitest';
import type { Brain, BrainContext } from '../../src/contract/brain.js';
import type { ChildPlan, Decision } from '../../src/contract/decision.js';
import { ZERO_USAGE } from '../../src/contract/goal.js';
import type { Artifact } from '../../src/contract/report.js';
import type { Verdict } from '../../src/contract/verdict.js';
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

function registry(includeSplitJudge = false) {
  return buildRegistry([
    nonLeafTypeDef({ name: 'root' }),
    leafTypeDef({ name: 'child' }),
    leafTypeDef({ name: 'deep-dive-region', kind: 'learn', family: 'comprehend' }),
    leafTypeDef({ name: 'anchored', requiresScope: true }),
    ...(includeSplitJudge ? [leafTypeDef({ name: 'judge-split', kind: 'judge', family: 'arbiter' })] : []),
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

function splitJudgeBrain(captured: Artifact[]): Brain {
  return {
    async decide() { throw new Error('not used'); },
    async produce() { throw new Error('not used'); },
    async judge(_goal, subject) {
      captured.push(subject);
      return {
        value: { pass: true, findings: [] } satisfies Verdict,
        usage: ZERO_USAGE,
      };
    },
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

  it('events the structural rejection so the run record explains the re-decision', async () => {
    const store = new MemoryEventStore();
    const invalid = {
      kind: 'split',
      children: [child({ localId: 'bad', type: 'anchored', scope: [] })],
    } satisfies Extract<Decision, { kind: 'split' }>;
    const valid = {
      kind: 'split',
      children: [child({ localId: 'fixed', type: 'anchored', scope: ['src/engine'] })],
    } satisfies Extract<Decision, { kind: 'split' }>;

    await acceptSplitDecision({
      goal: makeGoal({ type: 'root' }),
      typeDef: registry().get('root'),
      decision: invalid,
      decideUsage: undefined,
      tier: 'mid',
      registry: registry(),
      brain: decidingBrain([valid], []),
      store,
      now: () => 3,
      goldenCapture: false,
      debitUsage: () => {},
      hasReachedCeiling: () => false,
    });

    const verdicts = await store.list({ type: 'judge-verdict' });
    expect(verdicts).toHaveLength(1);
    const evt = verdicts[0] as Extract<(typeof verdicts)[number], { type: 'judge-verdict' }>;
    expect(evt.judgeType).toBe('split-structure');
    expect(evt.verdict.pass).toBe(false);
    expect(evt.verdict.failureSignature).toContain('requires a non-empty scope');
  });

  it('blocks when a must-decompose goal answers satisfy twice (once corrected) after a rejected split', async () => {
    const store = new MemoryEventStore();
    const contexts: BrainContext[] = [];
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
      brain: decidingBrain([{ kind: 'satisfy' }, { kind: 'satisfy' }], contexts),
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
    // The second decide is the explicitly-corrected retry, carrying the rejected split.
    expect(contexts).toHaveLength(2);
    expect(contexts[1]).toMatchObject({ mustDecompose: true });
    expect(contexts[1]?.decideCorrection).toContain('Do NOT return satisfy again');
    expect(contexts[1]?.priorAttempt).toBeDefined();
    expect(store.types()).toEqual(['judge-verdict', 'decided', 'emitted']);
  });

  it('accepts when the corrected retry after a rejected-split satisfy produces a valid split', async () => {
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
      typeDef: { ...registry().get('root'), mustDecompose: true },
      decision: invalid,
      decideUsage: undefined,
      tier: 'mid',
      registry: registry(),
      brain: decidingBrain([{ kind: 'satisfy' }, valid], contexts),
      store: new MemoryEventStore(),
      now: () => 3,
      goldenCapture: false,
      debitUsage: () => {},
      hasReachedCeiling: () => false,
    });

    expect(result.kind).toBe('accepted');
    expect(result.kind === 'accepted' ? result.decision : undefined).toEqual(valid);
  });

  it('blocks a must-decompose goal that satisfies through the judge-rejection path instead of accepting it', async () => {
    const decision = {
      kind: 'split',
      children: [child({ localId: 'build', type: 'child', scope: ['src/engine'] })],
    } satisfies Extract<Decision, { kind: 'split' }>;
    const decisions: Decision[] = [{ kind: 'satisfy' }, { kind: 'satisfy' }];
    const brain: Brain = {
      async decide() {
        const next = decisions.shift();
        if (next === undefined) throw new Error('no scripted decision');
        return { value: next, usage: ZERO_USAGE };
      },
      async produce() { throw new Error('not used'); },
      async judge() {
        return {
          value: { pass: false, findings: [], failureSignature: 'weak-split' } satisfies Verdict,
          usage: ZERO_USAGE,
        };
      },
      async repair() { throw new Error('not used'); },
      async step() { throw new Error('not used'); },
    };

    const result = await acceptSplitDecision({
      goal: makeGoal({ type: 'root' }),
      typeDef: { ...registry(true).get('root'), mustDecompose: true },
      decision,
      decideUsage: undefined,
      tier: 'mid',
      registry: registry(true),
      brain,
      store: new MemoryEventStore(),
      now: () => 6,
      goldenCapture: false,
      debitUsage: () => {},
      hasReachedCeiling: () => false,
    });

    expect(result.kind).toBe('emitted');
    expect(result.kind === 'emitted' ? result.report.blockers[0] : '').toContain(
      'must decompose and cannot satisfy directly',
    );
  });

  it('runs coverage augmentation before judge-split evaluates the graph', async () => {
    const capturedSubjects: Artifact[] = [];
    const decision = {
      kind: 'split',
      children: [child({ localId: 'build', type: 'child', scope: ['src/engine'] })],
    } satisfies Extract<Decision, { kind: 'split' }>;

    const result = await acceptSplitDecision({
      goal: makeGoal({ id: 'root', type: 'root', scope: ['src/'] }),
      typeDef: registry(true).get('root'),
      decision,
      decideUsage: undefined,
      tier: 'mid',
      registry: registry(true),
      brain: splitJudgeBrain(capturedSubjects),
      store: new MemoryEventStore(),
      now: () => 4,
      repoRoot: '/repo',
      knowledge: {
        query: async () => ({ headSha: 'h1', artifacts: [], regionFacts: [] }),
        validate: async () => true,
        mintComprehension: () => [
          child({
            localId: 'dive-src',
            type: 'deep-dive-region',
            scope: ['src/'],
            budgetShare: 0.2,
          }),
        ],
      },
      goldenCapture: false,
      debitUsage: () => {},
      hasReachedCeiling: () => false,
    });

    expect(result.kind).toBe('accepted');
    const accepted = result.kind === 'accepted' && result.decision.kind === 'split'
      ? result.decision.children
      : [];
    expect(accepted.map((c) => c.localId)).toContain('dive-src');
    expect(accepted.find((c) => c.localId === 'build')?.dependsOn).toContain('dive-src');

    expect(capturedSubjects).toHaveLength(1);
    const judged = JSON.parse((capturedSubjects[0] as { kind: 'text'; text: string }).text) as ChildPlan[];
    expect(judged.map((c) => c.localId)).toContain('dive-src');
    expect(judged.find((c) => c.localId === 'build')?.dependsOn).toContain('dive-src');
  });

  it('blocks before judge-split when coverage injection creates an invalid graph', async () => {
    const capturedSubjects: Artifact[] = [];
    const store = new MemoryEventStore();
    const decision = {
      kind: 'split',
      children: [child({ localId: 'build', type: 'child', scope: ['src/engine'] })],
    } satisfies Extract<Decision, { kind: 'split' }>;

    const result = await acceptSplitDecision({
      goal: makeGoal({ id: 'root', type: 'root', scope: ['src/'] }),
      typeDef: registry(true).get('root'),
      decision,
      decideUsage: undefined,
      tier: 'mid',
      registry: registry(true),
      brain: splitJudgeBrain(capturedSubjects),
      store,
      now: () => 5,
      repoRoot: '/repo',
      knowledge: {
        query: async () => ({ headSha: 'h1', artifacts: [], regionFacts: [] }),
        validate: async () => true,
        mintComprehension: () => [
          child({
            localId: 'build',
            type: 'deep-dive-region',
            scope: ['src/'],
            budgetShare: 0.2,
          }),
        ],
      },
      goldenCapture: false,
      debitUsage: () => {},
      hasReachedCeiling: () => false,
    });

    expect(result.kind).toBe('emitted');
    expect(result.kind === 'emitted' ? result.report.blockers[0] : '').toContain('coverage-gate-invalid-split');
    expect(capturedSubjects).toHaveLength(0);
  });
});
