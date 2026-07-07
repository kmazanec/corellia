/**
 * Tests for the ship-what's-green decision predicate (issue A5).
 *
 * decidePartialDeliveryFor is the pure honesty gate: a blocked root report ships
 * its green subtree ONLY when real green work was delivered AND the only blockers
 * are child-module blocks (no root-level acceptance/integration failure).
 */

import { describe, it, expect } from 'vitest';
import {
  decidePartialDeliveryFor,
  renderBlockedModules,
  type DeliveredDiff,
} from '../../src/engine/partial-delivery.js';
import type { Report } from '../../src/contract/report.js';

const GREEN_DIFF: DeliveredDiff = { changedCount: 3, ok: true };
const EMPTY_DIFF: DeliveredDiff = { changedCount: 0, ok: true };

function report(overrides: Partial<Report> = {}): Report {
  return {
    artifact: { kind: 'files', files: [{ path: 'a.ts', content: 'x' }] },
    proof: [],
    lessons: [],
    memoriesUsed: [],
    blockers: [],
    findings: [],
    learned: '',
    ...overrides,
  };
}

describe('decidePartialDeliveryFor', () => {
  it('ships green when a child blocked, green work exists, and no root-level blocker', () => {
    const r = report({
      blockers: ['module B: step-loop:failed'],
      partialDelivery: {
        blockedModules: [{ goalId: 'root/b', title: 'module B', blocker: 'module B: step-loop:failed' }],
        childBlockers: ['module B: step-loop:failed'],
      },
    });
    const decision = decidePartialDeliveryFor(r, GREEN_DIFF);
    expect(decision.shipGreen).toBe(true);
    expect(decision.reason).toContain('1 module(s) blocked');
  });

  it('does NOT ship when there is a root-level acceptance/integration blocker', () => {
    // The green subtree itself failed the root's own judge — honesty over completion.
    const r = report({
      blockers: ['module B: step-loop:failed', 'Integration eval failed: modules do not compose'],
      partialDelivery: {
        blockedModules: [{ goalId: 'root/b', title: 'module B', blocker: 'module B: step-loop:failed' }],
        childBlockers: ['module B: step-loop:failed'],
      },
    });
    const decision = decidePartialDeliveryFor(r, GREEN_DIFF);
    expect(decision.shipGreen).toBe(false);
    expect(decision.reason).toContain('root-level acceptance/integration failure');
  });

  it('does NOT ship when no green work was delivered (empty diff)', () => {
    // All-blocked tree: nothing green to ship — preserve as today.
    const r = report({
      artifact: null,
      blockers: ['module B: blocked', 'module C: blocked'],
      partialDelivery: {
        blockedModules: [
          { goalId: 'root/b', title: 'module B', blocker: 'module B: blocked' },
          { goalId: 'root/c', title: 'module C', blocker: 'module C: blocked' },
        ],
        childBlockers: ['module B: blocked', 'module C: blocked'],
      },
    });
    const decision = decidePartialDeliveryFor(r, EMPTY_DIFF);
    expect(decision.shipGreen).toBe(false);
    expect(decision.reason).toContain('no green work delivered');
  });

  it('does NOT ship when the delivered diff escaped scope', () => {
    const r = report({
      blockers: ['module B: blocked'],
      partialDelivery: {
        blockedModules: [{ goalId: 'root/b', title: 'module B', blocker: 'module B: blocked' }],
        childBlockers: ['module B: blocked'],
      },
    });
    const decision = decidePartialDeliveryFor(r, {
      changedCount: 2,
      ok: false,
      scopeInsufficiency: 'File(s) outside declared scope: src/other.ts',
    });
    expect(decision.shipGreen).toBe(false);
    expect(decision.reason).toContain('escaped declared scope');
  });

  it('does NOT ship when there are no blocked modules (nothing partial)', () => {
    const decision = decidePartialDeliveryFor(report({ blockers: [] }), GREEN_DIFF);
    expect(decision.shipGreen).toBe(false);
    expect(decision.reason).toContain('no blocked child modules');
  });
});

describe('renderBlockedModules', () => {
  it('renders each blocked module as a line with title, goalId, and reason', () => {
    const r = report({
      partialDelivery: {
        blockedModules: [
          { goalId: 'root/b', title: 'module B', blocker: 'step-loop:failed' },
          { goalId: 'root/c', title: 'module C', blocker: 'dependency failed' },
        ],
        childBlockers: [],
      },
    });
    const text = renderBlockedModules(r);
    expect(text).toContain('2 module(s) blocked');
    expect(text).toContain('- module B (root/b): step-loop:failed');
    expect(text).toContain('- module C (root/c): dependency failed');
  });

  it('returns empty string when there is no partial delivery', () => {
    expect(renderBlockedModules(report())).toBe('');
  });
});
