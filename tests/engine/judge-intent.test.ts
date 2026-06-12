/**
 * Tests for the judge skill + intent dial wiring .
 *
 * At every brain.judge call site the rubric is enriched with:
 *   (a) the judge type's family skill section + preamble
 *   (b) the family's '## The intent dial' section when present (GATING-1 fix)
 *   (c) an intent line: "The goal's intent is <intent>. Apply the bar that intent demands per the skill."
 *
 * Behavioral tests verify:
 *   1. The rubric captured by the scripted brain contains the intent line.
 *   2. The same artifact judged under intent:spike vs intent:production gets
 *      DIFFERENT rubric text (the dial is in the rubric).
 *   3. A scripted brain that returns pass-for-spike / fail-for-production keyed
 *      off the rubric text demonstrates the dial end-to-end.
 *
 * REAL-SKILL tests (GATING-1) verify with the ACTUAL skill files:
 *   4. A critique-doc judge rubric under intent:production contains 'Mimicry bar'.
 *   5. A critique-doc judge rubric under intent:spike contains 'Answers-the-question'.
 *   6. A judge-split rubric under intent:spike contains the structural-invariant
 *      protection text ('never waived by intent').
 *
 * HARD INVARIANT: deterministic checks never receive the intent line — that
 * would be tested by absence (deterministic checks use the artifact directly,
 * not the rubric).
 */

import { describe, it, expect } from 'vitest';
import { Engine } from '../../src/engine/engine.js';
import {
  MemoryEventStore,
  NoopMemoryView,
  buildRegistry,
  leafTypeDef,
  makeGoal,
  textArtifact,
  passVerdict,
  failVerdict,
} from './stubs.js';
import type { Brain, BrainContext, StepOutput, StepTranscript } from '../../src/contract/brain.js';
import type { Goal } from '../../src/contract/goal.js';
import type { Artifact } from '../../src/contract/report.js';
import type { Verdict } from '../../src/contract/verdict.js';
import { ZERO_USAGE } from '../../src/contract/goal.js';
import { starterTypes } from '../../src/library/starter-types.js';
import { _clearSkillCache } from '../../src/library/skills.js';

// ── helpers ───────────────────────────────────────────────────────────────────

/** A goal type that has a judgeType but no deterministic checks. */
function judgedType(judgeTypeName: string) {
  return leafTypeDef({
    name: 'widget',
    family: 'test',
    grants: [],
    judgeType: judgeTypeName,
    deterministic: [],
  });
}

/** A goal type registered as a judge type so enrichRubric can look it up. */
function judgeTypeDef(name: string) {
  return leafTypeDef({
    name,
    kind: 'judge',
    family: 'test',
    grants: [],
    judgeType: null,
    deterministic: [],
  });
}

