/**
 * Tests for the judge skill + intent dial wiring (F-56 chunk 2).
 *
 * At every brain.judge call site the rubric is enriched with:
 *   (a) the judge type's family skill section + preamble
 *   (b) an intent line: "The goal's intent is <intent>. Apply the bar that intent demands per the skill."
 *
 * Behavioral tests verify:
 *   1. The rubric captured by the scripted brain contains the intent line.
 *   2. The same artifact judged under intent:spike vs intent:production gets
 *      DIFFERENT rubric text (the dial is in the rubric).
 *   3. A scripted brain that returns pass-for-spike / fail-for-production keyed
 *      off the rubric text demonstrates the dial end-to-end.
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
