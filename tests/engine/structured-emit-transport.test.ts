/**
 * The emit paths must preserve the TRANSPORT kind of a thrown step error:
 * a timed-out emit classified as a plain 'failed' produced the isomorphic
 * step-loop:failed signature and hard-blocked after two provider blips
 * (live-tail run 20), bypassing every transport allowance.
 */

import { describe, expect, it } from 'vitest';
import type { Brain } from '../../src/contract/brain.js';
import { ZERO_USAGE } from '../../src/contract/goal.js';
import { runStructuredArtifactEmit } from '../../src/engine/step-loop-emit.js';
import { makeGoal, MemoryEventStore } from './stubs.js';

describe('structured emit transport classification', () => {
  it('marks a timed-out emit as transport', async () => {
    const brain: Brain = {
      async decide() { throw new Error('not used'); },
      async produce() { throw new Error('not used'); },
      async judge() { throw new Error('not used'); },
      async repair() { throw new Error('not used'); },
      async step() {
        const err = new Error('The operation was aborted due to timeout');
        err.name = 'TimeoutError';
        throw err;
      },
    };

    const result = await runStructuredArtifactEmit({
      goal: makeGoal(),
      outputSchema: { type: 'object' },
      ctx: { tier: 'high', memories: [] },
      transcript: [{ role: 'context', content: 'sys' }],
      brain,
      store: new MemoryEventStore(),
      now: () => 1,
      enforceToolCallBudget: false,
      state: { remainingToolCalls: 5, stepIndex: 3, totalTokensUsed: 0, exploreReadCalls: 10 },
      debitUsage: () => {},
      checkCeiling: async () => false,
    });

    expect(result.kind).toBe('failed');
    expect(result.kind === 'failed' ? result.transport : undefined).toBe(true);
  });
});
