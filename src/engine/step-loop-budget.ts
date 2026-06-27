import type { StepTranscript } from '../contract/brain.js';
import type { EventStore } from '../contract/events.js';
import type { Budget, Goal } from '../contract/goal.js';

const WARN_ONLY_BACKSTOP_MULTIPLE = 50;

export interface StepLoopToolBudgetState {
  remainingToolCalls: number;
  toolCallsMade: number;
  warned: boolean;
  hardToolCallCap: number;
}

export type StepLoopToolBudgetResult =
  | { kind: 'continue'; state: StepLoopToolBudgetState }
  | { kind: 'exhausted'; budget: Budget; transcript: StepTranscript };

export function stepLoopHardToolCallCap(toolCallBudget: number): number {
  return Math.max(toolCallBudget, 1) * WARN_ONLY_BACKSTOP_MULTIPLE;
}

export async function checkStepLoopToolBudget(params: {
  goal: Goal;
  budget: Budget;
  transcript: StepTranscript;
  store: EventStore;
  now: () => number;
  enforceToolCallBudget: boolean;
  state: StepLoopToolBudgetState;
}): Promise<StepLoopToolBudgetResult> {
  const state = { ...params.state };
  if (state.remainingToolCalls > 0) {
    return { kind: 'continue', state };
  }

  if (params.enforceToolCallBudget) {
    return exhausted(params.budget, params.transcript, state.remainingToolCalls);
  }

  if (!state.warned) {
    await params.store.append({
      type: 'budget-exhausted',
      at: params.now(),
      goalId: params.goal.id,
      dimension: 'toolCalls',
    });
    state.warned = true;
  }

  return state.toolCallsMade >= state.hardToolCallCap
    ? exhausted(params.budget, params.transcript, state.remainingToolCalls)
    : { kind: 'continue', state };
}

export function updateRemainingToolCallContext(
  transcript: StepTranscript,
  remainingToolCalls: number,
): void {
  const message = remainingToolCallMessage(remainingToolCalls);
  const lastMessage = transcript[transcript.length - 1];
  if (lastMessage?.role === 'context') {
    lastMessage.content = message;
    return;
  }
  transcript.push({ role: 'context', content: message });
}

export function remainingToolCallMessage(remainingToolCalls: number): string {
  return remainingToolCalls > 0
    ? `${remainingToolCalls} tool calls remaining`
    : `tool-call budget exceeded (over by ${-remainingToolCalls}); converge and emit the artifact now`;
}

function exhausted(
  budget: Budget,
  transcript: StepTranscript,
  remainingToolCalls: number,
): Extract<StepLoopToolBudgetResult, { kind: 'exhausted' }> {
  return {
    kind: 'exhausted',
    budget: { ...budget, toolCalls: remainingToolCalls },
    transcript,
  };
}
