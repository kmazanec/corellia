/**
 * Integration-judge capture tests (F-65 A11).
 *
 * At the integration-judge site in runSplit, the engine now appends:
 *   - a `judge-verdict` event (judgeType: 'judge-integration')
 *   - a `golden-candidate` event
 * on every NON-SCRIPTED run (goldenCapture: true). On scripted runs
 * (goldenCapture: false) both are absent — ADR-024's non-scripted filter.
 *
 * The goldenCandidates projection must include these candidates.
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
  failVerdict,
} from './stubs.js';
import { goldenCandidates } from '../../src/eventlog/projections.js';
import type { ChildPlan } from '../../src/contract/decision.js';

// ── Helpers ────────────────────────────────────────────────────────────────

function splitRegistry() {
  return buildRegistry([
    nonLeafTypeDef({ name: 'splitter', judgeType: null }),
    leafTypeDef({ name: 'leaf', judgeType: null }),
    leafTypeDef({ name: 'judge-integration', kind: 'judge', leafOnly: true, judgeType: null }),
  ]);
}

const childPlan: ChildPlan = {
  localId: 'child-a',
  type: 'leaf',
  title: 'child A',
  spec: {},
  dependsOn: [],
  scope: [],
  budgetShare: 1.0,
};

// ── Non-scripted runs (goldenCapture: true) ────────────────────────────────

describe('integration-capture: non-scripted run (goldenCapture: true)', () => {
  it('appends judge-verdict with judgeType=judge-integration (F-65 A11)', async () => {
    const store = new MemoryEventStore();
    const brain = new ScriptedBrain()
      .queueDecide({ kind: 'split', children: [childPlan] })
      .queueProduce(textArtifact('child-artifact'))
      .queueJudge(passVerdict());

    const engine = new Engine({
      registry: splitRegistry(),
      brain,
      store,
      memory: new NoopMemoryView(),
      goldenCapture: true,
    });

    await engine.run(makeGoal({ type: 'splitter' }));

    const events = await store.list();
    const jv = events.filter(
      (e) => e.type === 'judge-verdict' && (e as { judgeType?: string }).judgeType === 'judge-integration',
    );
    expect(jv).toHaveLength(1);
  });

  it('appends golden-candidate for judge-integration (F-65 A11)', async () => {
    const store = new MemoryEventStore();
    const brain = new ScriptedBrain()
      .queueDecide({ kind: 'split', children: [childPlan] })
      .queueProduce(textArtifact('child-artifact'))
      .queueJudge(passVerdict());

    const engine = new Engine({
      registry: splitRegistry(),
      brain,
      store,
      memory: new NoopMemoryView(),
      goldenCapture: true,
    });

    await engine.run(makeGoal({ type: 'splitter' }));

    const events = await store.list();
    const gc = events.filter((e) => e.type === 'golden-candidate');
    expect(gc).toHaveLength(1);
  });

  it('goldenCandidates projection includes the judge-integration candidate (F-65 A11)', async () => {
    const store = new MemoryEventStore();
    const brain = new ScriptedBrain()
      .queueDecide({ kind: 'split', children: [childPlan] })
      .queueProduce(textArtifact('child-artifact'))
      .queueJudge(passVerdict());

    const engine = new Engine({
      registry: splitRegistry(),
      brain,
      store,
      memory: new NoopMemoryView(),
      goldenCapture: true,
    });

    await engine.run(makeGoal({ type: 'splitter' }));

    const events = await store.list();
    const candidates = goldenCandidates(events);
    expect(candidates['judge-integration']).toBeDefined();
    expect(candidates['judge-integration']!).toHaveLength(1);
    expect(candidates['judge-integration']![0]!.verdictPass).toBe(true);
  });

  it('verdictPass is false when judge-integration fails (F-65 A11)', async () => {
    const store = new MemoryEventStore();
    // An ESCALATED integration finding skips the repair rung (ADR-047) and blocks
    // directly, so exactly one integration judge call — and one golden-candidate —
    // is captured. A non-escalated fail would re-judge after repair, capturing two.
    const brain = new ScriptedBrain()
      .queueDecide({ kind: 'split', children: [childPlan] })
      .queueProduce(textArtifact('child-artifact'))
      .queueJudge(failVerdict('integration failed', undefined, true));

    const engine = new Engine({
      registry: splitRegistry(),
      brain,
      store,
      memory: new NoopMemoryView(),
      goldenCapture: true,
    });

    await engine.run(makeGoal({ type: 'splitter' }));

    const events = await store.list();
    const gc = events.filter((e) => e.type === 'golden-candidate') as
      Array<{ verdictPass: boolean }>;
    expect(gc).toHaveLength(1);
    expect(gc[0]!.verdictPass).toBe(false);
  });
});

// ── Scripted runs (goldenCapture: false) ──────────────────────────────────

describe('integration-capture: scripted run (goldenCapture: false)', () => {
  it('NO judge-verdict for judge-integration on scripted runs (F-65 A11)', async () => {
    const store = new MemoryEventStore();
    const brain = new ScriptedBrain()
      .queueDecide({ kind: 'split', children: [childPlan] })
      .queueProduce(textArtifact('child-artifact'))
      .queueJudge(passVerdict());

    const engine = new Engine({
      registry: splitRegistry(),
      brain,
      store,
      memory: new NoopMemoryView(),
      goldenCapture: false, // scripted
    });

    await engine.run(makeGoal({ type: 'splitter' }));

    const events = await store.list();
    const jv = events.filter(
      (e) => e.type === 'judge-verdict' && (e as { judgeType?: string }).judgeType === 'judge-integration',
    );
    expect(jv).toHaveLength(0);
  });

  it('NO golden-candidate for judge-integration on scripted runs (F-65 A11)', async () => {
    const store = new MemoryEventStore();
    const brain = new ScriptedBrain()
      .queueDecide({ kind: 'split', children: [childPlan] })
      .queueProduce(textArtifact('child-artifact'))
      .queueJudge(passVerdict());

    const engine = new Engine({
      registry: splitRegistry(),
      brain,
      store,
      memory: new NoopMemoryView(),
      goldenCapture: false,
    });

    await engine.run(makeGoal({ type: 'splitter' }));

    const events = await store.list();
    const gc = events.filter((e) => e.type === 'golden-candidate');
    expect(gc).toHaveLength(0);
  });

  it('goldenCandidates projection has no judge-integration entry on scripted runs (F-65 A11)', async () => {
    const store = new MemoryEventStore();
    const brain = new ScriptedBrain()
      .queueDecide({ kind: 'split', children: [childPlan] })
      .queueProduce(textArtifact('child-artifact'))
      .queueJudge(passVerdict());

    const engine = new Engine({
      registry: splitRegistry(),
      brain,
      store,
      memory: new NoopMemoryView(),
      goldenCapture: false,
    });

    await engine.run(makeGoal({ type: 'splitter' }));

    const events = await store.list();
    const candidates = goldenCandidates(events);
    expect(candidates['judge-integration']).toBeUndefined();
  });
});

// ── Guard: judge-integration absent from registry → no events ─────────────

describe('integration-capture: guard — no judge-integration in registry', () => {
  it('no judge-verdict / golden-candidate when registry has no judge-integration', async () => {
    const store = new MemoryEventStore();
    const noIntegRegistry = buildRegistry([
      nonLeafTypeDef({ name: 'splitter', judgeType: null }),
      leafTypeDef({ name: 'leaf', judgeType: null }),
      // no judge-integration
    ]);

    const brain = new ScriptedBrain()
      .queueDecide({ kind: 'split', children: [childPlan] })
      .queueProduce(textArtifact('child-artifact'));

    const engine = new Engine({
      registry: noIntegRegistry,
      brain,
      store,
      memory: new NoopMemoryView(),
      goldenCapture: true,
    });

    await engine.run(makeGoal({ type: 'splitter' }));

    const events = await store.list();
    const jv = events.filter(
      (e) => e.type === 'judge-verdict' && (e as { judgeType?: string }).judgeType === 'judge-integration',
    );
    const gc = events.filter((e) => e.type === 'golden-candidate');
    expect(jv).toHaveLength(0);
    expect(gc).toHaveLength(0);
  });
});
