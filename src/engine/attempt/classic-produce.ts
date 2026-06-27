import type { Brain, BrainContext } from '../../contract/brain.js';
import type { EventStore } from '../../contract/events.js';
import type { Budget, Goal, Usage } from '../../contract/goal.js';
import type { Artifact } from '../../contract/report.js';
import { debitTokenUsage } from '../budget-events.js';

export type ClassicProduceResult =
  | { kind: 'artifact'; artifact: Artifact; budget: Budget }
  | { kind: 'ceiling'; budget: Budget };

export async function produceClassicArtifact(params: {
  goal: Goal;
  ctx: BrainContext;
  budget: Budget;
  brain: Brain;
  store: EventStore;
  now: () => number;
  debitUsage: (usage: Usage) => void;
  hasReachedCeiling: () => boolean;
}): Promise<ClassicProduceResult> {
  const produceResult = await params.brain.produce(params.goal, params.ctx);
  params.debitUsage(produceResult.usage);

  await params.store.append({
    type: 'produced',
    at: params.now(),
    goalId: params.goal.id,
    usage: produceResult.usage,
  });

  if (params.hasReachedCeiling()) {
    return { kind: 'ceiling', budget: params.budget };
  }

  const budget = await debitTokenUsage({
    budget: params.budget,
    usage: produceResult.usage,
    goal: params.goal,
    store: params.store,
    now: params.now,
  });

  return {
    kind: 'artifact',
    artifact: produceResult.value,
    budget,
  };
}
