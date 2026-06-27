import type { Brain, BrainContext, StepTranscript } from '../contract/brain.js';
import type { EventStore } from '../contract/events.js';
import type { Goal, Usage } from '../contract/goal.js';
import type { GoalTypeDef } from '../contract/goal-type.js';
import type { Artifact } from '../contract/report.js';

export interface StepEmitState {
  remainingToolCalls: number;
  stepIndex: number;
  totalTokensUsed: number;
  exploreReadCalls: number;
}

export type ForcedEmitResult =
  | { kind: 'artifact'; artifact: Artifact; state: StepEmitState }
  | { kind: 'failed'; error: string; state: StepEmitState }
  | { kind: 'ceiling'; state: StepEmitState };

export type StructuredArtifactEmitResult =
  | { kind: 'artifact'; artifact: Artifact; state: StepEmitState }
  | { kind: 'exhausted'; state: StepEmitState }
  | { kind: 'failed'; error: string; state: StepEmitState }
  | { kind: 'ceiling'; state: StepEmitState };

export interface ForcedEmitParams {
  goal: Goal;
  typeDef: GoalTypeDef;
  ctx: BrainContext;
  transcript: StepTranscript;
  brain: Brain;
  store: EventStore;
  now: () => number;
  state: StepEmitState;
  debitUsage: (usage: Usage) => void;
  checkCeiling: () => Promise<boolean>;
}

export interface StructuredArtifactEmitParams {
  goal: Goal;
  outputSchema: Record<string, unknown>;
  ctx: BrainContext;
  transcript: StepTranscript;
  brain: Brain;
  store: EventStore;
  now: () => number;
  enforceToolCallBudget: boolean;
  state: StepEmitState;
  debitUsage: (usage: Usage) => void;
  checkCeiling: () => Promise<boolean>;
}

export async function runForcedEmit(params: ForcedEmitParams): Promise<ForcedEmitResult> {
  const state = { ...params.state };
  params.transcript.push({
    role: 'context',
    content: forcedEmitInstruction(state.exploreReadCalls, params.typeDef),
  });

  const forceCtx: BrainContext =
    params.typeDef.outputSchema !== undefined
      ? { ...params.ctx, outputSchema: params.typeDef.outputSchema }
      : params.ctx;

  const forcedOutput = await runNoToolBrainStep(params.brain, params.goal, params.transcript, forceCtx);
  if (!forcedOutput.ok) {
    return { kind: 'failed', error: forcedOutput.error, state };
  }

  await recordStepOutput(params, state, forcedOutput.value);
  state.totalTokensUsed += forcedOutput.value.usage.promptTokens + forcedOutput.value.usage.completionTokens;
  state.stepIndex++;

  if (await params.checkCeiling()) {
    return { kind: 'ceiling', state };
  }

  if (forcedOutput.value.kind === 'artifact') {
    return { kind: 'artifact', artifact: forcedOutput.value.artifact, state };
  }

  return {
    kind: 'failed',
    error:
      `ignored the malform-recovery forced emit after ${state.exploreReadCalls} ` +
      `read-class calls`,
    state,
  };
}

export async function runStructuredArtifactEmit(
  params: StructuredArtifactEmitParams,
): Promise<StructuredArtifactEmitResult> {
  const state = { ...params.state };
  params.transcript.push({
    role: 'context',
    content: 'Emit the final artifact now: respond with ONLY the JSON object matching the required schema.',
  });

  if (params.enforceToolCallBudget && state.remainingToolCalls <= 0) {
    return { kind: 'exhausted', state };
  }

  params.transcript.push({
    role: 'context',
    content:
      state.remainingToolCalls > 0
        ? `${state.remainingToolCalls} tool calls remaining`
        : `tool-call budget exceeded; emit the final artifact now`,
  });

  const emitOutput = await runNoToolBrainStep(params.brain, params.goal, params.transcript, {
    ...params.ctx,
    outputSchema: params.outputSchema,
  });
  if (!emitOutput.ok) {
    return { kind: 'failed', error: emitOutput.error, state };
  }

  await recordStepOutput(params, state, emitOutput.value);
  state.totalTokensUsed += emitOutput.value.usage.promptTokens + emitOutput.value.usage.completionTokens;
  state.stepIndex++;

  if (await params.checkCeiling()) {
    return { kind: 'ceiling', state };
  }

  await recordTransportIncidents(params, emitOutput.value);

  if (emitOutput.value.kind !== 'artifact') {
    return { kind: 'failed', error: 'emit call returned tool-calls instead of an artifact', state };
  }

  return { kind: 'artifact', artifact: emitOutput.value.artifact, state };
}

function forcedEmitInstruction(exploreReadCalls: number, typeDef: GoalTypeDef): string {
  const readCountPhrase =
    exploreReadCalls > 0
      ? `You have read enough (${exploreReadCalls} read-class calls). STOP reading. `
      : '';
  return readCountPhrase +
    `Emit the artifact NOW from what you have already ` +
    `read — over-reading a bounded region is a failure, not thoroughness. ` +
    (typeDef.outputSchema !== undefined
      ? 'Respond with ONLY the JSON object matching the required schema, no tool calls.'
      : 'Respond with ONLY the artifact as your message content, no tool calls.');
}

async function runNoToolBrainStep(
  brain: Brain,
  goal: Goal,
  transcript: StepTranscript,
  ctx: BrainContext,
): Promise<
  | { ok: true; value: Awaited<ReturnType<Brain['step']>> }
  | { ok: false; error: string }
> {
  try {
    return { ok: true, value: await brain.step(goal, transcript, [], ctx) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function recordStepOutput(
  params: Pick<ForcedEmitParams, 'goal' | 'store' | 'now' | 'debitUsage'>,
  state: Pick<StepEmitState, 'stepIndex'>,
  output: Awaited<ReturnType<Brain['step']>>,
): Promise<void> {
  await params.store.append({
    type: 'step',
    at: params.now(),
    goalId: params.goal.id,
    index: state.stepIndex,
    outputKind: output.kind,
    usage: output.usage,
  });
  params.debitUsage(output.usage);
}

async function recordTransportIncidents(
  params: Pick<StructuredArtifactEmitParams, 'goal' | 'store'>,
  output: Awaited<ReturnType<Brain['step']>>,
): Promise<void> {
  if (output.incidents === undefined) {
    return;
  }
  for (const incident of output.incidents) {
    await params.store.append({
      type: incident.kind,
      at: incident.at,
      goalId: params.goal.id,
      detail: incident.detail,
    });
  }
}
