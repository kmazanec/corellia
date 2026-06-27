import type { StepTranscript } from '../contract/brain.js';
import type { Budget, Goal } from '../contract/goal.js';
import type { GoalTypeDef } from '../contract/goal-type.js';
import type { ToolDef } from '../contract/tool.js';
import { newScratchpad, type Scratchpad } from './scratchpad.js';
import { stepLoopHardToolCallCap } from './step-loop-budget.js';
import { buildStepLoopInitialTranscript } from './step-loop-context.js';
import { isExploreThenEmitLeaf } from './step-loop-guards.js';
import { NOTE_TOOL_DEF, deriveToolDefs } from './step-loop-tools.js';

export interface StepLoopCounters {
  remainingToolCalls: number;
  toolCallsMade: number;
  stepIndex: number;
  exploreReadCalls: number;
  totalTokensUsed: number;
  toolBudgetWarned: boolean;
  forceEmitNext: boolean;
  malformRecoveryUsed: boolean;
}

export interface StepLoopSession {
  tools: ToolDef[];
  transcript: StepTranscript;
  scratchpad: Scratchpad;
  seenCalls: Set<string>;
  callKeyByCallId: Map<string, string>;
  isExploreThenEmit: boolean;
  hardToolCallCap: number;
  counters: StepLoopCounters;
}

export function createStepLoopSession(params: {
  goal: Goal;
  grants: string[];
  budget: Budget;
  typeDef: GoalTypeDef;
  broker: { defs?: () => ToolDef[] };
  sandboxRepoRoot: string | undefined;
  priorTranscript: StepTranscript | undefined;
}): StepLoopSession {
  const remainingToolCalls = params.budget.toolCalls;
  const isExploreThenEmit = isExploreThenEmitLeaf(params.typeDef);

  return {
    tools: stepLoopTools(params.grants, params.broker),
    transcript: buildStepLoopInitialTranscript({
      goal: params.goal,
      typeDef: params.typeDef,
      isExploreThenEmit,
      remainingToolCalls,
      sandboxRepoRoot: params.sandboxRepoRoot,
      priorTranscript: params.priorTranscript,
    }),
    scratchpad: newScratchpad(),
    seenCalls: new Set<string>(),
    callKeyByCallId: new Map<string, string>(),
    isExploreThenEmit,
    hardToolCallCap: stepLoopHardToolCallCap(params.budget.toolCalls),
    counters: {
      remainingToolCalls,
      toolCallsMade: 0,
      stepIndex: 0,
      exploreReadCalls: 0,
      totalTokensUsed: 0,
      toolBudgetWarned: false,
      forceEmitNext: false,
      malformRecoveryUsed: false,
    },
  };
}

function stepLoopTools(grants: string[], broker: { defs?: () => ToolDef[] }): ToolDef[] {
  return [
    ...deriveToolDefs(grants, broker),
    NOTE_TOOL_DEF,
  ];
}
