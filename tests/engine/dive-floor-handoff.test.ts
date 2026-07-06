import { describe, expect, it } from 'vitest';
import type { ChildPlan } from '../../src/contract/decision.js';
import type { Kind } from '../../src/contract/goal.js';
import type { Report } from '../../src/contract/report.js';
import { classifyFatalDeps } from '../../src/engine/dive-floor-handoff.js';
import { textArtifact } from './stubs.js';

const plan = (over: Partial<ChildPlan> & Pick<ChildPlan, 'localId'>): ChildPlan => ({
  localId: over.localId,
  type: over.type ?? 'leaf',
  title: over.localId,
  spec: {},
  dependsOn: over.dependsOn ?? [],
  scope: over.scope ?? [],
  budgetShare: 0.5,
});

const rep = (over: Partial<Report>): Report => ({
  artifact: textArtifact('ok'),
  proof: [],
  lessons: [],
  memoriesUsed: [],
  blockers: [],
  findings: [],
  learned: '',
  ...over,
});

const kindOf = (t: string): Kind | undefined => (t === 'dive' ? 'learn' : 'make');

describe('classifyFatalDeps', () => {
  it('routes a null-producing dive to floorable regions, not a hard block', () => {
    const result = classifyFatalDeps(
      [rep({ artifact: null, blockers: ['dive failed'] })],
      [plan({ localId: 'd', type: 'dive', scope: ['src/engine'] })],
      kindOf,
    );
    expect(result.hard).toEqual([]);
    expect(result.floorableRegions).toEqual(['src/engine']);
  });

  it('routes a null-producing make dependency to a hard block', () => {
    const result = classifyFatalDeps(
      [rep({ artifact: null, blockers: ['contract missing'] })],
      [plan({ localId: 'c', type: 'leaf', scope: ['src/contract'] })],
      kindOf,
    );
    expect(result.hard).toEqual([{ blocker: 'contract missing' }]);
    expect(result.floorableRegions).toEqual([]);
  });

  it('ignores dependencies that produced a usable artifact (even with blockers)', () => {
    const result = classifyFatalDeps(
      [rep({ artifact: textArtifact('partial'), blockers: ['coverage nit'] })],
      [plan({ localId: 'd', type: 'dive', scope: ['src/engine'] })],
      kindOf,
    );
    expect(result.hard).toEqual([]);
    expect(result.floorableRegions).toEqual([]);
  });

  it('treats a scopeless dive as a hard block — there is no region to floor', () => {
    const result = classifyFatalDeps(
      [rep({ artifact: null, blockers: ['dive failed'] })],
      [plan({ localId: 'd', type: 'dive', scope: [] })],
      kindOf,
    );
    expect(result.hard).toHaveLength(1);
    expect(result.floorableRegions).toEqual([]);
  });

  it('partitions a mix: floors the dive, hard-blocks the make', () => {
    const result = classifyFatalDeps(
      [
        rep({ artifact: null, blockers: ['dive failed'] }),
        rep({ artifact: null, blockers: ['build dep failed'] }),
      ],
      [
        plan({ localId: 'd', type: 'dive', scope: ['src/engine'] }),
        plan({ localId: 'm', type: 'leaf', scope: ['src/x'] }),
      ],
      kindOf,
    );
    expect(result.floorableRegions).toEqual(['src/engine']);
    expect(result.hard).toEqual([{ blocker: 'build dep failed' }]);
  });
});
