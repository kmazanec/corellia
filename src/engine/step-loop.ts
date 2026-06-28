import type { Brain, BrainContext, StepOutput, StepTranscript } from '../contract/brain.js';
import type { EventStore } from '../contract/events.js';
import type { Budget, Goal, Usage } from '../contract/goal.js';
import type { GoalTypeDef } from '../contract/goal-type.js';
import type { ToolBroker, ToolDef } from '../contract/tool.js';
import { runForcedEmit, runStructuredArtifactEmit } from './step-loop-emit.js';
import { handleStepLoopStepError } from './step-loop-errors.js';
import {
  checkStepLoopToolBudget,
  updateRemainingToolCallContext,
} from './step-loop-budget.js';
import { routeStepToolCalls } from './step-loop-router.js';
import { createStepLoopSession } from './step-loop-session.js';
import { recordStepOutput } from './step-loop-step.js';
import { boundStepLoopTranscript } from './step-loop-transcript.js';
import type { StepLoopResult } from './step-loop-result.js';

export async function runStepLoop(params: {
  goal: Goal;
  grants: string[];
  budget: Budget;
  ctx: BrainContext;
  typeDef: GoalTypeDef;
  broker: ToolBroker & { defs?: () => ToolDef[] };
  sandboxRepoRoot: string | undefined;
  priorTranscript: StepTranscript | undefined;
  priorRejectionReasons: string[] | undefined;
  brain: Brain;
  store: EventStore;
  now: () => number;
  enforceToolCallBudget: boolean;
  debitUsage: (usage: Usage) => void;
  hasReachedCeiling: () => boolean;
}): Promise<StepLoopResult> {
  const session = createStepLoopSession({
    goal: params.goal,
    grants: params.grants,
    budget: params.budget,
    typeDef: params.typeDef,
    broker: params.broker,
    sandboxRepoRoot: params.sandboxRepoRoot,
    priorTranscript: params.priorTranscript,
    priorRejectionReasons: params.priorRejectionReasons,
  });
  const {
    tools,
    transcript,
    scratchpad,
    seenCalls,
    callKeyByCallId,
    isExploreThenEmit,
    hardToolCallCap,
  } = session;
  let {
    remainingToolCalls,
    toolCallsMade,
    stepIndex,
    exploreReadCalls,
    readCalls,
    writeCalls,
    readWithoutWriteNudged,
    totalTokensUsed,
    toolBudgetWarned,
    forceEmitNext,
    malformRecoveryUsed,
  } = session.counters;

  while (true) {
    const budgetGate = await checkStepLoopToolBudget({
      goal: params.goal,
      budget: params.budget,
      transcript,
      store: params.store,
      now: params.now,
      enforceToolCallBudget: params.enforceToolCallBudget,
      state: {
        remainingToolCalls,
        toolCallsMade,
        warned: toolBudgetWarned,
        hardToolCallCap,
      },
    });
    if (budgetGate.kind === 'exhausted') {
      return budgetGate;
    }
    toolBudgetWarned = budgetGate.state.warned;

    updateRemainingToolCallContext(transcript, remainingToolCalls);

    if (forceEmitNext) {
      forceEmitNext = false;
      const forcedEmit = await runForcedEmit({
        goal: params.goal,
        typeDef: params.typeDef,
        ctx: params.ctx,
        transcript,
        brain: params.brain,
        store: params.store,
        now: params.now,
        state: { remainingToolCalls, stepIndex, totalTokensUsed, exploreReadCalls },
        debitUsage: params.debitUsage,
        checkCeiling: async () => params.hasReachedCeiling(),
      });
      ({ stepIndex, totalTokensUsed } = forcedEmit.state);
      if (forcedEmit.kind === 'ceiling') {
        return ceilingResult(params.budget, remainingToolCalls, transcript);
      }
      if (forcedEmit.kind === 'artifact') {
        return artifactResult(
          params.budget,
          remainingToolCalls,
          transcript,
          totalTokensUsed,
          forcedEmit.artifact,
        );
      }
      return failedResult(params.budget, remainingToolCalls, transcript, forcedEmit.error);
    }

    await boundStepLoopTranscript({
      goal: params.goal,
      transcript,
      scratchpad,
      store: params.store,
      now: params.now,
      seenCalls,
      callKeyByCallId,
      summarizeRead: params.brain.summarize !== undefined
        ? (text) => params.brain.summarize!(text, params.ctx)
        : undefined,
      debitUsage: params.debitUsage,
    });

    let stepOutput: StepOutput;
    try {
      stepOutput = await params.brain.step(params.goal, transcript, tools, params.ctx);
    } catch (err) {
      const stepError = await handleStepLoopStepError({
        err,
        goal: params.goal,
        budget: params.budget,
        remainingToolCalls,
        transcript,
        scratchpad,
        store: params.store,
        now: params.now,
        seenCalls,
        callKeyByCallId,
        malformRecoveryUsed,
      });
      if (stepError.kind === 'recover') {
        malformRecoveryUsed = stepError.malformRecoveryUsed;
        forceEmitNext = stepError.forceEmitNext;
        continue;
      }
      return stepError.result;
    }

    const recordedStep = await recordStepOutput({
      goal: params.goal,
      output: stepOutput,
      state: { stepIndex, totalTokensUsed },
      store: params.store,
      now: params.now,
      debitUsage: params.debitUsage,
      hasReachedCeiling: params.hasReachedCeiling,
    });
    ({ stepIndex, totalTokensUsed } = recordedStep.state);
    if (recordedStep.kind === 'ceiling') {
      return ceilingResult(params.budget, remainingToolCalls, transcript);
    }

    if (stepOutput.kind === 'artifact') {
      if (params.typeDef.outputSchema !== undefined) {
        const structuredEmit = await runStructuredArtifactEmit({
          goal: params.goal,
          outputSchema: params.typeDef.outputSchema,
          ctx: params.ctx,
          transcript,
          brain: params.brain,
          store: params.store,
          now: params.now,
          enforceToolCallBudget: params.enforceToolCallBudget,
          state: { remainingToolCalls, stepIndex, totalTokensUsed, exploreReadCalls },
          debitUsage: params.debitUsage,
          checkCeiling: async () => params.hasReachedCeiling(),
        });
        ({ stepIndex, totalTokensUsed } = structuredEmit.state);
        if (structuredEmit.kind === 'exhausted') {
          return exhaustedResult(params.budget, remainingToolCalls, transcript);
        }
        if (structuredEmit.kind === 'ceiling') {
          return ceilingResult(params.budget, remainingToolCalls, transcript);
        }
        if (structuredEmit.kind === 'failed') {
          return failedResult(params.budget, remainingToolCalls, transcript, structuredEmit.error);
        }
        return artifactResult(
          params.budget,
          remainingToolCalls,
          transcript,
          totalTokensUsed,
          structuredEmit.artifact,
        );
      }

      return artifactResult(
        params.budget,
        remainingToolCalls,
        transcript,
        totalTokensUsed,
        stepOutput.artifact,
      );
    }

    const routing = await routeStepToolCalls({
      goal: params.goal,
      calls: stepOutput.calls,
      budget: params.budget,
      transcript,
      scratchpad,
      broker: params.broker,
      store: params.store,
      now: params.now,
      enforceToolCallBudget: params.enforceToolCallBudget,
      isExploreThenEmit,
      typeDef: params.typeDef,
      seenCalls,
      callKeyByCallId,
      state: {
        remainingToolCalls,
        toolCallsMade,
        exploreReadCalls,
        readCalls,
        writeCalls,
        readWithoutWriteNudged,
      },
    });
    if (routing.kind === 'exhausted') {
      return routing;
    }
    ({
      remainingToolCalls,
      toolCallsMade,
      exploreReadCalls,
      readCalls,
      writeCalls,
      readWithoutWriteNudged,
    } = routing.state);
  }
}

