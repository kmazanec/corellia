import { describe, expect, it } from 'vitest';
import type { Goal } from '../../src/contract/goal.js';
import type { Finding } from '../../src/contract/verdict.js';
import {
  blockedReport,
  buildReport,
  escalatedBrief,
  exhaustedBrief,
  gateDeniedBrief,
  isomorphicBrief,
  nonConvergenceBrief,
  unknownTypeBrief,
} from '../../src/engine/reports.js';

const goal: Goal = {
  id: 'g1',
  type: 'implement',
  parentId: null,
  title: 'Build the thing',
  spec: { feature: 'thing' },
  intent: 'production',
  scope: ['src/'],
  budget: { attempts: 3, tokens: 1000, toolCalls: 5, wallClockMs: 60_000 },
  memories: [
    { id: 'm1', layer: 'project', provenance: 'trusted', content: 'Use existing patterns.' },
  ],
};

describe('engine report factories', () => {
  it('builds a blocked report with blocker and findings streams', () => {
    expect(blockedReport('needs a human', ['finding'])).toEqual({
      artifact: null,
      proof: [],
      lessons: [],
      memoriesUsed: [],
      blockers: ['needs a human'],
      findings: ['finding'],
      learned: '',
    });
  });

  it('builds an emitted report that carries memory ids', () => {
    const artifact = { kind: 'text' as const, text: 'done' };
    expect(buildReport(goal, artifact)).toMatchObject({
      artifact,
      memoriesUsed: ['m1'],
      blockers: [],
      findings: [],
    });
  });
});

describe('engine decision brief factories', () => {
  it('builds a teaching gate brief for type-level gates', () => {
    const brief = gateDeniedBrief(goal, 'high', true);
    expect(brief.question).toContain('type "implement" carries a type-level authority gate');
    expect(brief.teaching?.recommendation).toBe('deny');
  });

  it('builds lean mid-tree briefs with safe defaults', () => {
    const finding: Finding = {
      title: 'Unsafe migration',
      dimension: 'risk',
      severity: 'high',
      gating: true,
      escalated: true,
    };

    for (const brief of [
      unknownTypeBrief(goal),
      exhaustedBrief(goal, 'tokens'),
      escalatedBrief(goal, finding),
      isomorphicBrief(goal, 'sameFailure'),
      nonConvergenceBrief(goal),
    ]) {
      expect(brief.options).toEqual(['deny', 'park', 'bounce']);
      expect(brief.links).toEqual([goal.id]);
      expect(brief.deadlineMs).toBe(30_000);
      expect(brief.onTimeout).toBe('deny');
    }
  });
});
