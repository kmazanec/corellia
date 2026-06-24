/**
 * Deterministic engine tests for the milestone loop (ADR-031/032).
 *
 * Step 5: runMilestone single-round (loop OFF) — an iterative type runs exactly
 * one round, mints + persists criteria, assesses against them, runs
 * judge-acceptance, and emits. DONE when scripts AND judge pass; an honest
 * partial (cumulative artifact + unmet criteria as blockers) otherwise.
 *
 * Step 6 tests (the four-guard halt, converge + stuck) live below.
 *
 * Zero live API: a ScriptedBrain drives decide/produce/judge, exactly as the
 * existing engine tests do. No sandbox → commitRound is a no-op and file-anchor
 * criteria read the round's cumulative merged artifact.
 */

import { describe, it, expect } from 'vitest';
import { Engine } from '../../src/engine/engine.js';
import {
  MemoryEventStore,
  NoopMemoryView,
  buildRegistry,
  leafTypeDef,
  ScriptedBrain,
  makeGoal,
  textArtifact,
  filesArtifact,
  passVerdict,
  failVerdict,
} from './stubs.js';
import type { ChildPlan } from '../../src/contract/decision.js';
import type { GoalTypeDef } from '../../src/contract/goal-type.js';
import type { FactoryEvent } from '../../src/contract/events.js';

// ── shared fixtures ─────────────────────────────────────────────────────────

/** An iterative deliver-style root type with the milestone loop turned on. */
function deliverIterativeType(maxRounds = 50): GoalTypeDef {
  return {
    name: 'deliver-intent',
    kind: 'make',
    family: 'test',
    leafOnly: false,
    tier: { default: 'high', ladder: ['high'] },
    deterministic: [],
    judgeType: 'judge-integration',
    grants: [],
    iterative: { maxRounds, acceptanceJudge: 'judge-acceptance' },
  };
}

/** A registry with the iterative root + the criteria/build leaves + both judges. */
function milestoneRegistry(rootMaxRounds = 50) {
  return buildRegistry([
    deliverIterativeType(rootMaxRounds),
    leafTypeDef({ name: 'author-acceptance-criteria', kind: 'make', judgeType: null }),
    leafTypeDef({ name: 'build', kind: 'make', judgeType: null }),
    leafTypeDef({ name: 'judge-integration', kind: 'judge', judgeType: null }),
    leafTypeDef({ name: 'judge-acceptance', kind: 'judge', judgeType: null }),
  ]);
}

/** The criteria artifact: a checklist that asserts src/x.ts contains an anchor. */
function criteriaArtifact(anchor = 'DONE') {
  return textArtifact(
    JSON.stringify({
      criteria: [{ id: 'c1', claim: 'the build is done', check: { file: 'src/x.ts', anchor } }],
    }),
  );
}

/** Round 0's split: mint criteria, then build (build dependsOn criteria). */
function round0Children(): ChildPlan[] {
  return [
    {
      localId: 'crit',
      type: 'author-acceptance-criteria',
      title: 'mint criteria',
      spec: {},
      dependsOn: [],
      scope: [],
      budgetShare: 0.3,
    },
    {
      localId: 'b',
      type: 'build',
      title: 'build it',
      spec: {},
      dependsOn: ['crit'],
      scope: [],
      budgetShare: 0.5,
    },
  ];
}

// ── Step 5: single round, DONE ──────────────────────────────────────────────

