import { describe, it, expect } from 'vitest';
import { projectMemory, traceStats, renderTree } from '../../src/eventlog/projections.js';
import type { FactoryEvent } from '../../src/contract/events.js';
import type { MemoryPointer } from '../../src/contract/goal.js';

// ──────────────────────────────────────────────
// Shared test helpers
// ──────────────────────────────────────────────

const baseGoal = (overrides: Partial<{
  goalId: string;
  goalType: string;
  parentId: string | null;
  title: string;
}> = {}): FactoryEvent => ({
  type: 'goal-received',
  at: 1000,
  goalId: overrides.goalId ?? 'g1',
  goal: {
    id: overrides.goalId ?? 'g1',
    type: overrides.goalType ?? 'feature',
    parentId: overrides.parentId ?? null,
    title: overrides.title ?? 'Root goal',
    spec: {},
    intent: 'production',
    scope: [],
    budget: { attempts: 3, tokens: 5000, toolCalls: 20, wallClockMs: 60000 },
    memories: [],
  },
});

const memWritten = (id: string, content: string): FactoryEvent => ({
  type: 'memory-written',
  at: 100,
  goalId: 'g1',
  pointer: {
    id,
    layer: 'type',
    content,
    provenance: 'provisional',
  } satisfies MemoryPointer,
});

const memReinforced = (memoryId: string, outcome: 'success' | 'failure'): FactoryEvent => ({
  type: 'memory-reinforced',
  at: 200,
  goalId: 'g1',
  memoryId,
  outcome,
});

const verdict = (pass: boolean) => ({
  pass,
  findings: [],
});

// ──────────────────────────────────────────────
// projectMemory
// ──────────────────────────────────────────────

describe('projectMemory', () => {
  it('returns empty query when no memory events', () => {
    const view = projectMemory([baseGoal()]);
    expect(view.query('anything', [])).toHaveLength(0);
  });

  it('includes a freshly written memory pointer', () => {
    const events: FactoryEvent[] = [
      baseGoal(),
      memWritten('m1', 'use dependency injection'),
    ];
    const view = projectMemory(events);
    const results = view.query('injection', []);
    expect(results).toHaveLength(1);
    expect(results[0]?.id).toBe('m1');
    expect(results[0]?.provenance).toBe('provisional');
  });

  it('promotes to trusted after 2 success reinforcements', () => {
    const events: FactoryEvent[] = [
      memWritten('m1', 'prefer small functions'),
      memReinforced('m1', 'success'),
      memReinforced('m1', 'success'),
    ];
    const view = projectMemory(events);
    const results = view.query('prefer', []);
    expect(results[0]?.provenance).toBe('trusted');
  });

  it('stays provisional after only 1 success reinforcement', () => {
    const events: FactoryEvent[] = [
      memWritten('m1', 'prefer small functions'),
      memReinforced('m1', 'success'),
    ];
    const view = projectMemory(events);
    expect(view.query('prefer', [])[0]?.provenance).toBe('provisional');
  });

  it('evicts memory after 2 failure reinforcements', () => {
    const events: FactoryEvent[] = [
      memWritten('m1', 'avoid global state'),
      memReinforced('m1', 'failure'),
      memReinforced('m1', 'failure'),
    ];
    const view = projectMemory(events);
    expect(view.query('global', [])).toHaveLength(0);
  });

  it('does not evict after only 1 failure reinforcement', () => {
    const events: FactoryEvent[] = [
      memWritten('m1', 'avoid global state'),
      memReinforced('m1', 'failure'),
    ];
    const view = projectMemory(events);
    expect(view.query('global', [])).toHaveLength(1);
  });

  it('query is case-insensitive', () => {
    const events: FactoryEvent[] = [memWritten('m1', 'Use SOLID principles')];
    const view = projectMemory(events);
    expect(view.query('solid', [])).toHaveLength(1);
    expect(view.query('SOLID', [])).toHaveLength(1);
  });

  it('returns copies so mutations do not affect internal state', () => {
    const events: FactoryEvent[] = [memWritten('m1', 'immutability matters')];
    const view = projectMemory(events);
    const [p] = view.query('immutability', []);
    if (p) (p as Record<string, unknown>)['provenance'] = 'trusted';
    // Query again — internal state should be unchanged.
    expect(view.query('immutability', [])[0]?.provenance).toBe('provisional');
  });

  it('reinforcement for an evicted memory is a no-op', () => {
    const events: FactoryEvent[] = [
      memWritten('m1', 'some tip'),
      memReinforced('m1', 'failure'),
      memReinforced('m1', 'failure'), // evicted here
      memReinforced('m1', 'success'), // should not resurrect
    ];
    const view = projectMemory(events);
    expect(view.query('tip', [])).toHaveLength(0);
  });

  it('rewrite of a memory resets its reinforcement counters', () => {
    const events: FactoryEvent[] = [
      memWritten('m1', 'pattern alpha'),
      memReinforced('m1', 'success'),
      memReinforced('m1', 'success'), // trusted now
      memWritten('m1', 'pattern alpha updated'), // overwrite — resets to provisional
    ];
    const view = projectMemory(events);
    expect(view.query('pattern', [])[0]?.provenance).toBe('provisional');
  });
});

