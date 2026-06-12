/**
 * Shape round-trip tests for the frozen Brief contract (ADR-026).
 *
 * These tests prove that the four exported types compile and construct as
 * specified — any regression in the frozen shapes will break this file first.
 * The contract lives in `src/contract/brief.ts`; listener.ts re-exports
 * CommissionInput for backward compat; both import paths must resolve.
 */

import { describe, it, expect } from 'vitest';
import type {
  CommissionInput,
  ParkedBrief,
  FrontDoorStatus,
  StandingEnvelope,
} from '../../src/contract/brief.js';
// Backward-compat: the listener re-exports CommissionInput from the contract.
import type { CommissionInput as CommissionInputFromListener } from '../../src/listener/listener.js';

// ---------------------------------------------------------------------------
// CommissionInput — moved verbatim from listener.ts (ADR-026)
// ---------------------------------------------------------------------------

describe('CommissionInput shape', () => {
  it('constructs with all required fields', () => {
    const input: CommissionInput = {
      id: 'intent-1',
      title: 'Add greeting endpoint',
      spec: { goal: 'greet the user' },
      scope: ['src/api/'],
      budget: { attempts: 3, toolCalls: 20, tokens: 50_000 },
    };
    expect(input.id).toBe('intent-1');
    expect(input.scope).toEqual(['src/api/']);
  });

  it('accepts all optional fields', () => {
    const input: CommissionInput = {
      id: 'intent-2',
      title: 'Refactor auth',
      spec: {},
      scope: ['src/auth/'],
      budget: { attempts: 2, toolCalls: 10, tokens: 20_000 },
      intent: 'spike',
      declaredScripts: {
        test: 'npm test',
        lint: 'npm run lint',
      },
      repoRoot: '/repo',
    };
    expect(input.intent).toBe('spike');
    expect(input.declaredScripts).toBeDefined();
  });

  it('round-trips through JSON without field loss', () => {
    const original: CommissionInput = {
      id: 'rt-1',
      title: 'Round-trip check',
      spec: { nested: true },
      scope: ['src/'],
      budget: { attempts: 1, toolCalls: 5, tokens: 1_000 },
      intent: 'production',
    };
    const roundTripped = JSON.parse(JSON.stringify(original)) as CommissionInput;
    expect(roundTripped).toEqual(original);
  });
});

// ---------------------------------------------------------------------------
// CommissionInput backward-compat: listener.ts re-export
// ---------------------------------------------------------------------------

describe('CommissionInput listener re-export', () => {
  it('is assignable to and from the contract type (structural equality)', () => {
    // If the two types drift apart, this assignment will fail to compile.
    const fromContract: CommissionInput = {
      id: 'x',
      title: 't',
      spec: null,
      scope: [],
      budget: { attempts: 1, toolCalls: 1, tokens: 1 },
    };
    const fromListener: CommissionInputFromListener = fromContract;
    expect(fromListener.id).toBe('x');
  });
});

// ---------------------------------------------------------------------------
// ParkedBrief
// ---------------------------------------------------------------------------

describe('ParkedBrief shape', () => {
  it('constructs with required fields', () => {
    const parked: ParkedBrief = {
      intentId: 'intent-1',
      question: 'Which auth strategy should we use?',
      deadline: Date.now() + 30_000,
    };
    expect(parked.intentId).toBe('intent-1');
    expect(typeof parked.deadline).toBe('number');
  });

  it('round-trips through JSON', () => {
    const original: ParkedBrief = {
      intentId: 'p-1',
      question: 'What is the correct timeout?',
      deadline: 1_700_000_000_000,
    };
    const rt = JSON.parse(JSON.stringify(original)) as ParkedBrief;
    expect(rt).toEqual(original);
  });
});

// ---------------------------------------------------------------------------
// FrontDoorStatus
// ---------------------------------------------------------------------------

describe('FrontDoorStatus shape', () => {
  it('constructs with empty arrays', () => {
    const status: FrontDoorStatus = { running: [], queued: [], parked: [] };
    expect(status.running).toHaveLength(0);
  });

  it('constructs with populated arrays', () => {
    const status: FrontDoorStatus = {
      running: ['intent-1', 'intent-2'],
      queued: ['intent-3'],
      parked: [
        { intentId: 'intent-4', question: 'Proceed?', deadline: 9999999 },
      ],
    };
    expect(status.parked[0]?.intentId).toBe('intent-4');
  });

  it('round-trips through JSON', () => {
    const original: FrontDoorStatus = {
      running: ['r-1'],
      queued: ['q-1'],
      parked: [{ intentId: 'p-1', question: 'Q?', deadline: 123 }],
    };
    const rt = JSON.parse(JSON.stringify(original)) as FrontDoorStatus;
    expect(rt).toEqual(original);
  });
});

// ---------------------------------------------------------------------------
// StandingEnvelope
// ---------------------------------------------------------------------------

describe('StandingEnvelope shape', () => {
  it('constructs with required fields', () => {
    const envelope: StandingEnvelope = {
      budget: { attempts: 10, toolCalls: 100, tokens: 500_000 },
      spendCeilingUsd: 5.0,
    };
    expect(envelope.spendCeilingUsd).toBe(5.0);
  });

  it('round-trips through JSON', () => {
    const original: StandingEnvelope = {
      budget: { attempts: 2, toolCalls: 20, tokens: 10_000 },
      spendCeilingUsd: 1.5,
    };
    const rt = JSON.parse(JSON.stringify(original)) as StandingEnvelope;
    expect(rt).toEqual(original);
  });
});
