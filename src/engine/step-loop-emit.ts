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

  const forcedOutput = await runForcedBrainStep(params, forceCtx);
  if (!forcedOutput.ok) {
    return { kind: 'failed', error: forcedOutput.error, state };
  }

  await params.store.append({
    type: 'step',
    at: params.now(),
    goalId: params.goal.id,
    index: state.stepIndex,
    outputKind: forcedOutput.value.kind,
    usage: forcedOutput.value.usage,
  });
  params.debitUsage(forcedOutput.value.usage);
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

async function runForcedBrainStep(
  params: ForcedEmitParams,
  forceCtx: BrainContext,
): Promise<
  | { ok: true; value: Awaited<ReturnType<Brain['step']>> }
  | { ok: false; error: string }
> {
  try {
    return { ok: true, value: await params.brain.step(params.goal, params.transcript, [], forceCtx) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
