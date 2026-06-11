import { describe, it, expect } from 'vitest';
import { projectMemory, traceStats, renderTree, costSummary } from '../../src/eventlog/projections.js';
import type { FactoryEvent } from '../../src/contract/events.js';
import type { MemoryPointer, Usage } from '../../src/contract/goal.js';

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
  it('returns empty query when no memory events', async () => {
    const view = projectMemory([baseGoal()]);
    expect((await view.query('anything', []))).toHaveLength(0);
  });

  it('includes a freshly written memory pointer', async () => {
    const events: FactoryEvent[] = [
      baseGoal(),
      memWritten('m1', 'use dependency injection'),
    ];
    const view = projectMemory(events);
    const results = (await view.query('injection', []));
    expect(results).toHaveLength(1);
    expect(results[0]?.id).toBe('m1');
    expect(results[0]?.provenance).toBe('provisional');
  });

  it('promotes to trusted after 2 success reinforcements', async () => {
    const events: FactoryEvent[] = [
      memWritten('m1', 'prefer small functions'),
      memReinforced('m1', 'success'),
      memReinforced('m1', 'success'),
    ];
    const view = projectMemory(events);
    const results = (await view.query('prefer', []));
    expect(results[0]?.provenance).toBe('trusted');
  });

  it('stays provisional after only 1 success reinforcement', async () => {
    const events: FactoryEvent[] = [
      memWritten('m1', 'prefer small functions'),
      memReinforced('m1', 'success'),
    ];
    const view = projectMemory(events);
    expect((await view.query('prefer', []))[0]?.provenance).toBe('provisional');
  });

  it('evicts memory after 2 failure reinforcements', async () => {
    const events: FactoryEvent[] = [
      memWritten('m1', 'avoid global state'),
      memReinforced('m1', 'failure'),
      memReinforced('m1', 'failure'),
    ];
    const view = projectMemory(events);
    expect((await view.query('global', []))).toHaveLength(0);
  });

  it('does not evict after only 1 failure reinforcement', async () => {
    const events: FactoryEvent[] = [
      memWritten('m1', 'avoid global state'),
      memReinforced('m1', 'failure'),
    ];
    const view = projectMemory(events);
    expect((await view.query('global', []))).toHaveLength(1);
  });

  it('query is case-insensitive', async () => {
    const events: FactoryEvent[] = [memWritten('m1', 'Use SOLID principles')];
    const view = projectMemory(events);
    expect((await view.query('solid', []))).toHaveLength(1);
    expect((await view.query('SOLID', []))).toHaveLength(1);
  });

  it('returns copies so mutations do not affect internal state', async () => {
    const events: FactoryEvent[] = [memWritten('m1', 'immutability matters')];
    const view = projectMemory(events);
    const [p] = (await view.query('immutability', []));
    if (p) (p as Record<string, unknown>)['provenance'] = 'trusted';
    // Query again — internal state should be unchanged.
    expect((await view.query('immutability', []))[0]?.provenance).toBe('provisional');
  });

  it('reinforcement for an evicted memory is a no-op', async () => {
    const events: FactoryEvent[] = [
      memWritten('m1', 'some tip'),
      memReinforced('m1', 'failure'),
      memReinforced('m1', 'failure'), // evicted here
      memReinforced('m1', 'success'), // should not resurrect
    ];
    const view = projectMemory(events);
    expect((await view.query('tip', []))).toHaveLength(0);
  });

  it('rewrite of a memory resets its reinforcement counters', async () => {
    const events: FactoryEvent[] = [
      memWritten('m1', 'pattern alpha'),
      memReinforced('m1', 'success'),
      memReinforced('m1', 'success'), // trusted now
      memWritten('m1', 'pattern alpha updated'), // overwrite — resets to provisional
    ];
    const view = projectMemory(events);
    expect((await view.query('pattern', []))[0]?.provenance).toBe('provisional');
  });
});

// ──────────────────────────────────────────────
// traceStats
// ──────────────────────────────────────────────

