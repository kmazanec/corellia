import { describe, expect, it } from 'vitest';
import { checkEmissionAuthority } from '../../src/engine/attempt/emission-authority.js';
import {
  filesArtifact,
  makeGoal,
  MemoryEventStore,
  textArtifact,
} from './stubs.js';

const sensitivity = [{
  pattern: 'auth',
  reason: 'auth is sensitive',
  risk: 'high' as const,
}];

describe('emission authority', () => {
  it('does nothing for non-file artifacts', async () => {
    const store = new MemoryEventStore();

    const report = await checkEmissionAuthority({
      goal: makeGoal(),
      artifact: textArtifact('notes'),
      entryRisk: 'low',
      sensitivity,
      store,
      now: () => 1,
      onGate: undefined,
      onBrief: undefined,
    });

    expect(report).toBeNull();
    expect(await store.list()).toEqual([]);
  });

  it('records emission risk without gating non-high risk files', async () => {
    const store = new MemoryEventStore();

    const report = await checkEmissionAuthority({
      goal: makeGoal(),
      artifact: filesArtifact([{ path: 'src/app.ts', content: '' }]),
      entryRisk: 'low',
      sensitivity,
      store,
      now: () => 2,
      onGate: undefined,
      onBrief: undefined,
    });

    expect(report).toBeNull();
    expect((await store.list()).map((event) => event.type)).toEqual(['risk-classified']);
  });

  it('blocks high-risk emission when entry risk was not already gated', async () => {
    const store = new MemoryEventStore();

    const report = await checkEmissionAuthority({
      goal: makeGoal(),
      artifact: filesArtifact([{ path: 'src/auth/session.ts', content: '' }]),
      entryRisk: 'low',
      sensitivity,
      store,
      now: () => 3,
      onGate: undefined,
      onBrief: undefined,
    });

    expect(report?.blockers[0]).toContain('Authority gate denied at emission');
    expect((await store.list()).map((event) => event.type)).toEqual([
      'risk-classified',
      'gate-decision',
      'blocked',
      'emitted',
    ]);
  });

  it('does not gate high-risk emission that was already high at entry', async () => {
    const store = new MemoryEventStore();

    const report = await checkEmissionAuthority({
      goal: makeGoal(),
      artifact: filesArtifact([{ path: 'src/auth/session.ts', content: '' }]),
      entryRisk: 'high',
      sensitivity,
      store,
      now: () => 4,
      onGate: undefined,
      onBrief: undefined,
    });

    expect(report).toBeNull();
    expect((await store.list()).map((event) => event.type)).toEqual(['risk-classified']);
  });
});
