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

describe('runMilestone — single-round assessment', () => {
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

    // maxRounds = 1 pins this to a single round so it exercises the assessment +
    // partial path without looping into a re-decide.
    const registry = milestoneRegistry(1);
    const engine = new Engine({ registry, brain, store, memory: new NoopMemoryView() });
    const report = await engine.run(makeGoal({ type: 'deliver-intent', scope: ['src/'] }));

    const assessed = (await store.list({ type: 'round-assessed' })) as Extract<
      FactoryEvent,
      { type: 'round-assessed' }
    >[];
    expect(assessed).toHaveLength(1);
    expect(assessed[0]!.passingCount).toBe(0);
    expect(assessed[0]!.outcome).toBe('halt-max-rounds'); // single round capped → partial

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

    // maxRounds = 1 pins this to a single round: scripts pass but the judge gate
    // blocks DONE, so it halts-max-rounds with a partial (decision 1).
    const registry = milestoneRegistry(1);
    const engine = new Engine({ registry, brain, store, memory: new NoopMemoryView() });
    const report = await engine.run(makeGoal({ type: 'deliver-intent', scope: ['src/'] }));

    const assessed = (await store.list({ type: 'round-assessed' })) as Extract<
      FactoryEvent,
      { type: 'round-assessed' }
    >[];
    expect(assessed[0]!.passingCount).toBe(1); // scripts green
    expect(assessed[0]!.judgeVerdict.pass).toBe(false); // judge refused
    expect(assessed[0]!.outcome).toBe('halt-max-rounds'); // NOT done (judge gate)
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

// ── Step 6: the four-guard halt — converge + stuck ──────────────────────────

/** Round N>0's split: a single fix child (criteria are frozen, not re-authored). */
function fixChildren(): ChildPlan[] {
  return [
    {
      localId: 'fix',
      type: 'build',
      title: 'fix the gap',
      spec: {},
      dependsOn: [],
      scope: [],
      budgetShare: 0.5,
    },
  ];
}

describe('runMilestone — four-guard halt (loop ON)', () => {
  it('a 2-round goal converges: round 0 partial, round 1 re-decides and is DONE', async () => {
    const store = new MemoryEventStore();
    const brain = new ScriptedBrain()
      // ROUND 0
      .queueDecide({ kind: 'split', children: round0Children() })
      .queueProduce(criteriaArtifact('DONE')) // crit
      .queueProduce(filesArtifact([{ path: 'src/x.ts', content: '// WIP\n' }])) // build: no anchor
      .queueJudge(passVerdict()) // judge-integration r0
      .queueJudge(failVerdict('not yet', 'add DONE')) // judge-acceptance r0 (scripts also red)
      // ROUND 1 — re-decide → fix
      .queueDecide({ kind: 'split', children: fixChildren() })
      .queueProduce(filesArtifact([{ path: 'src/x.ts', content: '// DONE\n' }])) // fix: anchor present
      .queueJudge(passVerdict()) // judge-integration r1
      .queueJudge(passVerdict()); // judge-acceptance r1 → DONE

    const registry = milestoneRegistry();
    const engine = new Engine({ registry, brain, store, memory: new NoopMemoryView() });
    const report = await engine.run(makeGoal({ type: 'deliver-intent', scope: ['src/'] }));

    const assessed = (await store.list({ type: 'round-assessed' })) as Extract<
      FactoryEvent,
      { type: 'round-assessed' }
    >[];
    expect(assessed.map((a) => a.round)).toEqual([0, 1]);
    expect(assessed[0]!.outcome).toBe('continue');
    expect(assessed[0]!.passingCount).toBe(0);
    expect(assessed[1]!.outcome).toBe('done');
    expect(assessed[1]!.passingCount).toBe(1);

    // Two rounds ran; the converged report is clean.
    expect(await store.list({ type: 'round-started' })).toHaveLength(2);
    expect(report.blockers).toHaveLength(0);
  });

  it('a stuck goal halts partial on the no-progress guard (one grace round, then halt)', async () => {
    const store = new MemoryEventStore();
    const brain = new ScriptedBrain()
      // ROUND 0
      .queueDecide({ kind: 'split', children: round0Children() })
      .queueProduce(criteriaArtifact('DONE'))
      .queueProduce(filesArtifact([{ path: 'src/x.ts', content: '// stuck\n' }]))
      .queueJudge(passVerdict()) // integration r0
      .queueJudge(failVerdict('no')) // acceptance r0
      // ROUND 1 — grace round, still no progress
      .queueDecide({ kind: 'split', children: fixChildren() })
      .queueProduce(filesArtifact([{ path: 'src/x.ts', content: '// still stuck\n' }]))
      .queueJudge(passVerdict())
      .queueJudge(failVerdict('no'))
      // ROUND 2 — second consecutive flat → halt-no-progress
      .queueDecide({ kind: 'split', children: fixChildren() })
      .queueProduce(filesArtifact([{ path: 'src/x.ts', content: '// STILL stuck\n' }]))
      .queueJudge(passVerdict())
      .queueJudge(failVerdict('no'));

    const registry = milestoneRegistry();
    const engine = new Engine({ registry, brain, store, memory: new NoopMemoryView() });
    const report = await engine.run(makeGoal({ type: 'deliver-intent', scope: ['src/'] }));

    const assessed = (await store.list({ type: 'round-assessed' })) as Extract<
      FactoryEvent,
      { type: 'round-assessed' }
    >[];
    // Round 0 (0 > -1 baseline) continue; round 1 flat→grace continue; round 2 flat→halt.
    expect(assessed.map((a) => a.outcome)).toEqual(['continue', 'continue', 'halt-no-progress']);
    expect(assessed.every((a) => a.passingCount === 0)).toBe(true);

    // Honest partial: cumulative artifact + unmet criteria as blockers.
    expect(report.artifact?.kind).toBe('files');
    expect(report.blockers.some((b) => /not yet met/i.test(b))).toBe(true);
  });

  it('halts on the max-rounds backstop when progress keeps increasing but the cap is hit', async () => {
    // maxRounds override = 1: round 0 makes progress (0→but not done) and the cap
    // forbids a round 1, so it halts-max-rounds with a partial.
    const store = new MemoryEventStore();
    const brain = new ScriptedBrain()
      .queueDecide({ kind: 'split', children: round0Children() })
      .queueProduce(criteriaArtifact('DONE'))
      .queueProduce(filesArtifact([{ path: 'src/x.ts', content: '// WIP no anchor\n' }]))
      .queueJudge(passVerdict())
      .queueJudge(failVerdict('no'));

    const registry = milestoneRegistry(1); // maxRounds = 1
    const engine = new Engine({ registry, brain, store, memory: new NoopMemoryView() });
    const report = await engine.run(makeGoal({ type: 'deliver-intent', scope: ['src/'] }));

    const assessed = (await store.list({ type: 'round-assessed' })) as Extract<
      FactoryEvent,
      { type: 'round-assessed' }
    >[];
    expect(assessed).toHaveLength(1);
    expect(assessed[0]!.outcome).toBe('halt-max-rounds');
    expect(report.blockers.some((b) => /not yet met/i.test(b))).toBe(true);
  });
});
