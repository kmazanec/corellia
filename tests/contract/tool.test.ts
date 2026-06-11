/**
 * Type-level pins for the frozen tool contract shapes and the 'tool-call' event
 * member. These tests prove the contract compiles as specified and that the event
 * union carries the new member — any regression in the frozen shapes will break
 * this file first.
 */

import { describe, it, expect } from 'vitest';
import type { ToolDef, ToolCall, ToolResult, ToolImpl, ToolBroker, ScriptResult } from '../../src/contract/tool.js';
import { GRANT_TOOL_MAP } from '../../src/contract/tool.js';
import type { FactoryEvent } from '../../src/contract/events.js';
import type { Goal } from '../../src/contract/goal.js';
import { InMemoryEventStore } from '../../src/eventlog/memory-store.js';

// ---------------------------------------------------------------------------
// Type-level construction — compiles = passes
// ---------------------------------------------------------------------------

describe('ToolDef shape', () => {
  it('constructs with required fields', () => {
    const def: ToolDef = {
      name: 'read_file',
      description: 'Read a file from the sandbox.',
      parameters: { type: 'object', properties: { path: { type: 'string' } } },
    };
    expect(def.name).toBe('read_file');
  });
});

describe('ToolCall shape', () => {
  it('constructs with required fields', () => {
    const call: ToolCall = {
      id: 'call-1',
      name: 'read_file',
      args: { path: 'src/index.ts' },
    };
    expect(call.id).toBe('call-1');
  });
});

describe('ToolResult shape', () => {
  it('constructs success result', () => {
    const result: ToolResult = { callId: 'call-1', ok: true, output: 'file content' };
    expect(result.ok).toBe(true);
  });

  it('constructs refusal result', () => {
    const result: ToolResult = { callId: 'call-1', ok: false, output: 'not granted: fs.read' };
    expect(result.ok).toBe(false);
  });
});

describe('ToolImpl shape', () => {
  it('constructs a minimal ToolImpl', () => {
    const impl: ToolImpl = {
      def: { name: 'read_file', description: 'Read a file.', parameters: {} },
      async execute(_goal: Goal, _args: Record<string, unknown>) {
        return { ok: true, output: '' };
      },
    };
    expect(impl.def.name).toBe('read_file');
  });
});

describe('ToolBroker shape', () => {
  it('constructs a minimal ToolBroker', () => {
    const goal: Goal = {
      id: 'g1',
      type: 'implement',
      parentId: null,
      title: 'test',
      spec: {},
      intent: 'production',
      scope: ['src/'],
      budget: { attempts: 3, tokens: 1000, toolCalls: 10, wallClockMs: 60000 },
      memories: [],
    };
    const broker: ToolBroker = {
      async execute(_goal: Goal, call: ToolCall): Promise<ToolResult> {
        return { callId: call.id, ok: true, output: '' };
      },
    };
    expect(typeof broker.execute).toBe('function');
    // Suppress unused variable warning
    void goal;
  });
});

