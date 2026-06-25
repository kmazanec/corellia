/**
 * Tests for the Broker mediator: grant refusal, scope refusal, traversal
 * refusal, event emission, and successful dispatch. Uses InMemoryEventStore
 * and createRegistry(starterTypes()) for realistic grant lookups.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Broker } from '../../src/engine/broker.js';
import { InMemoryEventStore } from '../../src/eventlog/memory-store.js';
import { createRegistry } from '../../src/library/registry.js';
import { starterTypes } from '../../src/library/starter-types.js';
import { createFileTools } from '../../src/engine/tools.js';
import { retrievalTools } from '../../src/library/retrieval.js';
import { fileIssueTool } from '../../src/engine/issue-tools.js';
import type { Goal } from '../../src/contract/goal.js';
import type { ToolCall } from '../../src/contract/tool.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeGoal(overrides: Partial<Goal> = {}): Goal {
  return {
    id: 'g1',
    type: 'implement',
    parentId: null,
    title: 'test goal',
    spec: {},
    intent: 'production',
    scope: ['src/'],
    budget: { attempts: 3, tokens: 1000, toolCalls: 10, wallClockMs: 60000 },
    memories: [],
    ...overrides,
  };
}

function makeCall(overrides: Partial<ToolCall> = {}): ToolCall {
  return {
    id: 'call-1',
    name: 'read_file',
    args: { path: 'src/index.ts' },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let sandboxRoot: string;
let store: InMemoryEventStore;
let broker: Broker;

const registry = createRegistry(starterTypes());

beforeEach(async () => {
  sandboxRoot = await mkdtemp(join(tmpdir(), 'corellia-broker-test-'));
  await mkdir(join(sandboxRoot, 'src'), { recursive: true });
  await writeFile(join(sandboxRoot, 'src', 'index.ts'), 'export const x = 1;\n');

  store = new InMemoryEventStore();
  const tools = createFileTools(sandboxRoot);
  broker = new Broker({
    root: sandboxRoot,
    registry,
    store,
    tools: [tools.readFile, tools.writeFile, tools.listDir, tools.search],
  });
});

afterEach(async () => {
  await rm(sandboxRoot, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Successful grant + dispatch
// ---------------------------------------------------------------------------

describe('granted read_file', () => {
  it('returns ok:true with file content', async () => {
    // 'implement' type has fs.read grant.
    const goal = makeGoal({ type: 'implement', scope: ['src/'] });
    const call = makeCall({ name: 'read_file', args: { path: 'src/index.ts' } });
    const result = await broker.execute(goal, call);
    expect(result.ok).toBe(true);
    expect(result.output).toContain('x = 1');
    expect(result.callId).toBe(call.id);
  });

  it('appends a "ran" tool-call event', async () => {
    const goal = makeGoal({ type: 'implement', scope: ['src/'] });
    const call = makeCall({ name: 'read_file', args: { path: 'src/index.ts' } });
    await broker.execute(goal, call);
    const events = await store.list({ goalId: goal.id, type: 'tool-call' });
    expect(events).toHaveLength(1);
    const e = events[0];
    if (e?.type === 'tool-call') {
      expect(e.outcome).toBe('ran');
      expect(e.tool).toBe('read_file');
      expect(e.callId).toBe(call.id);
      expect(e.goalId).toBe(goal.id);
    }
  });
});

describe('granted list_dir', () => {
  it('returns ok:true with directory listing', async () => {
    const goal = makeGoal({ type: 'implement' });
    const call = makeCall({ name: 'list_dir', args: { path: 'src' } });
    const result = await broker.execute(goal, call);
    expect(result.ok).toBe(true);
    expect(result.output).toContain('index.ts');
  });
});

describe('granted write_file', () => {
  it('writes the file and returns ok:true', async () => {
    // 'implement' type has fs.write grant.
    const goal = makeGoal({ type: 'implement', scope: ['src/'] });
    const call = makeCall({ name: 'write_file', args: { path: 'src/new.ts', content: 'export {}' } });
    const result = await broker.execute(goal, call);
    expect(result.ok).toBe(true);
    // Verify the file was actually written via a read.
    const readCall = makeCall({ id: 'call-2', name: 'read_file', args: { path: 'src/new.ts' } });
    const readResult = await broker.execute(goal, readCall);
    expect(readResult.ok).toBe(true);
    expect(readResult.output).toBe('export {}');
  });

  it('appends two "ran" events (write + read)', async () => {
    const goal = makeGoal({ type: 'implement', scope: ['src/'] });
    await broker.execute(goal, makeCall({ id: 'c1', name: 'write_file', args: { path: 'src/x.ts', content: 'a' } }));
    await broker.execute(goal, makeCall({ id: 'c2', name: 'read_file', args: { path: 'src/x.ts' } }));
    const events = await store.list({ goalId: goal.id, type: 'tool-call' });
    expect(events).toHaveLength(2);
    expect(events.every((e) => e.type === 'tool-call' && e.outcome === 'ran')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Grant refusal
// ---------------------------------------------------------------------------

describe('grant refusal', () => {
  it('refuses write_file for a type that lacks fs.write', async () => {
    // 'freeze-contract' has fs.read + fs.write. Use 'judge-split' (no grants).
    const goal = makeGoal({ type: 'judge-split' });
    const call = makeCall({ name: 'write_file', args: { path: 'src/x.ts', content: 'x' } });
    const result = await broker.execute(goal, call);
    expect(result.ok).toBe(false);
    expect(result.output).toContain('fs.write');
    expect(result.callId).toBe(call.id);
  });

  it('appends a "refused" event naming the required grant', async () => {
    const goal = makeGoal({ type: 'judge-split' });
    const call = makeCall({ name: 'write_file', args: { path: 'src/x.ts', content: 'x' } });
    await broker.execute(goal, call);
    const events = await store.list({ goalId: goal.id, type: 'tool-call' });
    expect(events).toHaveLength(1);
    const e = events[0];
    if (e?.type === 'tool-call') {
      expect(e.outcome).toBe('refused');
      expect(e.reason).toContain('fs.write');
      expect(e.tool).toBe('write_file');
    }
  });

  it('refuses read_file for a type that lacks fs.read', async () => {
    // 'promote-memory' only has memory.write
    const goal = makeGoal({ type: 'promote-memory' });
    const call = makeCall({ name: 'read_file', args: { path: 'src/index.ts' } });
    const result = await broker.execute(goal, call);
    expect(result.ok).toBe(false);
    expect(result.output).toContain('fs.read');
  });

  it('refuses an unknown tool name', async () => {
    const goal = makeGoal({ type: 'implement' });
    const call = makeCall({ name: 'nonexistent_tool', args: {} });
    const result = await broker.execute(goal, call);
    expect(result.ok).toBe(false);
    expect(result.output).toContain('nonexistent_tool');
  });

  it('appends a refused event for an unknown tool', async () => {
    const goal = makeGoal({ type: 'implement' });
    const call = makeCall({ name: 'unknown_tool', args: {} });
    await broker.execute(goal, call);
    const events = await store.list({ type: 'tool-call' });
    expect(events).toHaveLength(1);
    if (events[0]?.type === 'tool-call') {
      expect(events[0].outcome).toBe('refused');
    }
  });

  it('does not crash when goal type is unknown', async () => {
    const goal = makeGoal({ type: 'nonexistent-type' });
    const call = makeCall({ name: 'read_file', args: { path: 'src/index.ts' } });
    const result = await broker.execute(goal, call);
    expect(result.ok).toBe(false);
    expect(result.callId).toBe(call.id);
  });

  it('refuses write_file for "characterize" type (has fs.write_test_dirs, lacks fs.write)', async () => {
    // 'characterize' deliberately holds only 'fs.write_test_dirs', not 'fs.write'.
    // write_file requires 'fs.write' (GRANT_TOOL_MAP). This pins the v1 deferral:
    // fs.write_test_dirs is a scoped grant recognized by the type library but not
    // yet wired into GRANT_TOOL_MAP — so characterize goals cannot write files
    // through the broker until that wiring is added.
    const goal = makeGoal({ type: 'characterize', scope: ['tests/'] });
    const call = makeCall({ name: 'write_file', args: { path: 'tests/foo.test.ts', content: 'x' } });
    const result = await broker.execute(goal, call);
    expect(result.ok).toBe(false);
    expect(result.output).toContain('fs.write');
    // Must be logged as refused with a reason naming the missing grant.
    const events = await store.list({ goalId: goal.id, type: 'tool-call' });
    expect(events).toHaveLength(1);
    if (events[0]?.type === 'tool-call') {
      expect(events[0].outcome).toBe('refused');
      expect(events[0].reason).toContain('fs.write');
    }
  });
});

// ---------------------------------------------------------------------------
// Scope refusal (write_file)
// ---------------------------------------------------------------------------

describe('scope refusal (write_file)', () => {
  it('refuses write outside the goal scope', async () => {
    // 'implement' has fs.write, but scope is ['src/'] — tests/ is out of scope.
    const goal = makeGoal({ type: 'implement', scope: ['src/'] });
    const call = makeCall({ name: 'write_file', args: { path: 'tests/bad.ts', content: 'x' } });
    const result = await broker.execute(goal, call);
    expect(result.ok).toBe(false);
    expect(result.output).toContain('scope');
  });

  it('appends a "refused" event with a reason when the broker catches an out-of-scope write', async () => {
    // The broker now performs the scope check before dispatching — outcome is 'refused', not 'ran'.
    const goal = makeGoal({ type: 'implement', scope: ['src/'] });
    const call = makeCall({ name: 'write_file', args: { path: 'tests/bad.ts', content: 'x' } });
    await broker.execute(goal, call);
    const events = await store.list({ goalId: goal.id, type: 'tool-call' });
    expect(events).toHaveLength(1);
    if (events[0]?.type === 'tool-call') {
      expect(events[0].outcome).toBe('refused');
      expect(events[0].reason).toContain('scope');
    }
  });

  it('refuses write to a path that looks like prefix but violates directory boundary (srcX/file vs src/)', async () => {
    // scope ['src/'] must refuse 'srcX/file' — the boundary check prevents prefix-only matches.
    const goal = makeGoal({ type: 'implement', scope: ['src/'] });
    const call = makeCall({ name: 'write_file', args: { path: 'srcX/file.ts', content: 'x' } });
    const result = await broker.execute(goal, call);
    expect(result.ok).toBe(false);
    expect(result.output).toContain('scope');
    // Must be logged as refused, not ran.
    const events = await store.list({ goalId: goal.id, type: 'tool-call' });
    expect(events).toHaveLength(1);
    if (events[0]?.type === 'tool-call') {
      expect(events[0].outcome).toBe('refused');
    }
  });

  it('refuses traversal path that escapes root for a granted type', async () => {
    const goal = makeGoal({ type: 'implement', scope: ['src/'] });
    const call = makeCall({ name: 'write_file', args: { path: '../escape.ts', content: 'x' } });
    const result = await broker.execute(goal, call);
    expect(result.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Event emission discipline (every call appears in the log)
// ---------------------------------------------------------------------------

describe('event log completeness', () => {
  it('logs every call in order regardless of outcome', async () => {
    const granted = makeGoal({ type: 'implement', scope: ['src/'] });
    const ungrantedGoal = makeGoal({ id: 'g2', type: 'judge-split' });
    await broker.execute(granted, makeCall({ id: 'c1', name: 'read_file', args: { path: 'src/index.ts' } }));
    await broker.execute(ungrantedGoal, makeCall({ id: 'c2', name: 'write_file', args: { path: 'src/x.ts', content: 'x' } }));
    await broker.execute(granted, makeCall({ id: 'c3', name: 'list_dir', args: { path: 'src' } }));
    const all = await store.list({ type: 'tool-call' });
    expect(all).toHaveLength(3);
    expect(all.map((e) => e.type === 'tool-call' ? e.callId : '')).toEqual(['c1', 'c2', 'c3']);
  });

  it('filters events by goalId correctly', async () => {
    const g1 = makeGoal({ id: 'g1', type: 'implement', scope: ['src/'] });
    const g2 = makeGoal({ id: 'g2', type: 'implement', scope: ['src/'] });
    await broker.execute(g1, makeCall({ id: 'c1', name: 'read_file', args: { path: 'src/index.ts' } }));
    await broker.execute(g2, makeCall({ id: 'c2', name: 'read_file', args: { path: 'src/index.ts' } }));
    const g1Events = await store.list({ goalId: 'g1', type: 'tool-call' });
    expect(g1Events).toHaveLength(1);
    if (g1Events[0]?.type === 'tool-call') {
      expect(g1Events[0].callId).toBe('c1');
    }
  });
});

// ---------------------------------------------------------------------------
// Tool not registered in this broker (implementation missing)
// ---------------------------------------------------------------------------

describe('unregistered tool', () => {
  it('refuses when the impl is absent from the dispatch table', async () => {
    // Build a broker with only readFile — write_file is granted but unregistered.
    const tools = createFileTools(sandboxRoot);
    const sparseBroker = new Broker({
      root: sandboxRoot,
      registry,
      store,
      tools: [tools.readFile], // write_file NOT registered
    });
    const goal = makeGoal({ type: 'implement', scope: ['src/'] });
    const call = makeCall({ name: 'write_file', args: { path: 'src/x.ts', content: 'x' } });
    const result = await sparseBroker.execute(goal, call);
    expect(result.ok).toBe(false);
    expect(result.output).toContain('write_file');
    expect(result.output).toContain('not registered');
  });
});

// ---------------------------------------------------------------------------
// Retrieval tool grant allow/refuse
// ---------------------------------------------------------------------------

describe('retrieval tool grants', () => {
  // Build a broker with all five retrieval tools registered, plus the standard
  // file tools. Uses a synthetic repoRoot with a package.json for stack_versions.
  let retrievalBroker: Broker;

  beforeEach(async () => {
    await writeFile(
      join(sandboxRoot, 'package.json'),
      JSON.stringify({ dependencies: { vitest: '^2.0.0' } }),
    );
    const fileTools = createFileTools(sandboxRoot);
    const retTools = retrievalTools({ repoRoot: sandboxRoot });
    retrievalBroker = new Broker({
      root: sandboxRoot,
      registry,
      store,
      tools: [
        fileTools.readFile,
        fileTools.listDir,
        retTools.findSymbol,
        retTools.findExemplar,
        retTools.conventionsFor,
        retTools.stackVersions,
        retTools.impact,
      ],
    });
  });

  for (const toolName of ['find_symbol', 'find_exemplar', 'conventions_for', 'stack_versions', 'impact'] as const) {
    it(`grants ${toolName} to a type with retrieval.api`, async () => {
      // 'deliver-intent' carries retrieval.api — all five tools should be granted.
      const goal = makeGoal({ type: 'deliver-intent' });
      const args: Record<string, unknown> =
        toolName === 'find_symbol' ? { name: 'greet' }
        : toolName === 'find_exemplar' ? { pattern: 'auth' }
        : toolName === 'conventions_for' ? { surface: 'api' }
        : toolName === 'stack_versions' ? {}
        : { files: [] };
      const call = makeCall({ name: toolName, args });
      const result = await retrievalBroker.execute(goal, call);
      expect(result.ok).toBe(true);
      expect(result.callId).toBe(call.id);
    });

    it(`grants ${toolName} to a type with fs.read`, async () => {
      // 'implement' carries fs.read — all five tools should also be granted via fs.read.
      const goal = makeGoal({ type: 'implement' });
      const args: Record<string, unknown> =
        toolName === 'find_symbol' ? { name: 'greet' }
        : toolName === 'find_exemplar' ? { pattern: 'auth' }
        : toolName === 'conventions_for' ? { surface: 'api' }
        : toolName === 'stack_versions' ? {}
        : { files: [] };
      const call = makeCall({ name: toolName, args });
      const result = await retrievalBroker.execute(goal, call);
      expect(result.ok).toBe(true);
    });

    it(`refuses ${toolName} for a type with neither retrieval.api nor fs.read`, async () => {
      // 'judge-split' has no grants — all five retrieval tools must be refused,
      // and the refusal must name the missing grant.
      const goal = makeGoal({ type: 'judge-split' });
      const args: Record<string, unknown> =
        toolName === 'find_symbol' ? { name: 'greet' }
        : toolName === 'find_exemplar' ? { pattern: 'auth' }
        : toolName === 'conventions_for' ? { surface: 'api' }
        : toolName === 'stack_versions' ? {}
        : { files: [] };
      const call = makeCall({ name: toolName, args });
      const result = await retrievalBroker.execute(goal, call);
      expect(result.ok).toBe(false);
      expect(result.callId).toBe(call.id);
      expect(result.output).toMatch(/retrieval\.api|fs\.read/);
    });

    it(`appends a "refused" event naming the grant for ${toolName} when refused`, async () => {
      const goal = makeGoal({ type: 'judge-split' });
      const args: Record<string, unknown> =
        toolName === 'find_symbol' ? { name: 'greet' }
        : toolName === 'find_exemplar' ? { pattern: 'auth' }
        : toolName === 'conventions_for' ? { surface: 'api' }
        : toolName === 'stack_versions' ? {}
        : { files: [] };
      const call = makeCall({ name: toolName, args });
      await retrievalBroker.execute(goal, call);
      const events = await store.list({ goalId: goal.id, type: 'tool-call' });
      expect(events).toHaveLength(1);
      const e = events[0];
      if (e?.type === 'tool-call') {
        expect(e.outcome).toBe('refused');
        expect(e.reason).toMatch(/retrieval\.api|fs\.read/);
        expect(e.tool).toBe(toolName);
      }
    });
  }
});

// ---------------------------------------------------------------------------
// file_issue (ADR-034) — grant + scope enforcement at the broker
// ---------------------------------------------------------------------------

describe('file_issue grant + scope enforcement', () => {
  let issueBroker: Broker;
  beforeEach(async () => {
    await mkdir(join(sandboxRoot, 'docs', 'issues'), { recursive: true });
    await writeFile(
      join(sandboxRoot, 'docs', 'issues', 'index.md'),
      '---\ntype: index\n---\n# Issues\n\n## Medium severity\n\n| Issue | Kind | Tags |\n|---|---|---|\n',
    );
    issueBroker = new Broker({
      root: sandboxRoot,
      registry,
      store,
      tools: [fileIssueTool(sandboxRoot)],
    });
  });

  const validArgs = {
    slug: 'broker-filed', title: 'T', description: 'D', tags: ['x'],
    kind: 'bug', severity: 'medium', problem: 'P', evidence: 'E',
    proposedDirection: 'PD', acceptanceHint: 'AH',
  };

  it('refuses file_issue for a type lacking docs.issues.write (judge-split)', async () => {
    const goal = makeGoal({ type: 'judge-split', scope: ['docs/issues/'] });
    const result = await issueBroker.execute(goal, makeCall({ name: 'file_issue', args: { ...validArgs } }));
    expect(result.ok).toBe(false);
    expect(result.output).toMatch(/not granted/i);
  });

  it('grants file_issue to investigate (holds docs.issues.write) and writes the file', async () => {
    const goal = makeGoal({ type: 'investigate', scope: ['docs/issues/'] });
    const result = await issueBroker.execute(goal, makeCall({ name: 'file_issue', args: { ...validArgs } }));
    expect(result.ok).toBe(true);
    expect(result.output).toMatch(/docs\/issues\/broker-filed\.md/);
  });

  it('refuses file_issue whose derived path is outside the goal scope', async () => {
    // Scope does not include docs/issues/ → the derived path is out of scope.
    const goal = makeGoal({ type: 'investigate', scope: ['src/'] });
    const result = await issueBroker.execute(goal, makeCall({ name: 'file_issue', args: { ...validArgs } }));
    expect(result.ok).toBe(false);
    expect(result.output).toMatch(/scope/i);
  });
});
