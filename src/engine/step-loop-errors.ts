import type { StepTranscript } from '../contract/brain.js';
import { MalformedStepError, StepTransportError } from '../contract/brain.js';
import type { EventStore } from '../contract/events.js';
import type { Budget, Goal } from '../contract/goal.js';
import type { Scratchpad } from './scratchpad.js';
import { type StepLoopResult } from './step-loop-result.js';
import { evictTranscriptAfterTruncation } from './step-loop-transcript.js';

export type StepLoopStepErrorResult =
  | { kind: 'recover'; malformRecoveryUsed: true; forceEmitNext: true }
  | { kind: 'failed'; result: Extract<StepLoopResult, { kind: 'failed' }> };

export async function handleStepLoopStepError(params: {
  err: unknown;
  goal: Goal;
  budget: Budget;
  remainingToolCalls: number;
  transcript: StepTranscript;
  scratchpad: Scratchpad;
  store: EventStore;
  now: () => number;
  seenCalls: Set<string>;
  callKeyByCallId: Map<string, string>;
  malformRecoveryUsed: boolean;
  truncationEvictionCap?: number;
}): Promise<StepLoopStepErrorResult> {
  if (params.err instanceof MalformedStepError && !params.malformRecoveryUsed) {
    await recoverMalformedStep(params, params.err);
    return { kind: 'recover', malformRecoveryUsed: true, forceEmitNext: true };
  }

  return {
    kind: 'failed',
    result: {
      kind: 'failed',
      error: params.err instanceof Error ? params.err.message : String(params.err),
      failKind: stepFailureKind(params.err),
      budget: { ...params.budget, toolCalls: params.remainingToolCalls },
      transcript: params.transcript,
    },
  };
}

async function recoverMalformedStep(
  params: Omit<Parameters<typeof handleStepLoopStepError>[0], 'err'>,
  err: MalformedStepError,
): Promise<void> {
  await params.store.append({
    type: 'malformation-reprompt',
    at: params.now(),
    goalId: params.goal.id,
    detail: err.truncated
      ? 'malformed+truncated tool-call — forcing a clean emit'
      : 'malformed tool-call — forcing a clean emit',
  });

  if (err.truncated) {
    await evictTranscriptAfterTruncation({
      goal: params.goal,
      transcript: params.transcript,
      scratchpad: params.scratchpad,
      store: params.store,
      now: params.now,
      seenCalls: params.seenCalls,
      callKeyByCallId: params.callKeyByCallId,
      ...(params.truncationEvictionCap !== undefined ? { cap: params.truncationEvictionCap } : {}),
    });
  }

  params.transcript.push({
    role: 'context',
    content:
      `Your previous tool-call output was malformed${err.truncated ? ' or cut off' : ''} ` +
      `and could not be parsed. Do NOT repeat it. Make a SMALLER move now: ` +
      `emit the final artifact directly (matching the required schema if one ` +
      `applies), not a large or partial tool call.`,
  });
}

function stepFailureKind(err: unknown): 'failed' | 'malformed' | 'transport' {
  if (err instanceof MalformedStepError) return 'malformed';
  if (err instanceof StepTransportError) return 'transport';
  // A raw abort/timeout that escaped the adapter's own wrapping (paths outside
  // fetchStepResponse: the malformed-step reprompt, the eviction summarizer)
  // is still a transport incident, not non-convergence. Left as 'failed' it
  // produced the step-loop:failed signature that isomorphic-blocked goals on
  // flaky provider windows (live-tail runs 1, 7, 9: "The operation was
  // aborted due to timeout").
  if (
    err instanceof Error &&
    (err.name === 'AbortError' || err.name === 'TimeoutError' || err.message.includes('timeout'))
  ) {
    return 'transport';
  }
  return 'failed';
}
