/**
 * The golden-calibration pipeline: curate a labeled candidate into a versioned
 * golden pair, replay a goal-type's set through its judge, and score agreement.
 *
 * Every replay runs a real ScriptedBrain (src/brains/scripted.ts) — the harness
 * never hits a live API. The judge's verdicts are declared upfront so the
 * confusion matrix is exact and reproducible.
 */

import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { ScriptedBrain } from '../../src/brains/scripted.js';
import type { Artifact } from '../../src/contract/report.js';
import type { Verdict } from '../../src/contract/verdict.js';
import type { FactoryEvent } from '../../src/contract/events.js';
import { parseFactoryEvent } from '../../src/contract/event-parser.js';
import { goldenCandidates, labeledGoldenCandidates, type GoldenCandidate, type GoldenLabel } from '../../src/eventlog/projections.js';
import { buildGoldenPair, curateGoldenPair } from '../../src/eval/golden/curate.js';
import { replayGoldenSet, renderScore } from '../../src/eval/golden/replay.js';
import type { GoldenPair } from '../../src/eval/golden/golden-set.js';
import type { GoldenStore } from '../../src/eval/golden/golden-store.js';

function sha1(value: string): string {
  return createHash('sha1').update(value).digest('hex');
}

function textArtifact(text: string): Artifact {
  return { kind: 'text', text };
}

function pass(): Verdict {
  return { pass: true, findings: [] };
}
function fail(): Verdict {
  return { pass: false, findings: [{ title: 'bad', dimension: 'spec', severity: 'high', gating: true }] };
}

function labeledCandidate(
  overrides: Partial<GoldenCandidate & { label: GoldenLabel }> & { artifact: Artifact; rubric: string; label: GoldenLabel },
): GoldenCandidate & { label: GoldenLabel } {
  return {
    goalId: 'tree-1',
    judgeType: 'critique-code',
    artifactDigest: sha1(overrides.artifact.text ?? ''),
    rubricDigest: sha1(overrides.rubric),
    verdictPass: true,
    tier: 'mid',
    at: 1000,
    ...overrides,
  };
}

/** An in-memory golden store so tests never touch the fixtures tree. */
function memStore(): GoldenStore & { pairs: GoldenPair[] } {
  const pairs: GoldenPair[] = [];
  return {
    pairs,
    async loadSet(goalType) {
      return pairs.filter((p) => p.goalType === goalType);
    },
    async save(pair) {
      pairs.push(pair);
    },
  };
}

describe('curate: promote a labeled candidate into a golden pair', () => {
  it('builds a pair pinned with the SHA and carries the label expectation', () => {
    const artifact = textArtifact('the judged artifact');
    const rubric = 'the enriched rubric';
    const candidate = labeledCandidate({
      artifact,
      rubric,
      label: { outcome: 'merged', source: 'operator', at: 2000 },
    });

    const pair = buildGoldenPair({ candidate, goalType: 'implement', artifact, rubric, sha: 'deadbeef' });

    expect(pair.goalType).toBe('implement');
    expect(pair.judgeType).toBe('critique-code');
    expect(pair.label).toBe('merged');
    expect(pair.sha).toBe('deadbeef');
    expect(pair.artifactDigest).toBe(sha1('the judged artifact'));
  });

  it('rejects an artifact whose digest does not match the pinned candidate', () => {
    const artifact = textArtifact('the judged artifact');
    const rubric = 'the enriched rubric';
    const candidate = labeledCandidate({
      artifact,
      rubric,
      label: { outcome: 'merged', source: 'operator', at: 2000 },
    });

    expect(() =>
      buildGoldenPair({ candidate, goalType: 'implement', artifact: textArtifact('DIFFERENT'), rubric, sha: 'x' }),
    ).toThrow(/artifact digest mismatch/);
  });

  it('rejects a rubric whose digest does not match the pinned candidate', () => {
    const artifact = textArtifact('a');
    const rubric = 'r';
    const candidate = labeledCandidate({
      artifact,
      rubric,
      label: { outcome: 'rejected', source: 'operator', at: 2000 },
    });

    expect(() =>
      buildGoldenPair({ candidate, goalType: 'implement', artifact, rubric: 'DIFFERENT', sha: 'x' }),
    ).toThrow(/rubric digest mismatch/);
  });

  it('writes the pair to the store', async () => {
    const artifact = textArtifact('a');
    const rubric = 'r';
    const candidate = labeledCandidate({ artifact, rubric, label: { outcome: 'merged', source: 'operator', at: 2000 } });
    const store = memStore();
    await curateGoldenPair({ candidate, goalType: 'implement', artifact, rubric, sha: 'x' }, store);
    expect(store.pairs).toHaveLength(1);
    expect(store.pairs[0]!.goalType).toBe('implement');
  });
});

