import type { StepTranscript } from '../contract/brain.js';
import type { EventStore } from '../contract/events.js';
import type { Budget, Goal } from '../contract/goal.js';
import type { GoalTypeDef } from '../contract/goal-type.js';
import type { ToolBroker, ToolCall } from '../contract/tool.js';
import {
  shouldNudgeReadWithoutWrite,
  readWithoutWriteNudge,
} from './make-progress-nudge.js';
import { addNote, type Scratchpad } from './scratchpad.js';
import {
  READ_ONLY_TOOL_NAMES,
  dupKey,
  invalidateReadGuardForPath,
} from './step-loop-guards.js';
import { summarizeToolArgs } from './tool-call-summary.js';

export interface StepToolRoutingState {
  remainingToolCalls: number;
  toolCallsMade: number;
  exploreReadCalls: number;
  /** Read-class calls made so far (any goal) — drives the read-without-write nudge. */
  readCalls: number;
  /** write_file calls that succeeded so far — drives the read-without-write nudge. */
  writeCalls: number;
  /** Whether the read-without-write nudge has already fired this attempt. */
  readWithoutWriteNudged: boolean;
}

export type StepToolRoutingResult =
  | { kind: 'routed'; state: StepToolRoutingState }
  | { kind: 'exhausted'; budget: Budget; transcript: StepTranscript };

export interface StepToolRoutingParams {
  goal: Goal;
  calls: ToolCall[];
  budget: Budget;
  transcript: StepTranscript;
  scratchpad: Scratchpad;
  broker: ToolBroker;
  store: EventStore;
  now: () => number;
  enforceToolCallBudget: boolean;
  isExploreThenEmit: boolean;
  typeDef: GoalTypeDef;
  seenCalls: Set<string>;
  callKeyByCallId: Map<string, string>;
  state: StepToolRoutingState;
}

export async function routeStepToolCalls(params: StepToolRoutingParams): Promise<StepToolRoutingResult> {
  const state = { ...params.state };
  params.transcript.push({
    role: 'assistant',
    content: '',
    toolCalls: params.calls,
  });

  for (const call of params.calls) {
    if (call.name === 'note') {
      await routeNoteToolCall(params, call);
      continue;
    }

    if (params.enforceToolCallBudget && state.remainingToolCalls <= 0) {
      return {
        kind: 'exhausted',
        budget: { ...params.budget, toolCalls: state.remainingToolCalls },
        transcript: params.transcript,
      };
    }

    if (await refuseDuplicateRead(params, call)) {
      continue;
    }

    const result = await params.broker.execute(params.goal, call);
    state.remainingToolCalls--;
    state.toolCallsMade++;
    if (READ_ONLY_TOOL_NAMES.has(call.name)) {
      state.readCalls++;
      if (params.isExploreThenEmit) state.exploreReadCalls++;
    }
    if (call.name === 'write_file' && result.ok) {
      state.writeCalls++;
    }

    const summary = summarizeToolArgs(call.args);
    await params.store.append({
      type: 'tool-call',
      at: params.now(),
      goalId: params.goal.id,
      tool: call.name,
      callId: call.id,
      outcome: result.ok ? 'ran' : 'refused',
      ...(result.ok ? {} : { reason: result.output }),
      ...(summary !== undefined ? { args: summary } : {}),
    });

    if (call.name === 'write_file' && result.ok) {
      const writtenPath = typeof call.args['path'] === 'string' ? call.args['path'] : undefined;
      if (writtenPath !== undefined) {
        invalidateReadGuardForPath(params.seenCalls, writtenPath);
      }
    }

    params.transcript.push({
      role: 'tool',
      callId: call.id,
      content: result.output,
    });
  }

  if (
    shouldNudgeReadWithoutWrite({
      typeDef: params.typeDef,
      readCalls: state.readCalls,
      writeCalls: state.writeCalls,
      alreadyNudged: state.readWithoutWriteNudged,
    })
  ) {
    state.readWithoutWriteNudged = true;
    params.transcript.push({ role: 'context', content: readWithoutWriteNudge(state.readCalls) });
  }

  return { kind: 'routed', state };
}

async function routeNoteToolCall(params: StepToolRoutingParams, call: ToolCall): Promise<void> {
  const text = typeof call.args['text'] === 'string' ? call.args['text'] : '';
  const landed = addNote(params.scratchpad, text);
  const summary = summarizeToolArgs(call.args);
  await params.store.append({
    type: 'tool-call',
    at: params.now(),
    goalId: params.goal.id,
    tool: 'note',
    callId: call.id,
    outcome: landed ? 'ran' : 'refused',
    ...(landed ? {} : { reason: 'note: empty text ignored' }),
    ...(summary !== undefined ? { args: summary } : {}),
  });
  params.transcript.push({
    role: 'tool',
    callId: call.id,
    content: landed ? 'Noted.' : 'note: empty text ignored',
  });
}

async function refuseDuplicateRead(params: StepToolRoutingParams, call: ToolCall): Promise<boolean> {
  if (!READ_ONLY_TOOL_NAMES.has(call.name)) {
    return false;
  }

  const key = dupKey(call.name, call.args);
  if (!params.seenCalls.has(key)) {
    params.seenCalls.add(key);
    params.callKeyByCallId.set(call.id, key);
    return false;
  }

  const refusalReason =
    `Duplicate read refused (F-64): an identical call to ${call.name} with the ` +
    `same arguments was already executed this attempt. Use the earlier result ` +
    `already in the transcript instead of re-reading.`;
  const summary = summarizeToolArgs(call.args);
  await params.store.append({
    type: 'tool-call',
    at: params.now(),
    goalId: params.goal.id,
    tool: call.name,
    callId: call.id,
    outcome: 'refused',
    reason: refusalReason,
    ...(summary !== undefined ? { args: summary } : {}),
  });
  params.transcript.push({
    role: 'tool',
    callId: call.id,
    content: refusalReason,
  });
  return true;
}