// ──────────────────────────────────────────────
// traceStats
// ──────────────────────────────────────────────

describe('traceStats', () => {
  it('returns empty object for no events', () => {
    expect(traceStats([])).toEqual({});
  });

  it('counts attempts per goal type', () => {
    const events: FactoryEvent[] = [
      baseGoal({ goalId: 'g1', goalType: 'feature' }),
      baseGoal({ goalId: 'g2', goalType: 'feature' }),
      baseGoal({ goalId: 'g3', goalType: 'test' }),
    ];
    const stats = traceStats(events);
    expect(stats['feature']?.attempts).toBe(2);
    expect(stats['test']?.attempts).toBe(1);
  });

  it('counts deterministic-checked passes and failures', () => {
    const events: FactoryEvent[] = [
      baseGoal({ goalId: 'g1', goalType: 'feature' }),
      { type: 'deterministic-checked', at: 2000, goalId: 'g1', verdict: verdict(true) },
      { type: 'deterministic-checked', at: 3000, goalId: 'g1', verdict: verdict(false) },
    ];
    const stats = traceStats(events);
    expect(stats['feature']?.passes).toBe(1);
    expect(stats['feature']?.failures).toBe(1);
  });

  it('counts judge-verdict passes and failures', () => {
    const events: FactoryEvent[] = [
      baseGoal({ goalId: 'g1', goalType: 'make' }),
      {
        type: 'judge-verdict',
        at: 2000,
        goalId: 'g1',
        judgeType: 'code-review',
        verdict: verdict(false),
        tier: 'sonnet',
      },
    ];
    const stats = traceStats(events);
    expect(stats['make']?.failures).toBe(1);
    expect(stats['make']?.passes).toBe(0);
  });

  it('counts repairs', () => {
    const events: FactoryEvent[] = [
      baseGoal({ goalId: 'g1', goalType: 'feature' }),
      { type: 'repair-applied', at: 2000, goalId: 'g1', prescriptions: ['fix lint'] },
    ];
    const stats = traceStats(events);
    expect(stats['feature']?.repairs).toBe(1);
  });

  it('counts escalations', () => {
    const events: FactoryEvent[] = [
      baseGoal({ goalId: 'g1', goalType: 'feature' }),
      { type: 'tier-escalated', at: 2000, goalId: 'g1', from: 'haiku', to: 'sonnet' },
    ];
    const stats = traceStats(events);
    expect(stats['feature']?.escalations).toBe(1);
  });

  it('rolls up multiple goals of the same type', () => {
    const events: FactoryEvent[] = [
      baseGoal({ goalId: 'g1', goalType: 'feature' }),
      baseGoal({ goalId: 'g2', goalType: 'feature' }),
      { type: 'repair-applied', at: 2000, goalId: 'g1', prescriptions: [] },
      { type: 'repair-applied', at: 2100, goalId: 'g2', prescriptions: [] },
      { type: 'tier-escalated', at: 2200, goalId: 'g2', from: 'haiku', to: 'sonnet' },
    ];
    const stats = traceStats(events);
    expect(stats['feature']?.attempts).toBe(2);
    expect(stats['feature']?.repairs).toBe(2);
    expect(stats['feature']?.escalations).toBe(1);
  });

  it('skips events without a matching goal-received', () => {
    const events: FactoryEvent[] = [
      { type: 'repair-applied', at: 2000, goalId: 'orphan', prescriptions: [] },
    ];
    const stats = traceStats(events);
    expect(Object.keys(stats)).toHaveLength(0);
  });
});

// ──────────────────────────────────────────────
// renderTree
// ──────────────────────────────────────────────

