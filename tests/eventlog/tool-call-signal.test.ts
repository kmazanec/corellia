/**
 * Tests for toolCallSignal (ADR-044; issue D2 model-capability signal). The
 * projection attributes tool-loop events to a tier by replaying tier-escalated /
 * judge-verdict anchors, and reports per-tier steps, malformations, and the
 * malformation rate the trace flags on.
 */

import { describe, it, expect } from 'vitest';
import { toolCallSignal } from '../../src/eventlog/projections.js';
import type { FactoryEvent } from '../../src/contract/events.js';
import type { Verdict } from '../../src/contract/verdict.js';

const passVerdict: Verdict = { pass: true, findings: [] };

const step = (goalId: string, at: number): FactoryEvent => ({
  type: 'step',
  at,
  goalId,
  index: 0,
  outputKind: 'tool-calls',
});

const malform = (goalId: string, at: number): FactoryEvent => ({
  type: 'malformation-reprompt',
  at,
  goalId,
  detail: 'unparseable tool args',
});

const judge = (goalId: string, at: number, tier: 'low' | 'mid' | 'high'): FactoryEvent => ({
  type: 'judge-verdict',
  at,
  goalId,
  judgeType: 'leaf-judge',
  verdict: passVerdict,
  tier,
});

const escalate = (
  goalId: string,
  at: number,
  from: 'low' | 'mid' | 'high',
  to: 'low' | 'mid' | 'high',
): FactoryEvent => ({ type: 'tier-escalated', at, goalId, from, to });

describe('toolCallSignal — tier attribution', () => {
  it('attributes a goal\'s steps to the tier its judge-verdict reveals', () => {
    const events: FactoryEvent[] = [judge('g1', 1, 'mid'), step('g1', 2), step('g1', 3), malform('g1', 4)];
    const { byTier } = toolCallSignal(events);
    expect(byTier.mid.steps).toBe(2);
    expect(byTier.mid.malformations).toBe(1);
    expect(byTier.mid.malformationRate).toBeCloseTo(0.5);
  });

  it('attributes events before an escalation to the from-tier and after to the to-tier', () => {
    const events: FactoryEvent[] = [
      step('g1', 1), // before any anchor → earliest known tier (low, from the escalation below)
      escalate('g1', 2, 'low', 'high'),
      step('g1', 3), // after escalation → high
      malform('g1', 4),
    ];
    const { byTier } = toolCallSignal(events);
    expect(byTier.low.steps).toBe(1);
    expect(byTier.high.steps).toBe(1);
    expect(byTier.high.malformations).toBe(1);
    // The escalation itself counts as an escalation OUT of low.
    expect(byTier.low.escalationsFrom).toBe(1);
  });

  it('buckets a goal with no observable tier as unknown', () => {
    const events: FactoryEvent[] = [step('g1', 1), malform('g1', 2)];
    const { byTier } = toolCallSignal(events);
    expect(byTier.unknown.steps).toBe(1);
    expect(byTier.unknown.malformations).toBe(1);
  });
});

describe('toolCallSignal — tool-call ran/refused and modelByTier passthrough', () => {
  it('splits tool-call outcomes into ran and refused per tier', () => {
    const ran = (goalId: string, at: number): FactoryEvent => ({
      type: 'tool-call',
      at,
      goalId,
      tool: 'read_file',
      callId: 'c1',
      outcome: 'ran',
    });
    const refused = (goalId: string, at: number): FactoryEvent => ({
      type: 'tool-call',
      at,
      goalId,
      tool: 'write_file',
      callId: 'c2',
      outcome: 'refused',
      reason: 'out of scope',
    });
    const events: FactoryEvent[] = [judge('g1', 1, 'low'), ran('g1', 2), ran('g1', 3), refused('g1', 4)];
    const { byTier } = toolCallSignal(events);
    expect(byTier.low.toolCallsRan).toBe(2);
    expect(byTier.low.toolCallsRefused).toBe(1);
  });

  it('passes through the modelByTier mapping so a flagged tier names a model', () => {
    const map = { low: 'a', mid: 'b', high: 'c' };
    const { modelByTier } = toolCallSignal([], map);
    expect(modelByTier).toEqual(map);
  });

  it('leaves malformationRate undefined for a tier with no steps', () => {
    const { byTier } = toolCallSignal([]);
    expect(byTier.mid.malformationRate).toBeUndefined();
  });
});
