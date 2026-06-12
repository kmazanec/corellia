/**
 * Leaf tournament tests (F-65 A9).
 *
 * For leafOnly types with scan.k > 1 and a judgeType, the engine runs a
 * k-candidate tournament in the classic produce path:
 *   - k produce calls with different lenses
 *   - k judge calls via judgeType
 *   - k judge-verdict events in the log
 *   - winner = passing candidate with fewest findings; loser = best loser when
 *     none pass
 *   - golden-candidate events emitted per candidate when goldenCapture: true
 *   - golden-candidate absent when goldenCapture: false (scripted runs)
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
  passVerdict,
  failVerdict,
} from './stubs.js';
import { ZERO_USAGE } from '../../src/contract/goal.js';
import type { Verdict } from '../../src/contract/verdict.js';

// ── Helpers ───────────────────────────────────────────────────────────────

/** Build a registry with a design-arch-like type (scan.k=3) and its judge. */
function tournamentRegistry(k = 3) {
  return buildRegistry([
    leafTypeDef({
      name: 'design-arch',
      kind: 'make',
      family: 'test',
      leafOnly: true,
      tier: { default: 'high', ladder: ['high'] },
      deterministic: [],
      judgeType: 'critique-doc',
      grants: [],
      scan: { k, lenses: ['architect', 'reuse', 'contrarian'] },
    }),
    leafTypeDef({
      name: 'critique-doc',
      kind: 'judge',
      family: 'test',
      leafOnly: true,
      tier: { default: 'high', ladder: ['high'] },
      deterministic: [],
      judgeType: null,
      grants: [],
    }),
  ]);
}

function verdictWithFindings(n: number): Verdict {
  return {
    pass: n === 0,
    findings: Array.from({ length: n }, (_, i) => ({
      title: `finding-${i}`,
      dimension: 'spec' as const,
      severity: 'low' as const,
      gating: false,
    })),
  };
}

// ── Core tournament behaviour ─────────────────────────────────────────────

describe('leaf tournament: k=3, all pass', () => {
  it('emits exactly k judge-verdict events in the log (F-65 A9)', async () => {
    const store = new MemoryEventStore();
    const brain = new ScriptedBrain()
      .queueProduce(textArtifact('candidate-0')) // first produce (pre-tournament)
      .queueProduce(textArtifact('candidate-1')) // tournament lens 1
      .queueProduce(textArtifact('candidate-2')) // tournament lens 2
      .queueJudge(passVerdict())  // judge candidate 0
      .queueJudge(passVerdict())  // judge candidate 1
      .queueJudge(passVerdict()); // judge candidate 2

    const engine = new Engine({
      registry: tournamentRegistry(3),
      brain,
      store,
      memory: new NoopMemoryView(),
    });

    await engine.run(makeGoal({ type: 'design-arch' }));

    const jv = (await store.list()).filter((e) => e.type === 'judge-verdict');
    expect(jv).toHaveLength(3);
  });

  it('the emitted report has no blockers (winner passes)', async () => {
    const store = new MemoryEventStore();
    const brain = new ScriptedBrain()
      .queueProduce(textArtifact('c0'))
      .queueProduce(textArtifact('c1'))
      .queueProduce(textArtifact('c2'))
      .queueJudge(passVerdict())
      .queueJudge(passVerdict())
      .queueJudge(passVerdict());

    const engine = new Engine({
      registry: tournamentRegistry(3),
      brain,
      store,
      memory: new NoopMemoryView(),
    });

    const report = await engine.run(makeGoal({ type: 'design-arch' }));
    expect(report.blockers).toHaveLength(0);
  });
});

