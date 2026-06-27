import { describe, expect, it } from 'vitest';
import { appendGoldenCandidate, enrichRubric } from '../../src/engine/judge-support.js';
import {
  MemoryEventStore,
  buildRegistry,
  leafTypeDef,
  passVerdict,
  textArtifact,
} from './stubs.js';

describe('judge support', () => {
  it('adds the intent line to every rubric', () => {
    const registry = buildRegistry([]);

    expect(enrichRubric(registry, 'Base rubric', 'unknown-judge', 'spike'))
      .toContain("The goal's intent is spike");
  });

  it('includes family skill text for registered judge types', () => {
    const registry = buildRegistry([
      leafTypeDef({ name: 'judge-split', kind: 'judge', family: 'arbiter', judgeType: null }),
    ]);

    const rubric = enrichRubric(registry, 'Evaluate split', 'judge-split', 'production');

    expect(rubric).toContain('--- JUDGE SKILL ---');
    expect(rubric).toContain('judge-split');
  });

  it('does not append golden candidates when disabled', async () => {
    const store = new MemoryEventStore();

    await appendGoldenCandidate({
      enabled: false,
      store,
      now: () => 1,
      goalId: 'g',
      judgeType: 'judge',
      artifact: textArtifact('artifact'),
      rubric: 'rubric',
      verdict: passVerdict(),
      tier: 'low',
      brainConfig: { modelByTier: { low: 'model-low' } },
    });

    expect(await store.list({ type: 'golden-candidate' })).toEqual([]);
  });

  it('appends digests, verdict pass, tier, and model when enabled', async () => {
    const store = new MemoryEventStore();

    await appendGoldenCandidate({
      enabled: true,
      store,
      now: () => 2,
      goalId: 'g',
      judgeType: 'judge',
      artifact: textArtifact('artifact'),
      rubric: 'rubric',
      verdict: passVerdict(),
      tier: 'low',
      brainConfig: { modelByTier: { low: 'model-low' } },
    });

    const events = await store.list({ type: 'golden-candidate' });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      goalId: 'g',
      judgeType: 'judge',
      verdictPass: true,
      tier: 'low',
      model: 'model-low',
    });
    if (events[0]?.type === 'golden-candidate') {
      expect(events[0].artifactDigest).toHaveLength(40);
      expect(events[0].rubricDigest).toHaveLength(40);
    }
  });
});