describe('renderTree', () => {
  it('returns empty string for no events', () => {
    expect(renderTree([])).toBe('');
  });

  it('renders a single root node', () => {
    const events: FactoryEvent[] = [baseGoal({ goalId: 'g1', goalType: 'feature', title: 'Root goal' })];
    const tree = renderTree(events);
    expect(tree).toContain('[feature]');
    expect(tree).toContain('Root goal');
  });

  it('marks emitted goals with ✓', () => {
    const events: FactoryEvent[] = [
      baseGoal({ goalId: 'g1', goalType: 'feature', title: 'Ship it' }),
      {
        type: 'emitted',
        at: 5000,
        goalId: 'g1',
        report: {
          artifact: null,
          proof: [],
          lessons: [],
          memoriesUsed: [],
          blockers: [],
          findings: [],
          learned: '',
        },
      },
    ];
    const tree = renderTree(events);
    expect(tree).toContain('✓');
    expect(tree).toContain('Ship it');
  });

  it('fix 10 — emitted report with non-empty blockers renders ✗', () => {
    const events: FactoryEvent[] = [
      baseGoal({ goalId: 'g1', goalType: 'feature', title: 'Failed goal' }),
      {
        type: 'emitted',
        at: 5000,
        goalId: 'g1',
        report: {
          artifact: null,
          proof: [],
          lessons: [],
          memoriesUsed: [],
          blockers: ['something went wrong'],
          findings: [],
          learned: '',
        },
      },
    ];
    const tree = renderTree(events);
    expect(tree).toContain('✗');
    expect(tree).not.toContain('✓');
  });

  it('fix 10 — clean emitted report renders ✓', () => {
    const events: FactoryEvent[] = [
      baseGoal({ goalId: 'g1', goalType: 'feature', title: 'Clean goal' }),
      {
        type: 'emitted',
        at: 5000,
        goalId: 'g1',
        report: {
          artifact: null,
          proof: [],
          lessons: [],
          memoriesUsed: [],
          blockers: [],
          findings: [],
          learned: '',
        },
      },
    ];
    const tree = renderTree(events);
    expect(tree).toContain('✓');
    expect(tree).not.toContain('✗');
  });

  it('marks blocked goals with ✗', () => {
    const events: FactoryEvent[] = [
      baseGoal({ goalId: 'g1', goalType: 'feature', title: 'Risky change' }),
      {
        type: 'blocked',
        at: 3000,
        goalId: 'g1',
        brief: { question: 'Proceed?', options: ['yes', 'no'], links: [], deadlineMs: 60000, onTimeout: 'deny' },
        resolution: 'deny',
      },
    ];
    const tree = renderTree(events);
    expect(tree).toContain('✗');
  });

  it('marks in-flight goals with ◌', () => {
    const events: FactoryEvent[] = [
      baseGoal({ goalId: 'g1', title: 'In progress' }),
    ];
    const tree = renderTree(events);
    expect(tree).toContain('◌');
  });

  it('renders parent→child indentation', () => {
    const events: FactoryEvent[] = [
      baseGoal({ goalId: 'g1', goalType: 'feature', title: 'Parent' }),
      baseGoal({ goalId: 'g2', goalType: 'test', parentId: 'g1', title: 'Child' }),
    ];
    const lines = renderTree(events).split('\n');
    const parentLine = lines.find((l) => l.includes('Parent'));
    const childLine = lines.find((l) => l.includes('Child'));
    expect(parentLine).toBeDefined();
    expect(childLine).toBeDefined();
    // Child line should start with more whitespace than parent.
    const parentIndent = parentLine!.length - parentLine!.trimStart().length;
    const childIndent = childLine!.length - childLine!.trimStart().length;
    expect(childIndent).toBeGreaterThan(parentIndent);
  });

  it('orders siblings by first-seen position', () => {
    const events: FactoryEvent[] = [
      baseGoal({ goalId: 'root', title: 'Root' }),
      baseGoal({ goalId: 'c1', goalType: 'alpha', parentId: 'root', title: 'Alpha child' }),
      baseGoal({ goalId: 'c2', goalType: 'beta', parentId: 'root', title: 'Beta child' }),
    ];
    const tree = renderTree(events);
    const alphaPos = tree.indexOf('Alpha child');
    const betaPos = tree.indexOf('Beta child');
    expect(alphaPos).toBeLessThan(betaPos);
  });
});
