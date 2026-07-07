import type { StepTranscript } from '../contract/brain.js';
import { MalformedStepError, isTransportErrorLike } from '../contract/brain.js';
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

  // A step TIMEOUT gets the same one-shot in-loop recovery as a malformed
  // step, with an eviction first: the dominant live cause is a transcript
  // grown large enough that the provider cannot answer within the tier's
  // timeout (runs 16–17: author-acceptance-criteria died mid-read at ~50
  // reads / ~75K prompt tokens, every tier). Failing the ATTEMPT just replays
  // the same oversized transcript tail into the same timeout; shrinking the
  // context and forcing a best-effort emit converts a fatal timeout into a
  // deliverable. A second timeout falls through and fails as transport.
  if (stepFailureKind(params.err) === 'transport' && !params.malformRecoveryUsed) {
    await recoverTimedOutStep(params);
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

async function recoverTimedOutStep(
  params: Omit<Parameters<typeof handleStepLoopStepError>[0], 'err'>,
): Promise<void> {
  await params.store.append({
    type: 'malformation-reprompt',
    at: params.now(),
    goalId: params.goal.id,
    detail: 'step request timed out — evicting context and forcing a clean emit',
  });

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

  params.transcript.push({
    role: 'context',
    content:
      `The previous request could not complete (the provider timed out under the ` +
      `accumulated context, which has now been trimmed). Do NOT read anything ` +
      `else. Emit the final artifact directly from what you already know` +
      `, matching the required schema if one applies.`,
  });
}

function stepFailureKind(err: unknown): 'failed' | 'malformed' | 'transport' {
  if (err instanceof MalformedStepError) return 'malformed';
  // The shared predicate covers the typed StepTransportError, raw
  // aborts/timeouts that escaped the adapter's wrapping, and network-layer
  // fetch failures (undici "terminated", resets) — all provider faults, not
  // non-convergence. Left as 'failed' they produced the step-loop:failed
  // signature that isomorphic-blocked goals on flaky provider windows
  // (live-tail runs 1, 7, 9, 21).
  if (isTransportErrorLike(err)) return 'transport';
  return 'failed';
}
