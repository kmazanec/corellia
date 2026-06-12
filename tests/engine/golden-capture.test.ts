/**
 * Tests for golden capture .
 *
 * When goldenCapture: true is set on EngineOptions, a `golden-candidate` event
 * is appended to the store at every judge-verdict emission. The event carries:
 *   - artifactDigest  — sha1 of the artifact text
 *   - rubricDigest    — sha1 of the enriched rubric
 *   - verdictPass
 *   - tier
 *   - model (optional, from brain config if reachable)
 *
 * When goldenCapture is false (default), NO golden-candidate events are emitted.
 */

import { describe, it, expect } from 'vitest';
import { Engine } from '../../src/engine/engine.js';
import {
  MemoryEventStore,
  NoopMemoryView,
  buildRegistry,
  leafTypeDef,
  nonLeafTypeDef,
  ScriptedBrain,
  makeGoal,
  textArtifact,
  passVerdict,
} from './stubs.js';
import { ZERO_USAGE } from '../../src/contract/goal.js';
import type { Brain, StepOutput, StepTranscript } from '../../src/contract/brain.js';
import type { Goal } from '../../src/contract/goal.js';
import type { Artifact } from '../../src/contract/report.js';
import type { ToolDef, BrainContext } from '../../src/contract/brain.js';
import type { ChildPlan } from '../../src/contract/decision.js';

function simpleBrain(): Brain {
  return {
    async decide() { throw new Error('not used'); },
    async produce() { return { value: textArtifact('out'), usage: ZERO_USAGE }; },
    async judge() { return { value: passVerdict(), usage: ZERO_USAGE }; },
    async repair() { throw new Error('not used'); },
    async step(): Promise<StepOutput> { throw new Error('not used'); },
  };
}

function judgedRegistry() {
  return buildRegistry([
    leafTypeDef({ name: 'impl', judgeType: 'judge-impl', deterministic: [] }),
    leafTypeDef({ name: 'judge-impl', kind: 'judge', judgeType: null }),
  ]);
}

describe('golden capture: goldenCapture flag controls emission', () => {
  it('NO golden-candidate events when goldenCapture is false (default)', async () => {
    const store = new MemoryEventStore();
    const engine = new Engine({
      registry: judgedRegistry(),
      brain: simpleBrain(),
      store,
      memory: new NoopMemoryView(),
      // goldenCapture NOT set — defaults to false
    });

    await engine.run(makeGoal({ type: 'impl' }));

    const goldenEvents = (await store.list()).filter((e) => e.type === 'golden-candidate');
    expect(goldenEvents).toHaveLength(0);
  });

  it('golden-candidate events ARE emitted when goldenCapture is true', async () => {
    const store = new MemoryEventStore();
    const engine = new Engine({
      registry: judgedRegistry(),
      brain: simpleBrain(),
      store,
      memory: new NoopMemoryView(),
      goldenCapture: true,
    });

    await engine.run(makeGoal({ type: 'impl' }));

    const goldenEvents = (await store.list()).filter((e) => e.type === 'golden-candidate');
    expect(goldenEvents).toHaveLength(1);
  });

  it('golden-candidate carries sha1 digests (40-char hex) for artifact and rubric', async () => {
    const store = new MemoryEventStore();
    const engine = new Engine({
      registry: judgedRegistry(),
      brain: simpleBrain(),
      store,
      memory: new NoopMemoryView(),
      goldenCapture: true,
    });

    await engine.run(makeGoal({ type: 'impl' }));

    const gc = (await store.list()).find((e) => e.type === 'golden-candidate') as
      { artifactDigest: string; rubricDigest: string; verdictPass: boolean } | undefined;
    expect(gc).toBeDefined();
    expect(gc!.artifactDigest).toHaveLength(40);
    expect(gc!.rubricDigest).toHaveLength(40);
    expect(gc!.verdictPass).toBe(true);
  });

  it('verdictPass reflects the judge verdict (false for a failing judge)', async () => {
    const store = new MemoryEventStore();
    const failingBrain: Brain = {
      async decide() { throw new Error('not used'); },
      async produce() { return { value: textArtifact('out'), usage: ZERO_USAGE }; },
      // First two judge calls fail; third passes to let the run complete
      async judge(_g, _a, _r) {
        return {
          value: { pass: false, findings: [{ title: 'bad', dimension: 'spec', severity: 'high', gating: true }], failureSignature: 'sig' },
          usage: ZERO_USAGE,
        };
      },
      async repair() { return { value: textArtifact('repaired'), usage: ZERO_USAGE }; },
      async step(): Promise<StepOutput> { throw new Error('not used'); },
    };

    const engine = new Engine({
      registry: judgedRegistry(),
      brain: failingBrain,
      store,
      memory: new NoopMemoryView(),
      goldenCapture: true,
      // Small budget so it doesn't loop forever
    });

    await engine.run(makeGoal({ type: 'impl', budget: { attempts: 2, tokens: 50_000, toolCalls: 0, wallClockMs: 60_000 } }));

    const goldenEvents = (await store.list()).filter((e) => e.type === 'golden-candidate') as
      Array<{ verdictPass: boolean }>;
    // All captured events should have verdictPass: false since brain always fails
    expect(goldenEvents.length).toBeGreaterThanOrEqual(1);
    expect(goldenEvents.every((e) => e.verdictPass === false)).toBe(true);
  });

  it('distinct artifact texts yield distinct artifactDigests', async () => {
    // Run two separate engines with different produce results; digests differ
    async function runAndGetDigest(artifactText: string): Promise<string> {
      const store = new MemoryEventStore();
      const brain: Brain = {
        async decide() { throw new Error('not used'); },
        async produce() { return { value: textArtifact(artifactText), usage: ZERO_USAGE }; },
        async judge() { return { value: passVerdict(), usage: ZERO_USAGE }; },
        async repair() { throw new Error('not used'); },
        async step(): Promise<StepOutput> { throw new Error('not used'); },
      };
      const engine = new Engine({
        registry: judgedRegistry(),
        brain,
        store,
        memory: new NoopMemoryView(),
        goldenCapture: true,
      });
      await engine.run(makeGoal({ type: 'impl' }));
      const gc = (await store.list()).find((e) => e.type === 'golden-candidate') as
        { artifactDigest: string } | undefined;
      return gc!.artifactDigest;
    }

    const d1 = await runAndGetDigest('artifact-alpha');
    const d2 = await runAndGetDigest('artifact-beta');
    expect(d1).not.toBe(d2);
  });
});

