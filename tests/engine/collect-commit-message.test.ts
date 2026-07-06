/**
 * Tests for the collect commit message derivation (issue D1).
 *
 * Purely mechanical: subject from the root goal's intent (title) + a
 * conventional scope hint from its declared scope; body listing contributing
 * goals. No LLM, no git.
 */

import { describe, it, expect } from 'vitest';
import { deriveCollectCommitMessage } from '../../src/engine/collect-commit-message.js';
import type { Goal } from '../../src/contract/goal.js';

function makeGoal(overrides: Partial<Goal>): Goal {
  return {
    id: 'root-1',
    type: 'deliver-intent',
    parentId: null,
    title: 'Add a dark-mode toggle to the settings page',
    spec: {},
    intent: 'production',
    scope: ['src/settings/**'],
    budget: { attempts: 3, tokens: 1000, toolCalls: 10, wallClockMs: 1000 },
    memories: [],
    ...overrides,
  };
}

describe('deriveCollectCommitMessage — subject', () => {
  it('derives a conventional subject: feat(<scope-hint>): <intent>', () => {
    const { subject } = deriveCollectCommitMessage(makeGoal({}), []);
    expect(subject).toBe('feat(settings): Add a dark-mode toggle to the settings page');
  });

  it('skips a generic src/ root in favor of the meaningful segment below it', () => {
    const { subject } = deriveCollectCommitMessage(
      makeGoal({ scope: ['src/tax/engine.ts'], title: 'Correct the 2025 standard deduction' }),
      [],
    );
    expect(subject).toBe('feat(tax): Correct the 2025 standard deduction');
  });

  it('handles a bare top-level scope like public/', () => {
    const { subject } = deriveCollectCommitMessage(
      makeGoal({ scope: ['public/'], title: 'Ship the marketing hero' }),
      [],
    );
    expect(subject).toBe('feat(public): Ship the marketing hero');
  });

  it('falls back to the goal type when no scope is declared', () => {
    const { subject } = deriveCollectCommitMessage(
      makeGoal({ scope: [], type: 'deliver-intent', title: 'Do the thing' }),
      [],
    );
    expect(subject).toBe('feat(deliver-intent): Do the thing');
  });

  it('truncates a long intent to a single capped line', () => {
    const long = 'A'.repeat(200);
    const { subject } = deriveCollectCommitMessage(makeGoal({ title: long }), []);
    // feat(settings):  + up to 72 chars of intent, ellipsized.
    const intentPart = subject.replace('feat(settings): ', '');
    expect(intentPart.length).toBeLessThanOrEqual(72);
    expect(intentPart.endsWith('…')).toBe(true);
  });

  it('takes only the first line of a multi-line title', () => {
    const { subject } = deriveCollectCommitMessage(
      makeGoal({ title: 'First line summary\nsecond line detail' }),
      [],
    );
    expect(subject).toBe('feat(settings): First line summary');
  });
});

describe('deriveCollectCommitMessage — body', () => {
  it('lists each contributing goal (id, type, title)', () => {
    const { body } = deriveCollectCommitMessage(makeGoal({}), [
      { id: 'root-1', title: 'Add a dark-mode toggle', type: 'deliver-intent' },
      { id: 'child-2', title: 'Wire the toggle state', type: 'implement' },
    ]);
    expect(body).toContain('root-1 (deliver-intent): Add a dark-mode toggle');
    expect(body).toContain('child-2 (implement): Wire the toggle state');
  });

  it('handles an empty contributing list without throwing', () => {
    const { body } = deriveCollectCommitMessage(makeGoal({}), []);
    expect(body).toContain('none recorded');
  });
});
