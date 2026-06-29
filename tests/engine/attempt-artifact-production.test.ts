import { describe, expect, it } from 'vitest';
import type { Brain, StepOutput } from '../../src/contract/brain.js';
import type { Decision } from '../../src/contract/decision.js';
import type { EventStore } from '../../src/contract/events.js';
import type { Goal, Usage } from '../../src/contract/goal.js';
import { ZERO_USAGE } from '../../src/contract/goal.js';
import type { Artifact } from '../../src/contract/report.js';
import type { ToolBroker, ToolCall, ToolDef, ToolResult } from '../../src/contract/tool.js';
import type { Verdict } from '../../src/contract/verdict.js';
import { produceAttemptArtifact } from '../../src/engine/attempt/artifact-production.js';
import { createAttemptLoopState } from '../../src/engine/attempt/state.js';
import {
  buildRegistry,
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

describe('produceAttemptArtifact', () => {
  it('runs the classic produce path when no granted tool broker is available', async () => {
    const store = new MemoryEventStore();
    const goal = makeGoal({ type: 'leaf' });
    const usage = { promptTokens: 2, completionTokens: 3 };
    const debits: Usage[] = [];

    const result = await produceAttemptArtifact({
      goal,
      typeDef: leafTypeDef({ name: 'leaf', grants: [] }),
      state: createAttemptLoopState({ budget: goal.budget, tier: 'low', tierIndex: 0 }),
      ctx: { tier: 'low', memories: [] },
      tierLadder: ['low', 'mid', 'high'],
      broker: undefined,
      sandboxRepoRoot: undefined,
      brain: new ProductionBrain({
        produce: { artifact: textArtifact('classic'), usage },
      }),
      registry: buildRegistry([leafTypeDef({ name: 'leaf' })]),
      store,
      now: () => 1,
      enforceToolCallBudget: false,
      goldenCapture: false,
      debitUsage: (debit) => debits.push(debit),
      hasReachedCeiling: () => false,
      resolveStepLoopFailure: async () => {
        throw new Error('resolveStepLoopFailure should not be called');
      },
    });

    expect(result).toMatchObject({
      kind: 'artifact',
      artifact: textArtifact('classic'),
      state: { budget: { tokens: goal.budget.tokens - 5 } },
      stepLoopTranscriptTail: undefined,
      stepLoopTailFinding: null,
      tournamentRan: false,
    });
    expect(debits).toEqual([usage]);
    expect(store.types()).toEqual(['produced']);
  });

  it('runs the step-loop path when tools are granted and a broker is available', async () => {
    const store = new MemoryEventStore();
    const goal = makeGoal({
      type: 'implement',
      budget: { attempts: 1, tokens: 100, toolCalls: 2, wallClockMs: 1000 },
    });
    const broker = new RecordingBroker(
      [{ callId: 'ignored', ok: true, output: 'file contents' }],
      [READ_FILE_TOOL],
      store,
    );

    const result = await produceAttemptArtifact({
      goal,
      typeDef: leafTypeDef({ name: 'implement', grants: ['fs.read'] }),
      state: createAttemptLoopState({ budget: goal.budget, tier: 'low', tierIndex: 0 }),
      ctx: { tier: 'low', memories: [] },
      tierLadder: ['low', 'mid', 'high'],
      broker,
      sandboxRepoRoot: undefined,
      brain: new ProductionBrain({
        steps: [
          {
            kind: 'tool-calls',
            calls: [{ id: 'read-1', name: 'read_file', args: { path: 'src/index.ts' } }],
            usage: ZERO_USAGE,
          },
          { kind: 'artifact', artifact: textArtifact('done'), usage: ZERO_USAGE },
        ],
      }),
      registry: buildRegistry([leafTypeDef({ name: 'implement', grants: ['fs.read'] })]),
      store,
      now: () => 1,
      enforceToolCallBudget: true,
      goldenCapture: false,
      debitUsage: () => undefined,
      hasReachedCeiling: () => false,
      resolveStepLoopFailure: async () => {
        throw new Error('resolveStepLoopFailure should not be called');
      },
    });

    expect(result).toMatchObject({
      kind: 'artifact',
      artifact: textArtifact('done'),
      state: { budget: { toolCalls: 1 } },
      tournamentRan: false,
    });
    if (result.kind !== 'artifact') return;
    expect(result.stepLoopTranscriptTail).toContainEqual({
      role: 'tool',
      callId: 'read-1',
      content: 'file contents',
    });
    expect(result.stepLoopTailFinding?.title).toContain('step-loop-transcript');
    expect(broker.calls).toEqual([
      {
        goalId: goal.id,
        call: { id: 'read-1', name: 'read_file', args: { path: 'src/index.ts' } },
      },
    ]);
    expect(store.types()).toEqual(['step', 'tool-call', 'step']);
  });
});

class ProductionBrain implements Brain {
  private nextStep = 0;

  constructor(private readonly script: {
    produce?: { artifact: Artifact; usage: Usage };
    steps?: StepOutput[];
  }) {}

  async decide(): Promise<{ value: Decision; usage: Usage }> {
    throw new Error('ProductionBrain.decide: not used');
  }

  async produce(): Promise<{ value: Artifact; usage: Usage }> {
    if (this.script.produce === undefined) {
      throw new Error('ProductionBrain.produce: no scripted output');
    }
    return {
      value: this.script.produce.artifact,
      usage: this.script.produce.usage,
    };
  }

  async judge(): Promise<{ value: Verdict; usage: Usage }> {
    throw new Error('ProductionBrain.judge: not used');
  }

  async repair(): Promise<{ value: Artifact; usage: Usage }> {
    throw new Error('ProductionBrain.repair: not used');
  }

  async step(): Promise<StepOutput> {
    const output = this.script.steps?.[this.nextStep];
    this.nextStep++;
    if (output === undefined) {
      throw new Error('ProductionBrain.step: no scripted output');
    }
    return output;
  }
}

class RecordingBroker implements ToolBroker {
  readonly calls: Array<{ goalId: string; call: ToolCall }> = [];

  constructor(
    private readonly results: ToolResult[],
    private readonly toolDefs: ToolDef[],
    private readonly store?: EventStore,
  ) {}

  defs(): ToolDef[] {
    return this.toolDefs;
  }

  async execute(goal: Goal, call: ToolCall): Promise<ToolResult> {
    this.calls.push({ goalId: goal.id, call });
    const result = this.results[0] ?? { callId: call.id, ok: false, output: 'no scripted result' };
    // The broker is the single logger for dispatched calls (mirrors the real broker).
    await this.store?.append({
      type: 'tool-call',
      at: Date.now(),
      goalId: goal.id,
      tool: call.name,
      callId: call.id,
      outcome: result.ok ? 'ran' : 'refused',
    });
    return result;
  }
}
