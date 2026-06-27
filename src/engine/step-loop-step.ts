import type { StepOutput } from '../contract/brain.js';
import type { EventStore } from '../contract/events.js';
import type { Goal, Usage } from '../contract/goal.js';

export interface StepProgressState {
  stepIndex: number;
  totalTokensUsed: number;
}

export type RecordedStepOutput =
  | { kind: 'recorded'; state: StepProgressState }
  | { kind: 'ceiling'; state: StepProgressState };

export async function recordStepOutput(params: {
  goal: Goal;
  output: StepOutput;
  state: StepProgressState;
  store: EventStore;
  now: () => number;
  debitUsage: (usage: Usage) => void;
  hasReachedCeiling: () => boolean;
}): Promise<RecordedStepOutput> {
  const state = { ...params.state };

  await params.store.append({
    type: 'step',
    at: params.now(),
    goalId: params.goal.id,
    index: state.stepIndex,
    outputKind: params.output.kind,
    usage: params.output.usage,
  });
  params.debitUsage(params.output.usage);

  state.totalTokensUsed += params.output.usage.promptTokens + params.output.usage.completionTokens;
  state.stepIndex++;

  if (params.hasReachedCeiling()) {
    return { kind: 'ceiling', state };
  }

  await appendTransportIncidents(params.goal, params.store, params.output);
  return { kind: 'recorded', state };
}

async function appendTransportIncidents(
  goal: Goal,
  store: EventStore,
  output: StepOutput,
): Promise<void> {
  if (output.incidents === undefined) {
    return;
  }
  for (const incident of output.incidents) {
    await store.append({
      type: incident.kind,
      at: incident.at,
      goalId: goal.id,
      detail: incident.detail,
    });
  }
}
