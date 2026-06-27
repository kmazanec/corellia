import { describe, expect, it } from 'vitest';
import type { Brain, BrainContext, StepOutput } from '../../src/contract/brain.js';
import type { Decision } from '../../src/contract/decision.js';
import type { Goal, Usage } from '../../src/contract/goal.js';
import { ZERO_USAGE } from '../../src/contract/goal.js';
import type { Artifact } from '../../src/contract/report.js';
import type { ToolBroker, ToolCall, ToolDef, ToolResult } from '../../src/contract/tool.js';
import type { Verdict } from '../../src/contract/verdict.js';
import { runStepLoop } from '../../src/engine/step-loop.js';
import {
  leafTypeDef,
  makeGoal,
  MemoryEventStore,
  textArtifact,
} from './stubs.js';

const READ_FILE_TOOL: ToolDef = {
  name: 'read_file',
  description: 'Read a file',
  parameters: {
    type: 'object',
    properties: { path: { type: 'string' } },
    required: ['path'],
  },
};

describe('runStepLoop', () => {
  it('returns a direct artifact and debits step usage', async () => {
    const store = new MemoryEventStore();
    const usage = { promptTokens: 2, completionTokens: 3 };
    const goal = makeGoal({ type: 'implement' });
    const brain = new StepBrain([
      { kind: 'artifact', artifact: textArtifact('done'), usage },
    ]);
    const debits: Usage[] = [];

    const result = await runStepLoop({
      goal,
      grants: ['fs.read'],
      budget: { attempts: 1, tokens: 100, toolCalls: 2, wallClockMs: 1000 },
      ctx: lowContext(),
      typeDef: leafTypeDef({ name: 'implement', grants: ['fs.read'] }),
      broker: new RecordingBroker([], [READ_FILE_TOOL]),
      sandboxRepoRoot: undefined,
      priorTranscript: undefined,
      brain,
      store,
      now: () => 1,
      enforceToolCallBudget: false,
      debitUsage: (debit) => debits.push(debit),
      hasReachedCeiling: () => false,
    });

    expect(result).toMatchObject({
      kind: 'artifact',
      artifact: textArtifact('done'),
      budget: { toolCalls: 2 },
      tokensUsed: 5,
    });
    expect(debits).toEqual([usage]);
    expect(store.types()).toEqual(['step']);
  });

  it('routes tool calls through the broker before accepting the artifact', async () => {
    const store = new MemoryEventStore();
    const goal = makeGoal({ type: 'implement' });
    const broker = new RecordingBroker(
      [{ callId: 'ignored', ok: true, output: 'file contents' }],
      [READ_FILE_TOOL],
    );
    const brain = new StepBrain([
      {
        kind: 'tool-calls',
        calls: [{ id: 'read-1', name: 'read_file', args: { path: 'src/index.ts' } }],
        usage: ZERO_USAGE,
      },
      { kind: 'artifact', artifact: textArtifact('done'), usage: ZERO_USAGE },
    ]);

    const result = await runStepLoop({
      goal,
      grants: ['fs.read'],
      budget: { attempts: 1, tokens: 100, toolCalls: 2, wallClockMs: 1000 },
      ctx: lowContext(),
      typeDef: leafTypeDef({ name: 'implement', grants: ['fs.read'] }),
      broker,
      sandboxRepoRoot: undefined,
      priorTranscript: undefined,
      brain,
      store,
      now: () => 1,
      enforceToolCallBudget: true,
      debitUsage: () => undefined,
      hasReachedCeiling: () => false,
    });

    expect(result.kind).toBe('artifact');
    if (result.kind !== 'artifact') return;

    expect(result.budget.toolCalls).toBe(1);
    expect(broker.calls).toEqual([
      {
        goalId: goal.id,
        call: { id: 'read-1', name: 'read_file', args: { path: 'src/index.ts' } },
      },
    ]);
    expect(result.transcript).toContainEqual({
      role: 'tool',
      callId: 'read-1',
      content: 'file contents',
    });
    expect(store.types()).toEqual(['step', 'tool-call', 'step']);
  });
});

function lowContext(): BrainContext {
  return { tier: 'low', memories: [] };
}

class StepBrain implements Brain {
  private nextStep = 0;

  constructor(private readonly outputs: StepOutput[]) {}

  async decide(): Promise<{ value: Decision; usage: Usage }> {
    throw new Error('StepBrain.decide: not used');
  }

  async produce(): Promise<{ value: Artifact; usage: Usage }> {
    throw new Error('StepBrain.produce: not used');
  }

  async judge(): Promise<{ value: Verdict; usage: Usage }> {
    throw new Error('StepBrain.judge: not used');
  }

  async repair(): Promise<{ value: Artifact; usage: Usage }> {
    throw new Error('StepBrain.repair: not used');
  }

  async step(): Promise<StepOutput> {
    const output = this.outputs[this.nextStep];
    this.nextStep++;
    if (output === undefined) {
      throw new Error('StepBrain.step: no scripted output');
    }
    return output;
  }
}

class RecordingBroker implements ToolBroker {
  readonly calls: Array<{ goalId: string; call: ToolCall }> = [];

  constructor(
    private readonly results: ToolResult[],
    private readonly toolDefs: ToolDef[],
  ) {}

  defs(): ToolDef[] {
    return this.toolDefs;
  }

  async execute(goal: Goal, call: ToolCall): Promise<ToolResult> {
    this.calls.push({ goalId: goal.id, call });
    return this.results[0] ?? { callId: call.id, ok: false, output: 'no scripted result' };
  }
}