describe('golden capture: integration-judge site (A11)', () => {
  it('goldenCapture:true emits judge-verdict + golden-candidate for judge-integration (F-65 A11)', async () => {
    // A11 wires the integration-judge site to emit judge-verdict and golden-candidate
    // on non-scripted (goldenCapture:true) runs so the flywheel captures them.
    const store = new MemoryEventStore();

    const childA: ChildPlan = {
      localId: 'a',
      type: 'leaf',
      title: 'child A',
      spec: {},
      dependsOn: [],
      scope: [],
      budgetShare: 1.0,
    };

    const registry = buildRegistry([
      nonLeafTypeDef({ name: 'splitter', judgeType: null }),
      leafTypeDef({ name: 'leaf', judgeType: null }),
      leafTypeDef({ name: 'judge-integration', leafOnly: true, judgeType: null }),
    ]);

    const brain = new ScriptedBrain()
      .queueDecide({ kind: 'split', children: [childA] })
      .queueProduce(textArtifact('child output'))
      .queueJudge(passVerdict()); // judge-integration passes

    const engine = new Engine({
      registry,
      brain,
      store,
      memory: new NoopMemoryView(),
      goldenCapture: true,
    });

    await engine.run(makeGoal({ type: 'splitter' }));

    const goldenEvents = (await store.list()).filter((e) => e.type === 'golden-candidate');
    const jvEvents = (await store.list()).filter(
      (e) => e.type === 'judge-verdict' && (e as { judgeType?: string }).judgeType === 'judge-integration',
    );
    // A11: both emitted on non-scripted runs
    expect(goldenEvents).toHaveLength(1);
    expect(jvEvents).toHaveLength(1);
  });

  it('goldenCapture:false emits NO judge-verdict / golden-candidate for judge-integration (F-65 A11)', async () => {
    // On scripted runs (goldenCapture:false), the integration-judge events are absent.
    const store = new MemoryEventStore();

    const childA: ChildPlan = {
      localId: 'a',
      type: 'leaf',
      title: 'child A',
      spec: {},
      dependsOn: [],
      scope: [],
      budgetShare: 1.0,
    };

    const registry = buildRegistry([
      nonLeafTypeDef({ name: 'splitter', judgeType: null }),
      leafTypeDef({ name: 'leaf', judgeType: null }),
      leafTypeDef({ name: 'judge-integration', leafOnly: true, judgeType: null }),
    ]);

    const brain = new ScriptedBrain()
      .queueDecide({ kind: 'split', children: [childA] })
      .queueProduce(textArtifact('child output'))
      .queueJudge(passVerdict()); // judge-integration passes

    const engine = new Engine({
      registry,
      brain,
      store,
      memory: new NoopMemoryView(),
      goldenCapture: false, // scripted run
    });

    await engine.run(makeGoal({ type: 'splitter' }));

    const goldenEvents = (await store.list()).filter((e) => e.type === 'golden-candidate');
    const jvEvents = (await store.list()).filter(
      (e) => e.type === 'judge-verdict' && (e as { judgeType?: string }).judgeType === 'judge-integration',
    );
    // Scripted run: both absent
    expect(goldenEvents).toHaveLength(0);
    expect(jvEvents).toHaveLength(0);
  });
});
