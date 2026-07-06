/**
 * The event renderings shared by replay and follow: the compact follow one-liner
 * carries the key detail (tier / tool / verdict / block reason), and describeEvent
 * is total over the union so a new event type cannot silently render as blank.
 */

import { describe, it, expect } from 'vitest';
import { describeEvent, followLine, shortGoalId } from '../../src/eventlog/render.js';
import type { FactoryEvent } from '../../src/contract/events.js';

describe('describeEvent', () => {
  it('carries the tool name and outcome', () => {
    const e: FactoryEvent = { type: 'tool-call', at: 1, goalId: 'g', tool: 'write_file', callId: 'c1', outcome: 'refused', reason: 'out of scope' };
    expect(describeEvent(e)).toBe('tool-call: write_file → refused — out of scope');
  });

  it('carries the judge tier and a failing verdict summary', () => {
    const e: FactoryEvent = {
      type: 'judge-verdict',
      at: 1,
      goalId: 'g',
      judgeType: 'integration',
      tier: 'high',
      verdict: { pass: false, findings: [{ title: 'broken import', gating: true, severity: 'high' }] },
    };
    expect(describeEvent(e)).toContain('judge(integration) @high');
    expect(describeEvent(e)).toContain('FAIL');
    expect(describeEvent(e)).toContain('broken import');
  });

  it('renders a block with its reason', () => {
    const e: FactoryEvent = {
      type: 'blocked',
      at: 1,
      goalId: 'g',
      resolution: 'park',
      brief: { question: 'need the API key', kind: 'authority-gap', options: [] } as never,
    };
    expect(describeEvent(e)).toContain('BLOCKED (park)');
    expect(describeEvent(e)).toContain('need the API key');
  });
});

describe('followLine', () => {
  it('is a clock + short goal + detail one-liner', () => {
    const e: FactoryEvent = { type: 'tier-escalated', at: Date.UTC(2026, 0, 1, 0, 0, 0), goalId: 'goal-abc12345', from: 'low', to: 'mid' };
    const line = followLine(e);
    expect(line).toMatch(/^\d\d:\d\d:\d\d {2}\S+ {2}tier: low → mid$/);
  });
});

describe('shortGoalId', () => {
  it('takes the last dash-segment, capped at 8 chars', () => {
    expect(shortGoalId('goal-deadbeefcafe')).toBe('deadbeef');
    expect(shortGoalId('plain')).toBe('plain');
  });
});
