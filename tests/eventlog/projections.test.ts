import { describe, it, expect } from 'vitest';
import { projectMemory, traceStats, renderTree, costSummary, projectKnowledge, goldenCandidates, labeledGoldenCandidates, projectPatternTrust } from '../../src/eventlog/projections.js';
import { writeKnowledge, writeRegionFacts, recordKnowledgeCheck } from '../../src/library/knowledge.js';
import { InMemoryEventStore } from '../../src/eventlog/memory-store.js';
import type { FactoryEvent } from '../../src/contract/events.js';
import type { MemoryPointer, Usage } from '../../src/contract/goal.js';
import type { KnowledgeArtifact, RegionFacts, DiveFact } from '../../src/contract/knowledge.js';

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

describe('projectPatternTrust', () => {
  it('projects recorded patterns as provisional and signed patterns as trusted', () => {
    const events: FactoryEvent[] = [
      { type: 'pattern-recorded', at: 1, goalId: 'g1', shape: 'shape-a', outcome: 'success' },
      {
        type: 'pattern-trust-signed',
        at: 2,
        goalId: 'g1',
        shape: 'shape-a',
        from: 'provisional',
        to: 'trusted',
        signer: 'keith',
        rationale: 'proved useful',
      },
    ];

    expect(projectPatternTrust(events).get('shape-a')).toBe('trusted');
  });

  it('can project trust at an earlier replay prefix', () => {
    const events: FactoryEvent[] = [
      { type: 'pattern-recorded', at: 1, goalId: 'g1', shape: 'shape-a', outcome: 'success' },
      {
        type: 'pattern-trust-signed',
        at: 2,
        goalId: 'g1',
        shape: 'shape-a',
        from: 'provisional',
        to: 'trusted',
        signer: 'keith',
        rationale: 'proved useful',
      },
    ];

    expect(projectPatternTrust(events, { upToIndex: 1 }).get('shape-a')).toBe('provisional');
    expect(projectPatternTrust(events, { upToIndex: 2 }).get('shape-a')).toBe('trusted');
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
        tier: 'mid',
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
      { type: 'tier-escalated', at: 2000, goalId: 'g1', from: 'low', to: 'mid' },
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
      { type: 'tier-escalated', at: 2200, goalId: 'g2', from: 'low', to: 'mid' },
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
        tier: 'mid',
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
        tier: 'low',
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

// ──────────────────────────────────────────────
// projectKnowledge
// ──────────────────────────────────────────────

/** Build a minimal KnowledgeArtifact for tests. */
function makeArtifact(overrides: Partial<KnowledgeArtifact> = {}): KnowledgeArtifact {
  return {
    repoRoot: '/repo/alpha',
    category: 'architecture',
    generatedAtSha: 'abc123',
    confidence: 'high',
    status: 'provisional',
    pointers: [],
    summary: 'Overview of architecture',
    ...overrides,
  };
}

/** Build a minimal RegionFacts for tests. */
function makeRegionFacts(overrides: Partial<RegionFacts> = {}): RegionFacts {
  return {
    repoRoot: '/repo/alpha',
    region: 'src/core',
    generatedAtSha: 'abc123',
    facts: [],
    ...overrides,
  };
}

/** Wrap a KnowledgeArtifact as a knowledge-written FactoryEvent. */
function knowledgeWritten(artifact: KnowledgeArtifact, goalId = 'g1'): FactoryEvent {
  return { type: 'knowledge-written', at: Date.now(), goalId, artifact };
}

/** Wrap a RegionFacts as a knowledge-facts-written FactoryEvent. */
function factsWritten(facts: RegionFacts, goalId = 'g1'): FactoryEvent {
  return { type: 'knowledge-facts-written', at: Date.now(), goalId, facts };
}

describe('projectKnowledge', () => {
  it('returns empty maps when no knowledge events are present', () => {
    const view = projectKnowledge([baseGoal()]);
    expect(view.artifacts.size).toBe(0);
    expect(view.diveFacts.size).toBe(0);
  });

  it('records an artifact as fresh after a knowledge-written event', () => {
    const artifact = makeArtifact();
    const view = projectKnowledge([knowledgeWritten(artifact)]);
    const key = `${artifact.repoRoot}::${artifact.category}`;
    const entry = view.artifacts.get(key);
    expect(entry).toBeDefined();
    expect(entry?.artifact.category).toBe('architecture');
    expect(entry?.freshness).toBe('fresh');
  });

  it('latest knowledge-written replaces earlier artifact for the same repo × category', () => {
    const first = makeArtifact({ generatedAtSha: 'sha-first', summary: 'first' });
    const second = makeArtifact({ generatedAtSha: 'sha-second', summary: 'second' });
    const view = projectKnowledge([knowledgeWritten(first), knowledgeWritten(second)]);
    const key = `${first.repoRoot}::${first.category}`;
    expect(view.artifacts.get(key)?.artifact.generatedAtSha).toBe('sha-second');
    expect(view.artifacts.size).toBe(1);
  });

  it('keeps artifacts for different categories under distinct keys', () => {
    const arch = makeArtifact({ category: 'architecture' });
    const stack = makeArtifact({ category: 'stack' });
    const view = projectKnowledge([knowledgeWritten(arch), knowledgeWritten(stack)]);
    expect(view.artifacts.size).toBe(2);
  });

  it('knowledge-checked with stale-validated updates freshness to stale-validated', () => {
    const artifact = makeArtifact();
    const events: FactoryEvent[] = [
      knowledgeWritten(artifact),
      {
        type: 'knowledge-checked',
        at: Date.now(),
        goalId: 'g1',
        repoRoot: artifact.repoRoot,
        category: artifact.category,
        sha: 'head-sha',
        outcome: 'stale-validated',
      },
    ];
    const view = projectKnowledge(events);
    const key = `${artifact.repoRoot}::${artifact.category}`;
    expect(view.artifacts.get(key)?.freshness).toBe('stale-validated');
  });

  it('knowledge-checked with invalid marks the artifact invalid', () => {
    const artifact = makeArtifact();
    const events: FactoryEvent[] = [
      knowledgeWritten(artifact),
      {
        type: 'knowledge-checked',
        at: Date.now(),
        goalId: 'g1',
        repoRoot: artifact.repoRoot,
        category: artifact.category,
        sha: 'head-sha',
        outcome: 'invalid',
      },
    ];
    const view = projectKnowledge(events);
    const key = `${artifact.repoRoot}::${artifact.category}`;
    expect(view.artifacts.get(key)?.freshness).toBe('invalid');
  });

  it('a subsequent knowledge-written after invalid restores freshness to fresh', () => {
    const artifact = makeArtifact();
    const refreshed = makeArtifact({ generatedAtSha: 'new-sha' });
    const events: FactoryEvent[] = [
      knowledgeWritten(artifact),
      {
        type: 'knowledge-checked',
        at: Date.now(),
        goalId: 'g1',
        repoRoot: artifact.repoRoot,
        category: artifact.category,
        sha: 'head-sha',
        outcome: 'invalid',
      },
      knowledgeWritten(refreshed),
    ];
    const view = projectKnowledge(events);
    const key = `${artifact.repoRoot}::${artifact.category}`;
    expect(view.artifacts.get(key)?.freshness).toBe('fresh');
    expect(view.artifacts.get(key)?.artifact.generatedAtSha).toBe('new-sha');
  });

  it('freshness moves in both directions via checked events alone — invalid then stale-validated', () => {
    const artifact = makeArtifact();
    const events: FactoryEvent[] = [
      knowledgeWritten(artifact),
      {
        type: 'knowledge-checked',
        at: Date.now(),
        goalId: 'g1',
        repoRoot: artifact.repoRoot,
        category: artifact.category,
        sha: 'sha-v1',
        outcome: 'invalid',
      },
      {
        type: 'knowledge-checked',
        at: Date.now(),
        goalId: 'g1',
        repoRoot: artifact.repoRoot,
        category: artifact.category,
        sha: 'sha-v2',
        outcome: 'stale-validated',
      },
    ];
    const key = `${artifact.repoRoot}::${artifact.category}`;

    // After write: fresh
    const atWrite = projectKnowledge(events.slice(0, 1));
    expect(atWrite.artifacts.get(key)?.freshness).toBe('fresh');

    // After invalid check: invalid
    const atInvalid = projectKnowledge(events.slice(0, 2));
    expect(atInvalid.artifacts.get(key)?.freshness).toBe('invalid');

    // After stale-validated check (no rewrite): stale-validated — freshness moved forward without a new artifact
    const atStaleValidated = projectKnowledge(events);
    expect(atStaleValidated.artifacts.get(key)?.freshness).toBe('stale-validated');
    // Artifact itself is unchanged — same SHA, same summary
    expect(atStaleValidated.artifacts.get(key)?.artifact.generatedAtSha).toBe(artifact.generatedAtSha);
  });

  it('knowledge-checked before any artifact for that key is a no-op', () => {
    const events: FactoryEvent[] = [
      {
        type: 'knowledge-checked',
        at: Date.now(),
        goalId: 'g1',
        repoRoot: '/repo/alpha',
        category: 'architecture',
        sha: 'some-sha',
        outcome: 'invalid',
      },
    ];
    const view = projectKnowledge(events);
    expect(view.artifacts.size).toBe(0);
  });

  it('point-in-time replay reconstructs exactly by slicing the log', () => {
    const artifact = makeArtifact();
    const refreshed = makeArtifact({ generatedAtSha: 'new-sha' });
    const invalidCheck: FactoryEvent = {
      type: 'knowledge-checked',
      at: Date.now(),
      goalId: 'g1',
      repoRoot: artifact.repoRoot,
      category: artifact.category,
      sha: 'head-sha',
      outcome: 'invalid',
    };
    const allEvents: FactoryEvent[] = [
      knowledgeWritten(artifact),
      invalidCheck,
      knowledgeWritten(refreshed),
    ];
    // At index 1 (just after initial write): fresh
    const atWrite = projectKnowledge(allEvents.slice(0, 1));
    const key = `${artifact.repoRoot}::${artifact.category}`;
    expect(atWrite.artifacts.get(key)?.freshness).toBe('fresh');

    // At index 2 (after the check): invalid
    const atCheck = projectKnowledge(allEvents.slice(0, 2));
    expect(atCheck.artifacts.get(key)?.freshness).toBe('invalid');

    // At index 3 (after refresh): fresh again
    const atRefresh = projectKnowledge(allEvents.slice(0, 3));
    expect(atRefresh.artifacts.get(key)?.freshness).toBe('fresh');
    expect(atRefresh.artifacts.get(key)?.artifact.generatedAtSha).toBe('new-sha');
  });

  it('dive facts round-trip with file:line anchors and SHA intact', () => {
    const fact: DiveFact = {
      claim: 'All requests pass through middleware',
      anchors: [{ path: 'src/middleware.ts', line: 42 }],
      sha: 'abc123',
      confidence: 'high',
    };
    const regionFacts = makeRegionFacts({ facts: [fact] });
    const view = projectKnowledge([factsWritten(regionFacts)]);
    const key = `${regionFacts.repoRoot}::${regionFacts.region}`;
    const stored = view.diveFacts.get(key);
    expect(stored).toBeDefined();
    expect(stored?.generatedAtSha).toBe('abc123');
    expect(stored?.facts[0]?.claim).toBe('All requests pass through middleware');
    expect(stored?.facts[0]?.anchors[0]?.path).toBe('src/middleware.ts');
    expect(stored?.facts[0]?.anchors[0]?.line).toBe(42);
    expect(stored?.facts[0]?.sha).toBe('abc123');
  });

  it('latest knowledge-facts-written replaces earlier facts for the same repo × region', () => {
    const first = makeRegionFacts({ generatedAtSha: 'sha-v1' });
    const second = makeRegionFacts({ generatedAtSha: 'sha-v2' });
    const view = projectKnowledge([factsWritten(first), factsWritten(second)]);
    const key = `${first.repoRoot}::${first.region}`;
    expect(view.diveFacts.get(key)?.generatedAtSha).toBe('sha-v2');
    expect(view.diveFacts.size).toBe(1);
  });

  it('artifacts for different repos are kept independently', () => {
    const alpha = makeArtifact({ repoRoot: '/repo/alpha' });
    const beta = makeArtifact({ repoRoot: '/repo/beta' });
    const view = projectKnowledge([knowledgeWritten(alpha), knowledgeWritten(beta)]);
    expect(view.artifacts.size).toBe(2);
    expect(view.artifacts.get('/repo/alpha::architecture')?.artifact.repoRoot).toBe('/repo/alpha');
    expect(view.artifacts.get('/repo/beta::architecture')?.artifact.repoRoot).toBe('/repo/beta');
  });
});

// ──────────────────────────────────────────────
// write helpers
// ──────────────────────────────────────────────

describe('writeKnowledge', () => {
  it('appends a knowledge-written event that the projection sees as fresh', async () => {
    const store = new InMemoryEventStore();
    const artifact = makeArtifact();
    await writeKnowledge(store, 'g1', artifact);

    const events = await store.list();
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('knowledge-written');

    const view = projectKnowledge(events);
    const key = `${artifact.repoRoot}::${artifact.category}`;
    expect(view.artifacts.get(key)?.freshness).toBe('fresh');
    expect(view.artifacts.get(key)?.artifact.generatedAtSha).toBe(artifact.generatedAtSha);
  });

  it('uses the supplied goalId on the appended event', async () => {
    const store = new InMemoryEventStore();
    await writeKnowledge(store, 'goal-xyz', makeArtifact());

    const events = await store.list();
    expect(events[0]?.goalId).toBe('goal-xyz');
  });
});

describe('writeRegionFacts', () => {
  it('appends a knowledge-facts-written event with anchors intact', async () => {
    const store = new InMemoryEventStore();
    const facts = makeRegionFacts({
      facts: [{ claim: 'No global state', anchors: [{ path: 'src/state.ts', line: 10 }], sha: 'abc', confidence: 'medium' }],
    });
    await writeRegionFacts(store, 'g1', facts);

    const events = await store.list();
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('knowledge-facts-written');

    const view = projectKnowledge(events);
    const key = `${facts.repoRoot}::${facts.region}`;
    const stored = view.diveFacts.get(key);
    expect(stored?.facts[0]?.claim).toBe('No global state');
    expect(stored?.facts[0]?.anchors[0]?.line).toBe(10);
  });
});

describe('recordKnowledgeCheck', () => {
  it('appends a knowledge-checked event that updates artifact freshness', async () => {
    const store = new InMemoryEventStore();
    const artifact = makeArtifact();
    await writeKnowledge(store, 'g1', artifact);
    await recordKnowledgeCheck(store, 'g1', {
      repoRoot: artifact.repoRoot,
      category: artifact.category,
      sha: 'new-head',
      outcome: 'invalid',
    });

    const events = await store.list();
    expect(events).toHaveLength(2);
    expect(events[1]?.type).toBe('knowledge-checked');

    const view = projectKnowledge(events);
    const key = `${artifact.repoRoot}::${artifact.category}`;
    expect(view.artifacts.get(key)?.freshness).toBe('invalid');
  });

  it('all three outcomes are accepted by the store without type errors', async () => {
    const store = new InMemoryEventStore();
    const artifact = makeArtifact();
    await writeKnowledge(store, 'g1', artifact);

    for (const outcome of ['fresh', 'stale-validated', 'invalid'] as const) {
      await recordKnowledgeCheck(store, 'g1', {
        repoRoot: artifact.repoRoot,
        category: artifact.category,
        sha: 'sha',
        outcome,
      });
    }

    const events = await store.list({ type: 'knowledge-checked' });
    expect(events).toHaveLength(3);
  });
});

// ──────────────────────────────────────────────
// goldenCandidates
// ──────────────────────────────────────────────

describe('goldenCandidates projection', () => {
  const goldenEvent = (
    judgeType: string,
    verdictPass: boolean,
    artifactDigest = 'abc123',
    rubricDigest = 'def456',
    model?: string,
  ): FactoryEvent => ({
    type: 'golden-candidate',
    at: 1000,
    goalId: 'g1',
    judgeType,
    artifactDigest,
    rubricDigest,
    verdictPass,
    tier: 'mid',
    ...(model !== undefined ? { model } : {}),
  });

  it('returns empty object when no golden-candidate events', () => {
    const result = goldenCandidates([]);
    expect(result).toEqual({});
  });

  it('groups candidates by judgeType', () => {
    const events: FactoryEvent[] = [
      goldenEvent('judge-implement', true, 'a1', 'r1'),
      goldenEvent('judge-implement', false, 'a2', 'r2'),
      goldenEvent('judge-split', true, 'a3', 'r3'),
    ];
    const result = goldenCandidates(events);
    expect(result['judge-implement']).toHaveLength(2);
    expect(result['judge-split']).toHaveLength(1);
    expect(Object.keys(result)).toHaveLength(2);
  });

  it('preserves order within a judgeType group', () => {
    const events: FactoryEvent[] = [
      goldenEvent('judge-widget', true, 'first', 'r1'),
      goldenEvent('judge-widget', false, 'second', 'r2'),
      goldenEvent('judge-widget', true, 'third', 'r3'),
    ];
    const result = goldenCandidates(events);
    const group = result['judge-widget']!;
    expect(group[0]!.artifactDigest).toBe('first');
    expect(group[1]!.artifactDigest).toBe('second');
    expect(group[2]!.artifactDigest).toBe('third');
  });

  it('includes verdictPass, tier, and model when present', () => {
    const events: FactoryEvent[] = [
      goldenEvent('judge-impl', false, 'dig', 'rub', 'claude-sonnet-4-5'),
    ];
    const result = goldenCandidates(events);
    const candidate = result['judge-impl']![0]!;
    expect(candidate.verdictPass).toBe(false);
    expect(candidate.tier).toBe('mid');
    expect(candidate.model).toBe('claude-sonnet-4-5');
  });

  it('omits model field when absent from the event', () => {
    const events: FactoryEvent[] = [
      goldenEvent('judge-impl', true, 'dig', 'rub'),
    ];
    const result = goldenCandidates(events);
    const candidate = result['judge-impl']![0]!;
    expect(candidate.model).toBeUndefined();
  });

  it('non-golden events do not contribute', () => {
    const events: FactoryEvent[] = [
      baseGoal(),
      goldenEvent('judge-x', true, 'a1', 'r1'),
      {
        type: 'emitted',
        at: 2000,
        goalId: 'g1',
        report: { artifact: null, proof: [], lessons: [], memoriesUsed: [], blockers: [], findings: [], learned: '' },
      },
    ];
    const result = goldenCandidates(events);
    expect(result['judge-x']).toHaveLength(1);
    expect(Object.keys(result)).toHaveLength(1);
  });

  const goldenEventForTree = (goalId: string, judgeType: string, verdictPass: boolean): FactoryEvent => ({
    type: 'golden-candidate',
    at: 1000,
    goalId,
    judgeType,
    artifactDigest: 'a1',
    rubricDigest: 'r1',
    verdictPass,
    tier: 'mid',
  });

  const labelEvent = (
    goalId: string,
    outcome: 'merged' | 'rejected' | 'confirmed' | 'refuted',
    source = 'operator',
    note?: string,
    at = 2000,
  ): FactoryEvent => ({
    type: 'golden-label',
    at,
    goalId,
    outcome,
    source,
    ...(note !== undefined ? { note } : {}),
  });

  it('joins a golden-label to every candidate of the same tree by goalId', () => {
    const events: FactoryEvent[] = [
      goldenEventForTree('tree-1', 'judge-impl', true),
      goldenEventForTree('tree-1', 'judge-integration', true),
      labelEvent('tree-1', 'merged', 'operator', 'shipped'),
    ];
    const result = goldenCandidates(events);
    expect(result['judge-impl']![0]!.label).toEqual({ outcome: 'merged', source: 'operator', note: 'shipped', at: 2000 });
    expect(result['judge-integration']![0]!.label!.outcome).toBe('merged');
  });

  it('leaves candidates of an unlabeled tree without a label', () => {
    const events: FactoryEvent[] = [
      goldenEventForTree('tree-1', 'judge-impl', true),
      goldenEventForTree('tree-2', 'judge-impl', false),
      labelEvent('tree-1', 'merged'),
    ];
    const result = goldenCandidates(events);
    const [labeled, unlabeled] = result['judge-impl']!;
    expect(labeled!.label!.outcome).toBe('merged');
    expect(unlabeled!.label).toBeUndefined();
  });

  it('a later label for a tree overrides an earlier one (re-label corrects)', () => {
    const events: FactoryEvent[] = [
      goldenEventForTree('tree-1', 'judge-impl', true),
      labelEvent('tree-1', 'merged', 'operator', undefined, 2000),
      labelEvent('tree-1', 'rejected', 'operator', 'reverted', 3000),
    ];
    const result = goldenCandidates(events);
    expect(result['judge-impl']![0]!.label!.outcome).toBe('rejected');
    expect(result['judge-impl']![0]!.label!.note).toBe('reverted');
  });
});

describe('labeledGoldenCandidates projection', () => {
  const gc = (goalId: string, judgeType: string): FactoryEvent => ({
    type: 'golden-candidate',
    at: 1000,
    goalId,
    judgeType,
    artifactDigest: 'a',
    rubricDigest: 'r',
    verdictPass: true,
    tier: 'mid',
  });
  const label = (goalId: string): FactoryEvent => ({
    type: 'golden-label',
    at: 2000,
    goalId,
    outcome: 'merged',
    source: 'operator',
  });

  it('returns only labeled candidates and drops empty judgeType groups', () => {
    const events: FactoryEvent[] = [
      gc('tree-1', 'judge-impl'),
      gc('tree-2', 'judge-impl'),
      gc('tree-3', 'judge-split'),
      label('tree-1'),
    ];
    const result = labeledGoldenCandidates(events);
    expect(result['judge-impl']).toHaveLength(1);
    expect(result['judge-impl']![0]!.goalId).toBe('tree-1');
    expect(result['judge-split']).toBeUndefined();
  });
});

// Engine-level golden-capture integration tests live in tests/engine/golden-capture.test.ts