describe('traceStats', () => {
  it('returns empty object for no events', async () => {
    expect(traceStats([])).toEqual({});
  });

  it('counts attempts per goal type', async () => {
    const events: FactoryEvent[] = [
      baseGoal({ goalId: 'g1', goalType: 'feature' }),
      baseGoal({ goalId: 'g2', goalType: 'feature' }),
      baseGoal({ goalId: 'g3', goalType: 'test' }),
    ];
    const stats = traceStats(events);
    expect(stats['feature']?.attempts).toBe(2);
    expect(stats['test']?.attempts).toBe(1);
  });

  it('counts deterministic-checked passes and failures', async () => {
    const events: FactoryEvent[] = [
      baseGoal({ goalId: 'g1', goalType: 'feature' }),
      { type: 'deterministic-checked', at: 2000, goalId: 'g1', verdict: verdict(true) },
      { type: 'deterministic-checked', at: 3000, goalId: 'g1', verdict: verdict(false) },
    ];
    const stats = traceStats(events);
    expect(stats['feature']?.passes).toBe(1);
    expect(stats['feature']?.failures).toBe(1);
  });

  it('counts judge-verdict passes and failures', async () => {
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

  it('counts repairs', async () => {
    const events: FactoryEvent[] = [
      baseGoal({ goalId: 'g1', goalType: 'feature' }),
      { type: 'repair-applied', at: 2000, goalId: 'g1', prescriptions: ['fix lint'] },
    ];
    const stats = traceStats(events);
    expect(stats['feature']?.repairs).toBe(1);
  });

  it('counts escalations', async () => {
    const events: FactoryEvent[] = [
      baseGoal({ goalId: 'g1', goalType: 'feature' }),
      { type: 'tier-escalated', at: 2000, goalId: 'g1', from: 'haiku', to: 'sonnet' },
    ];
    const stats = traceStats(events);
    expect(stats['feature']?.escalations).toBe(1);
  });

  it('rolls up multiple goals of the same type', async () => {
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

  it('skips events without a matching goal-received', async () => {
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
  it('returns empty string for no events', async () => {
    expect(renderTree([])).toBe('');
  });

  it('renders a single root node', async () => {
    const events: FactoryEvent[] = [baseGoal({ goalId: 'g1', goalType: 'feature', title: 'Root goal' })];
    const tree = renderTree(events);
    expect(tree).toContain('[feature]');
    expect(tree).toContain('Root goal');
  });

  it('marks emitted goals with ✓', async () => {
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

  it('fix 10 — emitted report with non-empty blockers renders ✗', async () => {
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

  it('fix 10 — clean emitted report renders ✓', async () => {
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

  it('marks blocked goals with ✗', async () => {
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

  it('marks in-flight goals with ◌', async () => {
    const events: FactoryEvent[] = [
      baseGoal({ goalId: 'g1', title: 'In progress' }),
    ];
    const tree = renderTree(events);
    expect(tree).toContain('◌');
  });

  it('renders parent→child indentation', async () => {
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

  it('orders siblings by first-seen position', async () => {
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

// ──────────────────────────────────────────────
// costSummary
// ──────────────────────────────────────────────

function usageOf(p: number, c: number, cost?: number): Usage {
  return cost !== undefined
    ? { promptTokens: p, completionTokens: c, costUsd: cost }
    : { promptTokens: p, completionTokens: c };
}

describe('costSummary', () => {
  it('returns empty tree totals for no usage events', () => {
    const result = costSummary([baseGoal()]);
    expect(result.tree.promptTokens).toBe(0);
    expect(result.tree.completionTokens).toBe(0);
    expect(result.tree.costUsd).toBeUndefined();
    expect(Object.keys(result.byGoal)).toHaveLength(0);
  });

  it('folds produced event usage into per-goal and tree totals', () => {
    const events: FactoryEvent[] = [
      { type: 'produced', at: 100, goalId: 'g1', usage: usageOf(100, 50) },
    ];
    const result = costSummary(events);
    expect(result.byGoal['g1']?.promptTokens).toBe(100);
    expect(result.byGoal['g1']?.completionTokens).toBe(50);
    expect(result.tree.promptTokens).toBe(100);
    expect(result.tree.completionTokens).toBe(50);
  });

  it('folds decided event usage when present', () => {
    const events: FactoryEvent[] = [
      {
        type: 'decided',
        at: 100,
        goalId: 'g1',
        decision: { kind: 'block', brief: { question: 'q', options: [], links: [], deadlineMs: 1000, onTimeout: 'deny' } },
        usage: usageOf(20, 10),
      },
    ];
    const result = costSummary(events);
    expect(result.byGoal['g1']?.promptTokens).toBe(20);
    expect(result.byGoal['g1']?.completionTokens).toBe(10);
    expect(result.tree.promptTokens).toBe(20);
  });

  it('skips decided event with no usage field', () => {
    const events: FactoryEvent[] = [
      {
        type: 'decided',
        at: 100,
        goalId: 'g1',
        decision: { kind: 'block', brief: { question: 'q', options: [], links: [], deadlineMs: 1000, onTimeout: 'deny' } },
      },
    ];
    const result = costSummary(events);
    expect(Object.keys(result.byGoal)).toHaveLength(0);
    expect(result.tree.promptTokens).toBe(0);
  });

  it('folds judge-verdict usage when present', () => {
    const events: FactoryEvent[] = [
      {
        type: 'judge-verdict',
        at: 100,
        goalId: 'g1',
        judgeType: 'code-review',
        verdict: verdict(true),
        tier: 'sonnet',
        usage: usageOf(200, 80),
      },
    ];
    const result = costSummary(events);
    expect(result.byGoal['g1']?.promptTokens).toBe(200);
    expect(result.byGoal['g1']?.completionTokens).toBe(80);
    expect(result.tree.completionTokens).toBe(80);
  });

  it('folds repair-applied usage when present', () => {
    const events: FactoryEvent[] = [
      {
        type: 'repair-applied',
        at: 100,
        goalId: 'g1',
        prescriptions: ['fix types'],
        usage: usageOf(50, 30),
      },
    ];
    const result = costSummary(events);
    expect(result.byGoal['g1']?.promptTokens).toBe(50);
    expect(result.tree.promptTokens).toBe(50);
  });

  it('folds step event usage when present', () => {
    const events: FactoryEvent[] = [
      {
        type: 'step',
        at: 100,
        goalId: 'g1',
        index: 0,
        outputKind: 'tool-calls',
        usage: usageOf(10, 5),
      },
    ];
    const result = costSummary(events);
    expect(result.byGoal['g1']?.promptTokens).toBe(10);
    expect(result.tree.promptTokens).toBe(10);
  });

  it('accumulates costUsd only when events report cost', () => {
    const events: FactoryEvent[] = [
      { type: 'produced', at: 100, goalId: 'g1', usage: usageOf(100, 50, 0.002) },
      { type: 'produced', at: 200, goalId: 'g1', usage: usageOf(100, 50, 0.003) },
    ];
    const result = costSummary(events);
    expect(result.byGoal['g1']?.costUsd).toBeCloseTo(0.005);
    expect(result.tree.costUsd).toBeCloseTo(0.005);
  });

  it('costUsd stays undefined when no event reports cost', () => {
    const events: FactoryEvent[] = [
      { type: 'produced', at: 100, goalId: 'g1', usage: usageOf(100, 50) },
      { type: 'produced', at: 200, goalId: 'g1', usage: usageOf(200, 100) },
    ];
    const result = costSummary(events);
    expect(result.byGoal['g1']?.costUsd).toBeUndefined();
    expect(result.tree.costUsd).toBeUndefined();
  });

  it('accumulates across multiple goals for tree total', () => {
    const events: FactoryEvent[] = [
      { type: 'produced', at: 100, goalId: 'g1', usage: usageOf(100, 50) },
      { type: 'produced', at: 200, goalId: 'g2', usage: usageOf(200, 100) },
    ];
    const result = costSummary(events);
    expect(result.byGoal['g1']?.promptTokens).toBe(100);
    expect(result.byGoal['g2']?.promptTokens).toBe(200);
    expect(result.tree.promptTokens).toBe(300);
    expect(result.tree.completionTokens).toBe(150);
  });

  it('per-goal totals match summed usage fields exactly', () => {
    const events: FactoryEvent[] = [
      { type: 'produced', at: 100, goalId: 'g1', usage: usageOf(100, 40) },
      {
        type: 'judge-verdict',
        at: 200,
        goalId: 'g1',
        judgeType: 'review',
        verdict: verdict(false),
        tier: 'haiku',
        usage: usageOf(60, 20),
      },
      {
        type: 'repair-applied',
        at: 300,
        goalId: 'g1',
        prescriptions: [],
        usage: usageOf(30, 10),
      },
    ];
    const result = costSummary(events);
    expect(result.byGoal['g1']?.promptTokens).toBe(190);
    expect(result.byGoal['g1']?.completionTokens).toBe(70);
    expect(result.tree.promptTokens).toBe(190);
    expect(result.tree.completionTokens).toBe(70);
  });

  it('mixed cost/no-cost: costUsd accumulates only from reporting events', () => {
    const events: FactoryEvent[] = [
      { type: 'produced', at: 100, goalId: 'g1', usage: usageOf(100, 50) },
      { type: 'produced', at: 200, goalId: 'g1', usage: usageOf(100, 50, 0.004) },
    ];
    const result = costSummary(events);
    expect(result.byGoal['g1']?.costUsd).toBeCloseTo(0.004);
    expect(result.tree.costUsd).toBeCloseTo(0.004);
    expect(result.byGoal['g1']?.promptTokens).toBe(200);
  });
});
