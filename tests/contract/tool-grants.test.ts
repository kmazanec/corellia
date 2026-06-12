/**
 * Chunk 1 — Tool grants contract tests (F-61, ADR-025).
 *
 * Pins:
 *   - GRANT_TOOL_MAP carries `push_branch → repo.branch` and `open_pr → repo.pr`.
 *   - The broker refuses push_branch / open_pr for a type that lacks repo.branch
 *     / repo.pr (structural no-merge guarantee, AC 6).
 *   - The broker grants push_branch / open_pr to `improve-factory`, the one
 *     type in the starter library that holds repo.branch + repo.pr.
 *   - `branch-pushed` and `pr-opened` FactoryEvent members round-trip through
 *     InMemoryEventStore (AC 5).
 *   - All three exhaustive projection switches handle the new members without
 *     compiler errors (compile-time assertion, AC 5).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { GRANT_TOOL_MAP } from '../../src/contract/tool.js';
import type { ToolImpl } from '../../src/contract/tool.js';
import type { FactoryEvent } from '../../src/contract/events.js';
import { InMemoryEventStore } from '../../src/eventlog/memory-store.js';
import { Broker } from '../../src/engine/broker.js';
import { createRegistry } from '../../src/library/registry.js';
import { starterTypes } from '../../src/library/starter-types.js';
import { createFileTools } from '../../src/engine/tools.js';
import { traceStats, costSummary, projectKnowledge } from '../../src/eventlog/projections.js';

// ---------------------------------------------------------------------------
// GRANT_TOOL_MAP — F-61 entries are present (AC 6)
// ---------------------------------------------------------------------------

describe('GRANT_TOOL_MAP — push_branch and open_pr entries', () => {
  it('maps push_branch to repo.branch', () => {
    expect(GRANT_TOOL_MAP.push_branch).toContain('repo.branch');
  });

  it('maps open_pr to repo.pr', () => {
    expect(GRANT_TOOL_MAP.open_pr).toContain('repo.pr');
  });

  it('push_branch does not carry any read or write file grant', () => {
    // Structural: push_branch must not bleed into general FS capabilities.
    expect(GRANT_TOOL_MAP.push_branch).not.toContain('fs.read');
    expect(GRANT_TOOL_MAP.push_branch).not.toContain('fs.write');
  });

  it('open_pr does not carry any read or write file grant', () => {
    expect(GRANT_TOOL_MAP.open_pr).not.toContain('fs.read');
    expect(GRANT_TOOL_MAP.open_pr).not.toContain('fs.write');
  });
});

// ---------------------------------------------------------------------------
// Broker grant enforcement — stub ToolImpls
// ---------------------------------------------------------------------------

/**
 * A no-op ToolImpl stub for push_branch / open_pr that always succeeds.
 * The broker's grant check fires BEFORE calling execute, so execute is only
 * reached when the grant is present.
 */
function stubImpl(name: string): ToolImpl {
  return {
    def: {
      name,
      description: `stub ${name}`,
      parameters: { type: 'object', properties: {}, required: [] },
    },
    async execute(_goal, _args) {
      return { ok: true, output: `stub ${name} ran` };
    },
  };
}

const registry = createRegistry(starterTypes());

let sandboxRoot: string;
let store: InMemoryEventStore;
let broker: Broker;

beforeEach(async () => {
  sandboxRoot = await mkdtemp(join(tmpdir(), 'corellia-tool-grants-'));
  await mkdir(join(sandboxRoot, 'src'), { recursive: true });
  await writeFile(join(sandboxRoot, 'src', 'index.ts'), 'export {};\n');

  store = new InMemoryEventStore();
  const fileTools = createFileTools(sandboxRoot);
  broker = new Broker({
    root: sandboxRoot,
    registry,
    store,
    tools: [
      fileTools.readFile,
      fileTools.listDir,
      stubImpl('push_branch'),
      stubImpl('open_pr'),
    ],
  });
});

