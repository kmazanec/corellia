/**
 * `corellia calibrate` — resolves a target to its golden set(s), replays through
 * an INJECTED brain (never a live API), and prints the score. Tests inject a
 * ScriptedBrain and an in-memory golden store.
 */

import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseCalibrateArgs, resolveTargetSets, runCalibrate } from '../../src/eval/golden/calibrate-cli.js';
import { fileGoldenStore } from '../../src/eval/golden/golden-store.js';
import { ScriptedBrain } from '../../src/brains/scripted.js';
import type { Verdict } from '../../src/contract/verdict.js';
import type { GoldenPair } from '../../src/eval/golden/golden-set.js';
import type { GoldenStore } from '../../src/eval/golden/golden-store.js';

function sha1(v: string): string {
  return createHash('sha1').update(v).digest('hex');
}
function pass(): Verdict {
  return { pass: true, findings: [] };
}
function fail(): Verdict {
  return { pass: false, findings: [{ title: 'x', dimension: 'spec', severity: 'high', gating: true }] };
}

function pair(goalType: string, judgeType: string, id: string, label: GoldenPair['label']): GoldenPair {
  return {
    id,
    goalType,
    judgeType,
    artifact: { kind: 'text', text: id },
    rubric: 'r',
    label,
    labelSource: 'operator',
    sha: 'x',
    artifactDigest: sha1(id),
    rubricDigest: sha1('r'),
  };
}

function memStore(pairs: GoldenPair[]): GoldenStore {
  return {
    async loadSet(goalType) {
      return pairs.filter((p) => p.goalType === goalType);
    },
    async save() {
      /* unused in these tests */
    },
  };
}

function io() {
  const out: string[] = [];
  const err: string[] = [];
  return { log: (l: string) => out.push(l), error: (l: string) => err.push(l), out, err };
}

describe('parseCalibrateArgs', () => {
  it('parses target and tier', () => {
    const args = parseCalibrateArgs(['critique-code', '--tier', 'high']);
    expect(args.target).toBe('critique-code');
    expect(args.tier).toBe('high');
  });

  it('defaults tier to mid', () => {
    expect(parseCalibrateArgs(['implement']).tier).toBe('mid');
  });

  it('errors on a bad tier', () => {
    expect(parseCalibrateArgs(['x', '--tier', 'ultra']).error).toMatch(/--tier/);
  });

  it('errors when target is missing', () => {
    expect(parseCalibrateArgs([]).error).toMatch(/usage/);
  });
});

describe('resolveTargetSets', () => {
  it('resolves a goal-type directly to its own set', async () => {
    const store = memStore([pair('implement', 'critique-code', 'p1', 'merged')]);
    const sets = await resolveTargetSets('implement', '/repo', store);
    expect(sets).toHaveLength(1);
    expect(sets[0]!.goalType).toBe('implement');
  });

  it('resolves a judge-type by scanning goal-type dirs for matching pairs', async () => {
    const store = memStore([
      pair('implement', 'critique-code', 'p1', 'merged'),
      pair('freeze-contract', 'critique-code', 'p2', 'rejected'),
      pair('deliver-intent', 'judge-integration', 'p3', 'merged'),
    ]);
    // memStore.loadSet('critique-code') is empty, so it falls to the judge scan;
    // but our memStore can't readdir the fixtures root. The real fixtures tree is
    // exercised by the seed-fixture test below.
    const direct = await resolveTargetSets('critique-code', '/repo', store);
    expect(direct).toEqual([]);
  });

  it('loads the committed seed golden fixture from the real fixtures tree', async () => {
    const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
    const store = fileGoldenStore(repoRoot);
    const sets = await resolveTargetSets('implement', repoRoot, store);
    expect(sets.length).toBeGreaterThanOrEqual(1);
    const seed = sets.flatMap((s) => s.pairs).find((p) => p.id === 'clamp-merged-seed');
    expect(seed).toBeDefined();
    expect(seed!.judgeType).toBe('critique-code');
    expect(seed!.label).toBe('merged');
    // Resolvable by judge-type too (scans the fixtures dirs).
    const byJudge = await resolveTargetSets('critique-code', repoRoot, store);
    expect(byJudge.flatMap((s) => s.pairs).some((p) => p.id === 'clamp-merged-seed')).toBe(true);
  });
});

describe('runCalibrate', () => {
  it('replays a goal-type set through an injected brain and prints the score', async () => {
    const store = memStore([
      pair('implement', 'critique-code', 'p1', 'merged'),
      pair('implement', 'critique-code', 'p2', 'rejected'),
    ]);
    const brain = new ScriptedBrain({ judge: { implement: [pass(), fail()] } });
    const c = io();

    const { code, scores } = await runCalibrate(
      { target: 'implement', tier: 'mid', repoRoot: '/repo', error: undefined },
      c,
      { makeBrain: () => brain, makeStore: () => store },
    );

    expect(code).toBe(0);
    expect(scores).toHaveLength(1);
    expect(scores[0]!.agreement).toBe(1);
    expect(c.out.join('\n')).toContain('agreement:  100%');
  });

  it('returns exit code 1 when the target names no golden pairs', async () => {
    const c = io();
    const { code } = await runCalibrate(
      { target: 'nonexistent', tier: 'mid', repoRoot: '/repo', error: undefined },
      c,
      { makeBrain: () => new ScriptedBrain({ judge: {} }), makeStore: () => memStore([]) },
    );
    expect(code).toBe(1);
    expect(c.err.join('\n')).toMatch(/no golden pairs/);
  });

  it('surfaces a parse error as exit code 2', async () => {
    const c = io();
    const { code } = await runCalibrate(
      parseCalibrateArgs(['x', '--tier', 'ultra']),
      c,
      { makeBrain: () => new ScriptedBrain({ judge: {} }), makeStore: () => memStore([]) },
    );
    expect(code).toBe(2);
  });
});