describe('replay: score a judge against its golden set', () => {
  function pair(id: string, label: GoldenPair['label'], text = id): GoldenPair {
    return {
      id,
      goalType: 'implement',
      judgeType: 'critique-code',
      artifact: textArtifact(text),
      rubric: 'r',
      label,
      labelSource: 'operator',
      sha: 'x',
      artifactDigest: sha1(text),
      rubricDigest: sha1('r'),
    };
  }

  it('a perfectly-calibrated judge scores agreement 1', async () => {
    // merged→expect pass, rejected→expect fail; brain matches exactly.
    const pairs = [pair('p1', 'merged'), pair('p2', 'rejected')];
    const brain = new ScriptedBrain({
      judge: {
        // Keyed by the replay goal title ("golden replay <id>") — fall back to type.
        implement: [pass(), fail()],
      },
    });

    const score = await replayGoldenSet({ goalType: 'implement', pairs, brain, tier: 'mid' });

    expect(score.total).toBe(2);
    expect(score.agreement).toBe(1);
    expect(score.truePositive).toBe(1);
    expect(score.trueNegative).toBe(1);
    expect(score.precision).toBe(1);
    expect(score.recall).toBe(1);
  });

  it('a judge that always passes has recall 1 but poor precision on negatives', async () => {
    const pairs = [pair('p1', 'merged'), pair('p2', 'rejected')];
    const brain = new ScriptedBrain({ judge: { implement: [pass()] } }); // clamps: always pass

    const score = await replayGoldenSet({ goalType: 'implement', pairs, brain, tier: 'mid' });

    expect(score.agreement).toBe(0.5);
    expect(score.truePositive).toBe(1);
    expect(score.falsePositive).toBe(1);
    expect(score.recall).toBe(1); // caught the one positive
    expect(score.precision).toBe(0.5); // but blessed a should-fail
  });

  it('confirmed/refuted map to pass/fail expectations like merged/rejected', async () => {
    const pairs = [pair('p1', 'confirmed'), pair('p2', 'refuted')];
    const brain = new ScriptedBrain({ judge: { implement: [pass(), fail()] } });
    const score = await replayGoldenSet({ goalType: 'implement', pairs, brain, tier: 'mid' });
    expect(score.agreement).toBe(1);
  });

  it('an empty set is vacuously calibrated (agreement 1, no confusion cells)', async () => {
    const brain = new ScriptedBrain({ judge: {} });
    const score = await replayGoldenSet({ goalType: 'implement', pairs: [], brain, tier: 'mid' });
    expect(score.total).toBe(0);
    expect(score.agreement).toBe(1);
    expect(score.precision).toBeNull();
    expect(score.recall).toBeNull();
  });

  it('renderScore prints the headline agreement and confusion cells', async () => {
    const pairs = [pair('p1', 'merged'), pair('p2', 'rejected')];
    const brain = new ScriptedBrain({ judge: { implement: [pass(), fail()] } });
    const score = await replayGoldenSet({ goalType: 'implement', pairs, brain, tier: 'mid' });
    const text = renderScore(score);
    expect(text).toContain('agreement:  100%');
    expect(text).toContain('tp=1 fp=0 tn=1 fn=0');
  });
});

describe('end-to-end: candidate → label → project → curate → replay', () => {
  it('joins an exogenous label, curates the pair, and calibrates the judge', async () => {
    const artifact = textArtifact('the shipped diff');
    const rubric = 'the enriched rubric';
    // Raw log events, exactly as the engine + `corellia label` would append them.
    const events: FactoryEvent[] = [
      {
        type: 'golden-candidate',
        at: 1000,
        goalId: 'tree-99',
        judgeType: 'critique-code',
        artifactDigest: sha1('the shipped diff'),
        rubricDigest: sha1('the enriched rubric'),
        verdictPass: true,
        tier: 'mid',
      },
      // The label event round-trips through the parser (proves the wire shape).
      parseFactoryEvent({ type: 'golden-label', at: 2000, goalId: 'tree-99', outcome: 'merged', source: 'operator' })!,
    ];

    // The projection joins the label to the candidate.
    const labeled = labeledGoldenCandidates(events);
    expect(labeled['critique-code']).toHaveLength(1);
    const candidate = labeled['critique-code']![0]!;
    expect(candidate.label.outcome).toBe('merged');
    // Sanity: the unlabeled projection also carries the join.
    expect(goldenCandidates(events)['critique-code']![0]!.label!.outcome).toBe('merged');

    // Curate the labeled candidate into a versioned pair.
    const store = memStore();
    await curateGoldenPair({ candidate, goalType: 'implement', artifact, rubric, sha: 'abc123' }, store);
    const set = await store.loadSet('implement');
    expect(set).toHaveLength(1);

    // Calibrate: a judge that passes the merged artifact fully agrees.
    const brain = new ScriptedBrain({ judge: { implement: [pass()] } });
    const score = await replayGoldenSet({ goalType: 'implement', pairs: set, brain, tier: 'mid' });
    expect(score.agreement).toBe(1);
    expect(score.truePositive).toBe(1);
  });
});
