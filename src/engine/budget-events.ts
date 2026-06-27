import type { EventStore } from '../contract/events.js';
import type { Budget, Goal, Usage } from '../contract/goal.js';
import { consumeN } from './budget.js';

export async function debitTokenUsage(params: {
  budget: Budget;
  usage: Usage;
  goal: Goal;
  store: EventStore;
  now: () => number;
  emitOnlyOnCrossing?: boolean;
}): Promise<Budget> {
  return debitTokenCount({
    budget: params.budget,
    tokens: params.usage.promptTokens + params.usage.completionTokens,
    goal: params.goal,
    store: params.store,
    now: params.now,
    ...(params.emitOnlyOnCrossing !== undefined
      ? { emitOnlyOnCrossing: params.emitOnlyOnCrossing }
      : {}),
  });
}

export async function debitTokenCount(params: {
  budget: Budget;
  tokens: number;
  goal: Goal;
  store: EventStore;
  now: () => number;
  emitOnlyOnCrossing?: boolean;
}): Promise<Budget> {
  if (params.tokens <= 0) return params.budget;

  const consumed = consumeN(params.budget, 'tokens', params.tokens);
  const alreadyExhausted = params.budget.tokens <= 0;
  if (consumed.exhausted && !(params.emitOnlyOnCrossing === true && alreadyExhausted)) {
    await params.store.append({
      type: 'budget-exhausted',
      at: params.now(),
      goalId: params.goal.id,
      dimension: 'tokens',
    });
  }
  return consumed.budget;
}
