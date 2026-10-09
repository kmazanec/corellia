import { describe, expect, it } from 'vitest';

import type { FactoryEvent } from '../../src/contract/events.js';
import { projectGoalTree, renderTree } from '../../src/eventlog/goal-tree.js';

const received = (goalId: string, parentId: string | null, at = 1): FactoryEvent => ({
  type: 'goal-received',
  at,
  goalId,
  goal: {
    id: goalId,
    type: parentId === null ? 'feature' : 'implement',
    parentId,
    title: `goal ${goalId}`,
    spec: {},
    intent: 'production',
    scope: [],
    budget: { attempts: 1, tokens: 1, toolCalls: 1, wallClockMs: 1 },
    memories: [],
  },
});

const emitted = (goalId: string, blockers: string[] = [], at = 9): FactoryEvent => ({
  type: 'emitted',
  at,
  goalId,
  report: { artifact: null, proof: [], lessons: [], memoriesUsed: [], blockers, findings: [], learned: '' },
});

const brief = { question: 'q', options: [], links: [], deadlineMs: 1, onTimeout: 'park' as const };

describe('projectGoalTree', () => {
  it('nests goals by parentId in first-received order', () => {
    const tree = projectGoalTree([received('r', null), received('b', 'r'), received('a', 'r'), received('a1', 'a')]);
    expect(tree).toHaveLength(1);
    expect(tree[0]!.children.map((c) => c.goalId)).toEqual(['b', 'a']);
    expect(tree[0]!.children[1]!.children.map((c) => c.goalId)).toEqual(['a1']);
  });

  it('derives each goal state from the log', () => {
    const [root] = projectGoalTree([
      received('r', null),
      received('ok', 'r'),
      emitted('ok'),
      received('bad', 'r'),
      emitted('bad', ['boom']),
      received('stuck', 'r'),
      { type: 'blocked', at: 3, goalId: 'stuck', brief, resolution: 'deny' },
      received('waiting', 'r'),
      { type: 'parked', at: 3, goalId: 'waiting', brief, ttlMs: 1 },
      received('back', 'r'),
      { type: 'parked', at: 3, goalId: 'back', brief, ttlMs: 1 },
      { type: 'resumed', at: 4, goalId: 'back', answer: 'go' },
    ]);
    const states = Object.fromEntries(root!.children.map((c) => [c.goalId, c.state]));
    expect(states).toEqual({ ok: 'done', bad: 'failed', stuck: 'blocked', waiting: 'parked', back: 'running' });
    expect(root!.state).toBe('running');
    expect(root!.children[0]!.endedAt).toBe(9);
  });

  it('takes the latest lifecycle event, so an answered goal runs again', () => {
    const [root] = projectGoalTree([
      received('r', null),
      { type: 'blocked', at: 2, goalId: 'r', brief, resolution: 'park' },
      { type: 'parked', at: 2, goalId: 'r', brief, ttlMs: 1 },
      emitted('r', ['parked'], 3),
      { type: 'resumed', at: 4, goalId: 'r', answer: 'go' },
      emitted('r', [], 5),
      received('r', null, 6),
    ]);
    expect(root!.state).toBe('running');
    expect(root!.endedAt).toBeUndefined();
    expect(root!.startedAt).toBe(1);
  });

  it('treats a goal whose parent is absent as a root', () => {
    const tree = projectGoalTree([received('r', null), received('orphan', 'missing')]);
    expect(tree.map((n) => n.goalId)).toEqual(['r', 'orphan']);
  });
});

describe('renderTree', () => {
  it('renders the projected tree as indented glyph lines', () => {
    const out = renderTree([received('r', null), received('c', 'r'), emitted('c'), emitted('r', ['x'])]);
    expect(out).toBe('✗ [feature] goal r\n  ✓ [implement] goal c');
  });
});