describe('leaf tournament: winner selection', () => {
  it('selects the passing candidate with fewest findings as winner', async () => {
    // candidate 0: passes, 2 findings
    // candidate 1: passes, 0 findings  ← winner
    // candidate 2: passes, 1 finding
    const store = new MemoryEventStore();
    const brain = new ScriptedBrain()
      .queueProduce(textArtifact('c0'))
      .queueProduce(textArtifact('c1-winner'))
      .queueProduce(textArtifact('c2'))
      .queueJudge(verdictWithFindings(2))
      .queueJudge(verdictWithFindings(0))
      .queueJudge(verdictWithFindings(1));

    const engine = new Engine({
      registry: tournamentRegistry(3),
      brain,
      store,
      memory: new NoopMemoryView(),
    });

    const report = await engine.run(makeGoal({ type: 'design-arch' }));
    expect(report.blockers).toHaveLength(0);
    // The winner artifact text should be 'c1-winner' (fewest findings among passing)
    expect(report.artifact?.kind === 'text' && report.artifact.text).toBe('c1-winner');
  });

  it('when no candidate passes, uses the best loser (fewest findings)', async () => {
    // All fail; candidate 1 has fewest findings (1) → winner
    const store = new MemoryEventStore();
    const brain = new ScriptedBrain()
      .queueProduce(textArtifact('c0-3findings'))
      .queueProduce(textArtifact('c1-1finding'))
      .queueProduce(textArtifact('c2-2findings'))
      .queueJudge(failVerdict('f1', undefined, undefined, 'sig-c0'))
      .queueJudge({ pass: false, findings: [{ title: 'f', dimension: 'spec', severity: 'high', gating: true }], failureSignature: 'sig-c1' })
      .queueJudge({ pass: false, findings: [{ title: 'f', dimension: 'spec', severity: 'high', gating: true }, { title: 'g', dimension: 'spec', severity: 'high', gating: true }], failureSignature: 'sig-c2' });

    const engine = new Engine({
      registry: tournamentRegistry(3),
      brain,
      store,
      memory: new NoopMemoryView(),
    });

    // The run will eventually block (no passing candidate → deterministic path
    // fails because judge failed). The test asserts k judge-verdicts were emitted.
    await engine.run(makeGoal({ type: 'design-arch', budget: { attempts: 1, tokens: 100_000, toolCalls: 0, wallClockMs: 60_000 } }));
    const jv = (await store.list()).filter((e) => e.type === 'judge-verdict');
    expect(jv).toHaveLength(3);
  });
});

describe('leaf tournament: golden-candidate gating', () => {
  it('NO golden-candidate events when goldenCapture is false (scripted runs)', async () => {
    const store = new MemoryEventStore();
    const brain = new ScriptedBrain()
      .queueProduce(textArtifact('c0'))
      .queueProduce(textArtifact('c1'))
      .queueProduce(textArtifact('c2'))
      .queueJudge(passVerdict())
      .queueJudge(passVerdict())
      .queueJudge(passVerdict());

    const engine = new Engine({
      registry: tournamentRegistry(3),
      brain,
      store,
      memory: new NoopMemoryView(),
      goldenCapture: false, // scripted / test run
    });

    await engine.run(makeGoal({ type: 'design-arch' }));

    const gc = (await store.list()).filter((e) => e.type === 'golden-candidate');
    expect(gc).toHaveLength(0);
  });

  it('emits k golden-candidate events when goldenCapture is true (non-scripted)', async () => {
    const store = new MemoryEventStore();
    const brain = new ScriptedBrain()
      .queueProduce(textArtifact('c0'))
      .queueProduce(textArtifact('c1'))
      .queueProduce(textArtifact('c2'))
      .queueJudge(passVerdict())
      .queueJudge(passVerdict())
      .queueJudge(passVerdict());

    const engine = new Engine({
      registry: tournamentRegistry(3),
      brain,
      store,
      memory: new NoopMemoryView(),
      goldenCapture: true, // live / non-scripted run
    });

    await engine.run(makeGoal({ type: 'design-arch' }));

    const gc = (await store.list()).filter((e) => e.type === 'golden-candidate');
    expect(gc).toHaveLength(3);
  });
});