describe('ScriptResult shape', () => {
  it('constructs a success result', () => {
    const r: ScriptResult = {
      ok: true,
      exitStatus: 0,
      output: 'ok',
      fullOutput: 'full ok',
      durationMs: 100,
      timedOut: false,
    };
    expect(r.ok).toBe(true);
  });

  it('constructs a timed-out result', () => {
    const r: ScriptResult = {
      ok: false,
      exitStatus: null,
      output: '',
      fullOutput: '',
      durationMs: 5000,
      timedOut: true,
    };
    expect(r.timedOut).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// GRANT_TOOL_MAP
// ---------------------------------------------------------------------------

describe('GRANT_TOOL_MAP', () => {
  it('maps read_file to fs.read', () => {
    expect(GRANT_TOOL_MAP.read_file).toContain('fs.read');
  });

  it('maps list_dir to fs.read', () => {
    expect(GRANT_TOOL_MAP.list_dir).toContain('fs.read');
  });

  it('maps search to fs.read', () => {
    expect(GRANT_TOOL_MAP.search).toContain('fs.read');
  });

  it('maps write_file to fs.write', () => {
    expect(GRANT_TOOL_MAP.write_file).toContain('fs.write');
  });

  it('maps run_script to test.run_scoped and test.run_impacted', () => {
    expect(GRANT_TOOL_MAP.run_script).toContain('test.run_scoped');
    expect(GRANT_TOOL_MAP.run_script).toContain('test.run_impacted');
  });
});

// ---------------------------------------------------------------------------
// 'tool-call' event member round-trips through InMemoryEventStore
// ---------------------------------------------------------------------------

describe("'tool-call' FactoryEvent member", () => {
  it('constructs and round-trips through InMemoryEventStore', async () => {
    const store = new InMemoryEventStore();
    const event: FactoryEvent = {
      type: 'tool-call',
      at: Date.now(),
      goalId: 'g1',
      tool: 'read_file',
      callId: 'call-1',
      outcome: 'ran',
    };

    await store.append(event);
    const events = await store.list({ goalId: 'g1' });

    expect(events).toHaveLength(1);
    const e = events[0];
    expect(e?.type).toBe('tool-call');
    if (e?.type === 'tool-call') {
      expect(e.tool).toBe('read_file');
      expect(e.callId).toBe('call-1');
      expect(e.outcome).toBe('ran');
    }
  });

  it('stores refusal with a reason', async () => {
    const store = new InMemoryEventStore();
    const event: FactoryEvent = {
      type: 'tool-call',
      at: Date.now(),
      goalId: 'g1',
      tool: 'write_file',
      callId: 'call-2',
      outcome: 'refused',
      reason: 'not granted: fs.write',
    };

    await store.append(event);
    const events = await store.list({ type: 'tool-call' });

    expect(events).toHaveLength(1);
    const e = events[0];
    if (e?.type === 'tool-call') {
      expect(e.outcome).toBe('refused');
      expect(e.reason).toBe('not granted: fs.write');
    }
  });

  it('filter by type returns only tool-call events', async () => {
    const store = new InMemoryEventStore();
    await store.append({
      type: 'goal-received',
      at: Date.now(),
      goalId: 'g1',
      goal: {
        id: 'g1',
        type: 'implement',
        parentId: null,
        title: 'test',
        spec: {},
        intent: 'production',
        scope: [],
        budget: { attempts: 3, tokens: 1000, toolCalls: 10, wallClockMs: 60000 },
        memories: [],
      },
    });
    await store.append({
      type: 'tool-call',
      at: Date.now(),
      goalId: 'g1',
      tool: 'read_file',
      callId: 'call-3',
      outcome: 'ran',
    });

    const toolEvents = await store.list({ type: 'tool-call' });
    expect(toolEvents).toHaveLength(1);
    expect(toolEvents[0]?.type).toBe('tool-call');
  });
});

// ---------------------------------------------------------------------------
// FactoryEvent switch exhaustiveness (compile-time assertion)
// ---------------------------------------------------------------------------

describe('FactoryEvent switch exhaustiveness', () => {
  it('tool-call is handled in a switch over all event types', () => {
    // This function must handle every FactoryEvent member or tsc will error.
    // Adding a new member to FactoryEvent without updating this switch causes
    // a compile failure — enforcing the ADR-003 discipline.
    function handleEvent(e: FactoryEvent): string {
      switch (e.type) {
        case 'goal-received': return 'goal-received';
        case 'gate-checked': return 'gate-checked';
        case 'decided': return 'decided';
        case 'child-spawned': return 'child-spawned';
        case 'deterministic-checked': return 'deterministic-checked';
        case 'judge-verdict': return 'judge-verdict';
        case 'repair-applied': return 'repair-applied';
        case 'tier-escalated': return 'tier-escalated';
        case 'blocked': return 'blocked';
        case 'memory-written': return 'memory-written';
        case 'memory-reinforced': return 'memory-reinforced';
        case 'emitted': return 'emitted';
        case 'budget-exhausted': return 'budget-exhausted';
        case 'risk-classified': return 'risk-classified';
        case 'gate-decision': return 'gate-decision';
        case 'parked': return 'parked';
        case 'resumed': return 'resumed';
        case 'pattern-consulted': return 'pattern-consulted';
        case 'pattern-recorded': return 'pattern-recorded';
        case 'tool-call': return 'tool-call';
        case 'step': return 'step';
        case 'script-ran': return 'script-ran';
        case 'worktree-created': return 'worktree-created';
        case 'worktree-collected': return 'worktree-collected';
        case 'worktree-preserved': return 'worktree-preserved';
        case 'produced': return 'produced';
        case 'ceiling-reached': return 'ceiling-reached';
        case 'transport-retry': return 'transport-retry';
        case 'malformation-reprompt': return 'malformation-reprompt';
      }
    }

    const event: FactoryEvent = {
      type: 'tool-call',
      at: 0,
      goalId: 'g1',
      tool: 'read_file',
      callId: 'c1',
      outcome: 'ran',
    };
    expect(handleEvent(event)).toBe('tool-call');
  });
});