function exhaustedResult(
  budget: Budget,
  remainingToolCalls: number,
  transcript: StepTranscript,
): Extract<StepLoopResult, { kind: 'exhausted' }> {
  return { kind: 'exhausted', budget: loopBudget(budget, remainingToolCalls), transcript };
}

function ceilingResult(
  budget: Budget,
  remainingToolCalls: number,
  transcript: StepTranscript,
): Extract<StepLoopResult, { kind: 'ceiling' }> {
  return { kind: 'ceiling', budget: loopBudget(budget, remainingToolCalls), transcript };
}

function failedResult(
  budget: Budget,
  remainingToolCalls: number,
  transcript: StepTranscript,
  error: string,
): Extract<StepLoopResult, { kind: 'failed' }> {
  return { kind: 'failed', error, budget: loopBudget(budget, remainingToolCalls), transcript };
}

function artifactResult(
  budget: Budget,
  remainingToolCalls: number,
  transcript: StepTranscript,
  tokensUsed: number,
  artifact: Extract<StepLoopResult, { kind: 'artifact' }>['artifact'],
): Extract<StepLoopResult, { kind: 'artifact' }> {
  return {
    kind: 'artifact',
    artifact,
    budget: loopBudget(budget, remainingToolCalls),
    transcript,
    tokensUsed,
  };
}

function loopBudget(budget: Budget, remainingToolCalls: number): Budget {
  return { ...budget, toolCalls: remainingToolCalls };
}