describe('runMilestone — single round (loop OFF)', () => {
  it('runs ONE round, mints criteria, and is DONE when scripts AND judge pass', async () => {
    const store = new MemoryEventStore();
    const brain = new ScriptedBrain()
      .queueDecide({ kind: 'split', children: round0Children() })
      .queueProduce(criteriaArtifact('DONE')) // crit child
      .queueProduce(filesArtifact([{ path: 'src/x.ts', content: '// DONE\n' }])) // build child
      .queueJudge(passVerdict()) // judge-integration (in runRound)
      .queueJudge(passVerdict()); // judge-acceptance (in assessRound)

    const registry = milestoneRegistry();
    const engine = new Engine({ registry, brain, store, memory: new NoopMemoryView() });
    const report = await engine.run(makeGoal({ type: 'deliver-intent', scope: ['src/'] }));

    // Exactly one round.
    const started = await store.list({ type: 'round-started' });
    expect(started).toHaveLength(1);
    expect((started[0] as Extract<FactoryEvent, { type: 'round-started' }>).round).toBe(0);

    const assessed = (await store.list({ type: 'round-assessed' })) as Extract<
      FactoryEvent,
      { type: 'round-assessed' }
    >[];
    expect(assessed).toHaveLength(1);
    expect(assessed[0]!.passingCount).toBe(1);
    expect(assessed[0]!.criteriaTotal).toBe(1);
    expect(assessed[0]!.outcome).toBe('done');

    // DONE → clean report (no unmet blockers from the loop).
    expect(report.blockers).toHaveLength(0);
    expect(report.artifact?.kind).toBe('files');
  });

  it('emits an honest partial (cumulative artifact + unmet criteria as blockers) when scripts fail', async () => {
    const store = new MemoryEventStore();
    const brain = new ScriptedBrain()
      .queueDecide({ kind: 'split', children: round0Children() })
      .queueProduce(criteriaArtifact('DONE')) // criteria wants 'DONE'
      .queueProduce(filesArtifact([{ path: 'src/x.ts', content: '// not finished\n' }])) // missing anchor
      .queueJudge(passVerdict()) // judge-integration
      .queueJudge(passVerdict()); // judge-acceptance (irrelevant: scripts already failed)

    const registry = milestoneRegistry();
    const engine = new Engine({ registry, brain, store, memory: new NoopMemoryView() });
    const report = await engine.run(makeGoal({ type: 'deliver-intent', scope: ['src/'] }));

    const assessed = (await store.list({ type: 'round-assessed' })) as Extract<
      FactoryEvent,
      { type: 'round-assessed' }
    >[];
    expect(assessed).toHaveLength(1);
    expect(assessed[0]!.passingCount).toBe(0);
    expect(assessed[0]!.outcome).toBe('continue'); // not DONE (single round → emits partial)

    // Honest partial: the cumulative green artifact is emitted, unmet criteria as blockers.
    expect(report.artifact?.kind).toBe('files');
    expect(report.blockers.some((b) => /not yet met/i.test(b))).toBe(true);
  });

  it('is NOT done when scripts pass but judge-acceptance fails (scripts AND judge gate)', async () => {
    const store = new MemoryEventStore();
    const brain = new ScriptedBrain()
      .queueDecide({ kind: 'split', children: round0Children() })
      .queueProduce(criteriaArtifact('DONE'))
      .queueProduce(filesArtifact([{ path: 'src/x.ts', content: '// DONE\n' }]))
      .queueJudge(passVerdict()) // judge-integration
      .queueJudge(failVerdict('shoddy', 'tighten it')); // judge-acceptance refuses

    const registry = milestoneRegistry();
    const engine = new Engine({ registry, brain, store, memory: new NoopMemoryView() });
    const report = await engine.run(makeGoal({ type: 'deliver-intent', scope: ['src/'] }));

    const assessed = (await store.list({ type: 'round-assessed' })) as Extract<
      FactoryEvent,
      { type: 'round-assessed' }
    >[];
    expect(assessed[0]!.passingCount).toBe(1); // scripts green
    expect(assessed[0]!.judgeVerdict.pass).toBe(false); // judge refused
    expect(assessed[0]!.outcome).toBe('continue'); // NOT done
    expect(report.blockers.some((b) => /judge-acceptance did not pass/i.test(b))).toBe(true);
  });

  it('blocks before looping when the effective maxRounds override is 0', async () => {
    const store = new MemoryEventStore();
    const brain = new ScriptedBrain().queueDecide({ kind: 'split', children: round0Children() });

    const registry = milestoneRegistry();
    const engine = new Engine({ registry, brain, store, memory: new NoopMemoryView() });
    const report = await engine.run(
      makeGoal({ type: 'deliver-intent', scope: ['src/'], maxRounds: 0 }),
    );

    expect(report.blockers.some((b) => /maxRounds must be an integer >= 1/i.test(b))).toBe(true);
    // No round ran.
    expect(await store.list({ type: 'round-started' })).toHaveLength(0);
  });
});