/** A scripted brain that captures the rubric it receives and returns a given verdict. */
function rubricCaptureBrain(verdict: Verdict): Brain & { capturedRubrics: string[] } {
  const capturedRubrics: string[] = [];
  return {
    capturedRubrics,
    async decide(): Promise<{ value: import('../../src/contract/decision.js').Decision; usage: import('../../src/contract/goal.js').Usage }> {
      throw new Error('not used');
    },
    async produce(): Promise<{ value: Artifact; usage: import('../../src/contract/goal.js').Usage }> {
      return { value: textArtifact('artifact text'), usage: ZERO_USAGE };
    },
    async judge(_goal: Goal, _subject: Artifact, rubric: string): Promise<{ value: Verdict; usage: import('../../src/contract/goal.js').Usage }> {
      capturedRubrics.push(rubric);
      return { value: verdict, usage: ZERO_USAGE };
    },
    async repair(): Promise<{ value: Artifact; usage: import('../../src/contract/goal.js').Usage }> {
      throw new Error('not used');
    },
    async step(): Promise<StepOutput> {
      throw new Error('not used');
    },
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('judge rubric contains the intent line', () => {
  it('rubric seen by brain.judge contains "The goal\'s intent is production"', async () => {
    const store = new MemoryEventStore();
    const brain = rubricCaptureBrain(passVerdict());

    const registry = buildRegistry([judgedType('judge-widget'), judgeTypeDef('judge-widget')]);
    const engine = new Engine({
      registry,
      brain,
      store,
      memory: new NoopMemoryView(),
    });

    const goal = makeGoal({
      type: 'widget',
      intent: 'production',
    });

    await engine.run(goal);

    expect(brain.capturedRubrics.length).toBeGreaterThanOrEqual(1);
    const rubric = brain.capturedRubrics[0]!;
    expect(rubric).toContain("The goal's intent is production");
    expect(rubric).toContain('Apply the bar that intent demands per the skill');
  });

  it('rubric seen by brain.judge contains "The goal\'s intent is spike" for a spike goal', async () => {
    const store = new MemoryEventStore();
    const brain = rubricCaptureBrain(passVerdict());

    const registry = buildRegistry([judgedType('judge-widget'), judgeTypeDef('judge-widget')]);
    const engine = new Engine({
      registry,
      brain,
      store,
      memory: new NoopMemoryView(),
    });

    const goal = makeGoal({
      type: 'widget',
      intent: 'spike',
    });

    await engine.run(goal);

    expect(brain.capturedRubrics.length).toBeGreaterThanOrEqual(1);
    const rubric = brain.capturedRubrics[0]!;
    expect(rubric).toContain("The goal's intent is spike");
  });
});

describe('same artifact judged under spike vs production gets DIFFERENT rubric text', () => {
  it('spike and production intents produce rubrics that differ', async () => {
    const capturedSpikeRubrics: string[] = [];
    const capturedProdRubrics: string[] = [];

    const spikeBrain: Brain = {
      async decide() { throw new Error('not used'); },
      async produce() { return { value: textArtifact('artifact'), usage: ZERO_USAGE }; },
      async judge(_g, _a, rubric) {
        capturedSpikeRubrics.push(rubric);
        return { value: passVerdict(), usage: ZERO_USAGE };
      },
      async repair() { throw new Error('not used'); },
      async step(): Promise<StepOutput> { throw new Error('not used'); },
    };
    const prodBrain: Brain = {
      async decide() { throw new Error('not used'); },
      async produce() { return { value: textArtifact('artifact'), usage: ZERO_USAGE }; },
      async judge(_g, _a, rubric) {
        capturedProdRubrics.push(rubric);
        return { value: passVerdict(), usage: ZERO_USAGE };
      },
      async repair() { throw new Error('not used'); },
      async step(): Promise<StepOutput> { throw new Error('not used'); },
    };

    const registry = buildRegistry([judgedType('judge-widget'), judgeTypeDef('judge-widget')]);

    const spikeStore = new MemoryEventStore();
    const spikeEngine = new Engine({ registry, brain: spikeBrain, store: spikeStore, memory: new NoopMemoryView() });
    await spikeEngine.run(makeGoal({ type: 'widget', intent: 'spike' }));

    const prodStore = new MemoryEventStore();
    const prodEngine = new Engine({ registry, brain: prodBrain, store: prodStore, memory: new NoopMemoryView() });
    await prodEngine.run(makeGoal({ type: 'widget', intent: 'production' }));

    expect(capturedSpikeRubrics[0]).toBeDefined();
    expect(capturedProdRubrics[0]).toBeDefined();
    // The rubrics must differ — the intent line makes them distinct
    expect(capturedSpikeRubrics[0]).not.toBe(capturedProdRubrics[0]!);
    expect(capturedSpikeRubrics[0]).toContain('spike');
    expect(capturedProdRubrics[0]).toContain('production');
  });
});

describe('intent dial end-to-end: brain passes for spike, fails for production keyed off rubric', () => {
  it('spike goal passes; production goal fails when brain keys verdict off intent in rubric', async () => {
    // A scripted brain that reads the intent from the rubric and returns
    // pass for spike, fail for production — demonstrating the dial end-to-end.
    const intentDialBrain: Brain = {
      async decide() { throw new Error('not used'); },
      async produce() { return { value: textArtifact('output'), usage: ZERO_USAGE }; },
      async judge(_g, _a, rubric) {
        if (rubric.includes("intent is spike")) {
          return { value: { pass: true, findings: [] }, usage: ZERO_USAGE };
        }
        return {
          value: {
            pass: false,
            findings: [{ title: 'production bar not met', dimension: 'spec', severity: 'high', gating: true }],
            failureSignature: 'prod-bar',
          },
          usage: ZERO_USAGE,
        };
      },
      async repair() { throw new Error('not used'); },
      async step(): Promise<StepOutput> { throw new Error('not used'); },
    };

    const registry = buildRegistry([judgedType('judge-widget'), judgeTypeDef('judge-widget')]);

    // Spike run — should pass
    const spikeStore = new MemoryEventStore();
    const spikeEngine = new Engine({ registry, brain: intentDialBrain, store: spikeStore, memory: new NoopMemoryView() });
    const spikeReport = await spikeEngine.run(makeGoal({ type: 'widget', intent: 'spike' }));
    expect(spikeReport.blockers).toHaveLength(0);

    // Production run — should block (judge fails, escalates until exhausted)
    const prodStore = new MemoryEventStore();
    const prodEngine = new Engine({ registry, brain: intentDialBrain, store: prodStore, memory: new NoopMemoryView() });
    const prodReport = await prodEngine.run(makeGoal({
      type: 'widget',
      intent: 'production',
      budget: { attempts: 2, tokens: 100_000, toolCalls: 10, wallClockMs: 60_000 },
    }));
    expect(prodReport.blockers.length).toBeGreaterThan(0);
  });
});

// ── REAL-SKILL tests (GATING-1) ───────────────────────────────────────────────
// Drive enrichRubric through the actual skill files (critique.md, arbiter.md) and
// assert that the intent dial section reaches the judge rubric.

/** Build a registry from the full starter set. */
function realRegistry() {
  const defs = starterTypes();
  const map = new Map(defs.map((d) => [d.name, d]));
  return {
    get(name: string) {
      const def = map.get(name);
      if (!def) throw new Error(`Unknown type: ${name}`);
      return def;
    },
    has(name: string): boolean { return map.has(name); },
    names(): string[] { return [...map.keys()]; },
  };
}

/** A goal type whose judge is the given real judge type name. */
function realJudgedType(workerName: string, judgeTypeName: string) {
  return leafTypeDef({
    name: workerName,
    family: 'critique',  // must be a family with a real skill file
    judgeType: judgeTypeName,
    deterministic: [],
    grants: [],
  });
}

/** A brain that captures rubrics and always passes. */
function captureBrain(): Brain & { rubrics: string[] } {
  const rubrics: string[] = [];
  return {
    rubrics,
    async decide() { throw new Error('not used'); },
    async produce() { return { value: textArtifact('doc content'), usage: ZERO_USAGE }; },
    async judge(_g: Goal, _a: Artifact, rubric: string) {
      rubrics.push(rubric);
      return { value: { pass: true, findings: [] }, usage: ZERO_USAGE };
    },
    async repair() { throw new Error('not used'); },
    async step(): Promise<StepOutput> { throw new Error('not used'); },
  };
}

describe('REAL-SKILL: critique-doc enrichRubric includes intent dial section', () => {
  it('critique-doc rubric under intent:production contains "Mimicry bar"', async () => {
    _clearSkillCache();

    // Use the real starter registry (which has critique-doc registered as a
    // judge kind in the critique family) plus a worker type that names it.
    const registry = realRegistry();
    // We need a worker type that is not a judge kind but references critique-doc
    // as its judgeType. Add a synthetic worker alongside the starter types.
    const workerDef = leafTypeDef({
      name: 'write-doc-worker',
      kind: 'make',
      family: 'critique',
      judgeType: 'critique-doc',
      deterministic: [],
      grants: [],
    });
    const defs = [...starterTypes(), workerDef];
    const map = new Map(defs.map((d) => [d.name, d]));
    const mixedRegistry = {
      get(name: string) {
        const def = map.get(name);
        if (!def) throw new Error(`Unknown type: ${name}`);
        return def;
      },
      has(name: string): boolean { return map.has(name); },
      names(): string[] { return [...map.keys()]; },
    };

    const store = new MemoryEventStore();
    const brain = captureBrain();
    const engine = new Engine({ registry: mixedRegistry, brain, store, memory: new NoopMemoryView() });

    await engine.run(makeGoal({ type: 'write-doc-worker', intent: 'production' }));

    expect(brain.rubrics.length).toBeGreaterThanOrEqual(1);
    const rubric = brain.rubrics[0]!;
    // The intent dial section from critique.md must be present for production intent
    expect(rubric).toContain('Mimicry bar');
  });

  it('critique-doc rubric under intent:spike contains "Answers-the-question"', async () => {
    _clearSkillCache();

    const workerDef = leafTypeDef({
      name: 'write-doc-worker',
      kind: 'make',
      family: 'critique',
      judgeType: 'critique-doc',
      deterministic: [],
      grants: [],
    });
    const defs = [...starterTypes(), workerDef];
    const map = new Map(defs.map((d) => [d.name, d]));
    const mixedRegistry = {
      get(name: string) {
        const def = map.get(name);
        if (!def) throw new Error(`Unknown type: ${name}`);
        return def;
      },
      has(name: string): boolean { return map.has(name); },
      names(): string[] { return [...map.keys()]; },
    };

    const store = new MemoryEventStore();
    const brain = captureBrain();
    const engine = new Engine({ registry: mixedRegistry, brain, store, memory: new NoopMemoryView() });

    await engine.run(makeGoal({ type: 'write-doc-worker', intent: 'spike' }));

    expect(brain.rubrics.length).toBeGreaterThanOrEqual(1);
    const rubric = brain.rubrics[0]!;
    // The intent dial section from critique.md must be present for spike intent
    expect(rubric).toContain('Answers-the-question');
  });
});

describe('REAL-SKILL: judge-split enrichRubric includes arbiter structural-invariant protection', () => {
  it('judge-split rubric under intent:spike contains structural-invariants-never-waived text', async () => {
    _clearSkillCache();

    // Build a non-leaf root type that returns a split, and a leaf child type so the
    // recursion terminates. The split eval invokes judge-split via enrichRubric.
    const splitRootDef: import('../../src/contract/goal-type.js').GoalTypeDef = {
      name: 'split-root',
      kind: 'make',
      family: 'deliver',
      leafOnly: false,
      tier: { default: 'haiku', ladder: ['haiku', 'sonnet', 'opus'] },
      deterministic: [],
      judgeType: null,
      grants: [],
    };
    const leafChildDef: import('../../src/contract/goal-type.js').GoalTypeDef = {
      name: 'leaf-child',
      kind: 'make',
      family: 'build',
      leafOnly: true,
      tier: { default: 'haiku', ladder: ['haiku', 'sonnet', 'opus'] },
      deterministic: [],
      judgeType: null,
      grants: [],
    };
    const defs = [...starterTypes(), splitRootDef, leafChildDef];
    const map = new Map(defs.map((d) => [d.name, d]));
    const mixedRegistry = {
      get(name: string) {
        const def = map.get(name);
        if (!def) throw new Error(`Unknown type: ${name}`);
        return def;
      },
      has(name: string): boolean { return map.has(name); },
      names(): string[] { return [...map.keys()]; },
    };

    const capturedJudgeSplitRubrics: string[] = [];

    // Brain that decides to split (root only) and produces for leaves
    const captureSplitBrain: Brain = {
      async decide(_goal: Goal) {
        // Always split into one leaf child — the leaf will produce not split
        return {
          value: {
            kind: 'split' as const,
            children: [
              {
                localId: 'c1',
                type: 'leaf-child',
                title: 'child 1',
                spec: {},
                scope: [],
                budgetShare: 1,
                dependsOn: [],
              },
            ],
          },
          usage: ZERO_USAGE,
        };
      },
      async produce() { return { value: textArtifact('leaf result'), usage: ZERO_USAGE }; },
      async judge(_g: Goal, _a: Artifact, rubric: string) {
        capturedJudgeSplitRubrics.push(rubric);
        return { value: { pass: true, findings: [] }, usage: ZERO_USAGE };
      },
      async repair() { throw new Error('not used'); },
      async step(): Promise<StepOutput> { throw new Error('not used'); },
    };

    const store = new MemoryEventStore();
    const engine = new Engine({ registry: mixedRegistry, brain: captureSplitBrain, store, memory: new NoopMemoryView() });

    await engine.run(makeGoal({ type: 'split-root', intent: 'spike' }));

    // enrichRubric for judge-split should have been called at least once during split eval
    expect(capturedJudgeSplitRubrics.length).toBeGreaterThanOrEqual(1);
    const rubric = capturedJudgeSplitRubrics[0]!;
    // The arbiter's intent dial section states structural invariants are 'never waived by intent'
    expect(rubric).toContain('never waived by intent');
  });
});