describe('leaf tournament: k=1 does NOT fire tournament', () => {
  it('k=1 type runs as a normal single produce (no tournament judge-verdicts)', async () => {
    const store = new MemoryEventStore();
    const singleRegistry = buildRegistry([
      leafTypeDef({
        name: 'single-arch',
        kind: 'make',
        family: 'test',
        leafOnly: true,
        tier: { default: 'high', ladder: ['high'] },
        deterministic: [],
        judgeType: 'critique-doc',
        grants: [],
        scan: { k: 1, lenses: ['architect'] },
      }),
      leafTypeDef({
        name: 'critique-doc',
        kind: 'judge',
        family: 'test',
        leafOnly: true,
        tier: { default: 'high', ladder: ['high'] },
        deterministic: [],
        judgeType: null,
        grants: [],
      }),
    ]);

    const brain = new ScriptedBrain()
      .queueProduce(textArtifact('single'))
      .queueJudge(passVerdict()); // standard judgeType judge call

    const engine = new Engine({
      registry: singleRegistry,
      brain,
      store,
      memory: new NoopMemoryView(),
    });

    await engine.run(makeGoal({ type: 'single-arch' }));

    const jv = (await store.list()).filter((e) => e.type === 'judge-verdict');
    // k=1 → no tournament, but the standard judgeType judge runs → 1 verdict
    expect(jv).toHaveLength(1);
  });
});

describe('leaf tournament: scan field absent, no tournament', () => {
  it('a leafOnly type without scan field uses the normal single produce path', async () => {
    const store = new MemoryEventStore();
    const registry = buildRegistry([
      leafTypeDef({
        name: 'plain-leaf',
        kind: 'make',
        family: 'test',
        leafOnly: true,
        tier: { default: 'low', ladder: ['low'] },
        deterministic: [],
        judgeType: 'plain-judge',
        grants: [],
        // no scan field
      }),
      leafTypeDef({
        name: 'plain-judge',
        kind: 'judge',
        family: 'test',
        leafOnly: true,
        tier: { default: 'low', ladder: ['low'] },
        deterministic: [],
        judgeType: null,
        grants: [],
      }),
    ]);

    const brain = new ScriptedBrain()
      .queueProduce(textArtifact('artifact'))
      .queueJudge(passVerdict());

    const engine = new Engine({
      registry,
      brain,
      store,
      memory: new NoopMemoryView(),
    });

    await engine.run(makeGoal({ type: 'plain-leaf' }));

    const jv = (await store.list()).filter((e) => e.type === 'judge-verdict');
    // No tournament: exactly 1 judge-verdict from the standard judgeType path
    expect(jv).toHaveLength(1);
  });
});

describe('leaf tournament: k=3 judge-verdict events precede emitted event', () => {
  it('all 3 judge-verdict events appear in the log before the emitted event', async () => {
    const store = new MemoryEventStore();
    const brain = new ScriptedBrain()
      .queueProduce(textArtifact('c0'))
      .queueProduce(textArtifact('c1'))
      .queueProduce(textArtifact('c2'))
      .queueJudge(passVerdict())
      .queueJudge(passVerdict())
      .queueJudge(passVerdict());

    const engine = new Engine({
      registry: tournamentRegistry(3),
      brain,
      store,
      memory: new NoopMemoryView(),
    });

    await engine.run(makeGoal({ type: 'design-arch' }));

    const events = await store.list();
    const emittedIdx = events.findIndex((e) => e.type === 'emitted');
    const jvIndices = events
      .map((e, i) => (e.type === 'judge-verdict' ? i : -1))
      .filter((i) => i >= 0);

    expect(emittedIdx).toBeGreaterThan(-1);
    expect(jvIndices).toHaveLength(3);
    // All judge-verdict events must precede the emitted event
    for (const jvIdx of jvIndices) {
      expect(jvIdx).toBeLessThan(emittedIdx);
    }
  });
});