afterEach(async () => {
  await rm(sandboxRoot, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// improve-factory is granted (has repo.branch + repo.pr)
// ---------------------------------------------------------------------------

describe('broker grants push_branch and open_pr to improve-factory', () => {
  const goal = {
    id: 'g-improve',
    type: 'improve-factory',
    parentId: null as null,
    title: 'improve the factory',
    spec: {},
    intent: 'production' as const,
    scope: [],
    budget: { attempts: 3, tokens: 1000, toolCalls: 10, wallClockMs: 60000 },
    memories: [],
  };

  it('grants push_branch to improve-factory', async () => {
    const result = await broker.execute(goal, { id: 'c1', name: 'push_branch', args: {} });
    expect(result.ok).toBe(true);
    expect(result.output).toContain('stub push_branch');
  });

  it('grants open_pr to improve-factory', async () => {
    const result = await broker.execute(goal, {
      id: 'c2',
      name: 'open_pr',
      args: { title: 'My PR', body: 'body text' },
    });
    expect(result.ok).toBe(true);
    expect(result.output).toContain('stub open_pr');
  });
});

// ---------------------------------------------------------------------------
// Types that lack repo.branch / repo.pr are refused (AC 6, structural)
// ---------------------------------------------------------------------------

describe('broker refuses push_branch and open_pr for types lacking the grant', () => {
  const goal = {
    id: 'g-implement',
    type: 'implement',         // has fs.read + fs.write, NOT repo.branch/repo.pr
    parentId: null as null,
    title: 'implement something',
    spec: {},
    intent: 'production' as const,
    scope: ['src/'],
    budget: { attempts: 3, tokens: 1000, toolCalls: 10, wallClockMs: 60000 },
    memories: [],
  };

  it('refuses push_branch for implement type', async () => {
    const result = await broker.execute(goal, { id: 'c1', name: 'push_branch', args: {} });
    expect(result.ok).toBe(false);
    expect(result.output).toContain('repo.branch');
  });

  it('appends a refused event for push_branch', async () => {
    await broker.execute(goal, { id: 'c1', name: 'push_branch', args: {} });
    const events = await store.list({ goalId: goal.id, type: 'tool-call' });
    expect(events).toHaveLength(1);
    const e = events[0];
    if (e?.type === 'tool-call') {
      expect(e.outcome).toBe('refused');
      expect(e.reason).toContain('repo.branch');
    }
  });

  it('refuses open_pr for implement type', async () => {
    const result = await broker.execute(goal, {
      id: 'c2',
      name: 'open_pr',
      args: { title: 'PR', body: 'body' },
    });
    expect(result.ok).toBe(false);
    expect(result.output).toContain('repo.pr');
  });

  it('appends a refused event for open_pr', async () => {
    await broker.execute(goal, { id: 'c2', name: 'open_pr', args: { title: 'PR', body: 'body' } });
    const events = await store.list({ goalId: goal.id, type: 'tool-call' });
    expect(events).toHaveLength(1);
    const e = events[0];
    if (e?.type === 'tool-call') {
      expect(e.outcome).toBe('refused');
      expect(e.reason).toContain('repo.pr');
    }
  });

  it('refuses push_branch for judge-split type (no grants)', async () => {
    const noGrantGoal = { ...goal, id: 'g-judge', type: 'judge-split' };
    const result = await broker.execute(noGrantGoal, { id: 'c3', name: 'push_branch', args: {} });
    expect(result.ok).toBe(false);
    expect(result.output).toContain('repo.branch');
  });
});

// ---------------------------------------------------------------------------
// branch-pushed and pr-opened events round-trip (AC 5)
// ---------------------------------------------------------------------------

describe('branch-pushed event round-trips through InMemoryEventStore', () => {
  it('stores and retrieves branch-pushed', async () => {
    const eventStore = new InMemoryEventStore();
    const event: FactoryEvent = {
      type: 'branch-pushed',
      at: Date.now(),
      goalId: 'g1',
      treeId: 'tree-abc123',
      branch: 'tree/tree-abc123',
      remote: 'https://github.com/acme/factory.git',
    };
    await eventStore.append(event);
    const events = await eventStore.list({ goalId: 'g1' });
    expect(events).toHaveLength(1);
    const e = events[0];
    expect(e?.type).toBe('branch-pushed');
    if (e?.type === 'branch-pushed') {
      expect(e.treeId).toBe('tree-abc123');
      expect(e.branch).toBe('tree/tree-abc123');
      expect(e.remote).toBe('https://github.com/acme/factory.git');
    }
  });

  it('filters by type: branch-pushed', async () => {
    const eventStore = new InMemoryEventStore();
    await eventStore.append({
      type: 'goal-received',
      at: Date.now(),
      goalId: 'g1',
      goal: {
        id: 'g1',
        type: 'improve-factory',
        parentId: null,
        title: 't',
        spec: {},
        intent: 'production',
        scope: [],
        budget: { attempts: 3, tokens: 1000, toolCalls: 10, wallClockMs: 60000 },
        memories: [],
      },
    });
    await eventStore.append({
      type: 'branch-pushed',
      at: Date.now(),
      goalId: 'g1',
      treeId: 'tid',
      branch: 'tree/tid',
      remote: 'https://github.com/a/b.git',
    });
    const pushed = await eventStore.list({ type: 'branch-pushed' });
    expect(pushed).toHaveLength(1);
    expect(pushed[0]?.type).toBe('branch-pushed');
  });
});

describe('pr-opened event round-trips through InMemoryEventStore', () => {
  it('stores and retrieves pr-opened', async () => {
    const eventStore = new InMemoryEventStore();
    const event: FactoryEvent = {
      type: 'pr-opened',
      at: Date.now(),
      goalId: 'g1',
      treeId: 'tree-abc123',
      branch: 'tree/tree-abc123',
      url: 'https://github.com/acme/factory/pull/42',
    };
    await eventStore.append(event);
    const events = await eventStore.list({ goalId: 'g1' });
    expect(events).toHaveLength(1);
    const e = events[0];
    expect(e?.type).toBe('pr-opened');
    if (e?.type === 'pr-opened') {
      expect(e.treeId).toBe('tree-abc123');
      expect(e.url).toBe('https://github.com/acme/factory/pull/42');
    }
  });

  it('filters by type: pr-opened', async () => {
    const eventStore = new InMemoryEventStore();
    await eventStore.append({
      type: 'pr-opened',
      at: Date.now(),
      goalId: 'g1',
      treeId: 'tid',
      branch: 'tree/tid',
      url: 'https://github.com/a/b/pull/1',
    });
    await eventStore.append({
      type: 'branch-pushed',
      at: Date.now(),
      goalId: 'g1',
      treeId: 'tid',
      branch: 'tree/tid',
      remote: 'https://github.com/a/b.git',
    });
    const opened = await eventStore.list({ type: 'pr-opened' });
    expect(opened).toHaveLength(1);
    expect(opened[0]?.type).toBe('pr-opened');
  });
});

// ---------------------------------------------------------------------------
// Exhaustive-switch compile-time assertions (AC 5)
// Adding new FactoryEvent members without updating the switch → tsc error.
// ---------------------------------------------------------------------------

describe('FactoryEvent exhaustive switch covers branch-pushed, pr-opened, blocker-routed', () => {
  it('handleEvent returns the type string for all new members', () => {
    /**
     * This function must handle EVERY FactoryEvent member or tsc will error.
     * The three new members (branch-pushed, pr-opened, blocker-routed) must be
     * present here — they are already present in the barrier's projection
     * switches; this test mirrors that discipline.
     */
    function handleEvent(e: FactoryEvent): string {
      switch (e.type) {
        case 'goal-received': return e.type;
        case 'gate-checked': return e.type;
        case 'decided': return e.type;
        case 'child-spawned': return e.type;
        case 'deterministic-checked': return e.type;
        case 'judge-verdict': return e.type;
        case 'repair-applied': return e.type;
        case 'tier-escalated': return e.type;
        case 'blocked': return e.type;
        case 'memory-written': return e.type;
        case 'memory-reinforced': return e.type;
        case 'emitted': return e.type;
        case 'budget-exhausted': return e.type;
        case 'risk-classified': return e.type;
        case 'gate-decision': return e.type;
        case 'parked': return e.type;
        case 'resumed': return e.type;
        case 'pattern-consulted': return e.type;
        case 'pattern-recorded': return e.type;
        case 'tool-call': return e.type;
        case 'step': return e.type;
        case 'script-ran': return e.type;
        case 'worktree-created': return e.type;
        case 'worktree-collected': return e.type;
        case 'worktree-preserved': return e.type;
        case 'produced': return e.type;
        case 'ceiling-reached': return e.type;
        case 'transport-retry': return e.type;
        case 'malformation-reprompt': return e.type;
        case 'knowledge-written': return e.type;
        case 'knowledge-facts-written': return e.type;
        case 'knowledge-checked': return e.type;
        case 'golden-candidate': return e.type;
        // F-61 new members:
        case 'branch-pushed': return e.type;
        case 'pr-opened': return e.type;
        case 'blocker-routed': return e.type;
      }
    }

    const bp: FactoryEvent = {
      type: 'branch-pushed',
      at: 0,
      goalId: 'g1',
      treeId: 't1',
      branch: 'tree/t1',
      remote: 'https://github.com/a/b.git',
    };
    const po: FactoryEvent = {
      type: 'pr-opened',
      at: 0,
      goalId: 'g1',
      treeId: 't1',
      branch: 'tree/t1',
      url: 'https://github.com/a/b/pull/1',
    };
    const br: FactoryEvent = {
      type: 'blocker-routed',
      at: 0,
      goalId: 'g1',
      blocker: 'some-blocker',
      commissionId: 'c1',
    };

    expect(handleEvent(bp)).toBe('branch-pushed');
    expect(handleEvent(po)).toBe('pr-opened');
    expect(handleEvent(br)).toBe('blocker-routed');
  });
});

// ---------------------------------------------------------------------------
// Projection switches — compile-time that traceStats, costSummary,
// projectKnowledge all see the new members without falling through to a
// never-type error (the barrier already extended the switches).
// ---------------------------------------------------------------------------

describe('projection functions handle branch-pushed / pr-opened / blocker-routed', () => {
  const branchPushedEvent: FactoryEvent = {
    type: 'branch-pushed',
    at: 100,
    goalId: 'g1',
    treeId: 't1',
    branch: 'tree/t1',
    remote: 'https://github.com/a/b.git',
  };

  const prOpenedEvent: FactoryEvent = {
    type: 'pr-opened',
    at: 200,
    goalId: 'g1',
    treeId: 't1',
    branch: 'tree/t1',
    url: 'https://github.com/a/b/pull/1',
  };

  const blockerRoutedEvent: FactoryEvent = {
    type: 'blocker-routed',
    at: 300,
    goalId: 'g1',
    blocker: 'some blocker',
    commissionId: 'commission-1',
  };

  it('traceStats does not throw on branch-pushed, pr-opened, blocker-routed', () => {
    const events: FactoryEvent[] = [branchPushedEvent, prOpenedEvent, blockerRoutedEvent];
    expect(() => traceStats(events)).not.toThrow();
    // These events don't contribute to stats — result is empty.
    expect(Object.keys(traceStats(events))).toHaveLength(0);
  });

  it('costSummary does not throw on branch-pushed, pr-opened, blocker-routed', () => {
    const events: FactoryEvent[] = [branchPushedEvent, prOpenedEvent, blockerRoutedEvent];
    expect(() => costSummary(events)).not.toThrow();
    const result = costSummary(events);
    expect(result.tree.promptTokens).toBe(0);
  });

  it('projectKnowledge does not throw on branch-pushed, pr-opened, blocker-routed', () => {
    const events: FactoryEvent[] = [branchPushedEvent, prOpenedEvent, blockerRoutedEvent];
    expect(() => projectKnowledge(events)).not.toThrow();
    const result = projectKnowledge(events);
    expect(result.artifacts.size).toBe(0);
  });
});
