import type { EventStore } from '../contract/events.js';
import type { Goal } from '../contract/goal.js';
import type { MemoryView } from '../contract/memory.js';
import type { Report } from '../contract/report.js';
import type {
  CheckpointShaMemo,
  CheckpointVerifyGateway,
} from './checkpoint-verify.js';
import { verifyKnowledgeAtCheckpoint } from './checkpoint-verify.js';
import {
  appendChildSpawnedEvents,
  buildSplitChildGoals,
} from './split-children.js';

/**
 * The integrate checkpoint's verify-on-read (DESIGN "checkpoint consistency").
 * Re-read the depended-on knowledge before the integration judge renders its
 * verdict; if a fact drifted and failed self-validation, spawn its refresh
 * comprehension child (the same one the split gate would mint) and run it to
 * completion so the fresh fact is in the store when the verdict is rendered —
 * never against a fact a sibling, a human, or the tree's own commits invalidated.
 *
 * The refresh runs against the already-assembled tree exactly like the repair
 * rung's fixer: a dependency-free child scoped by the mint, spawned and evented
 * like any other child. A no-drift result — or absent knowledge wiring — is a
 * no-op, so a run without knowledge is byte-identical to before.
 */
export async function refreshDriftedKnowledgeBeforeIntegrate(params: {
  goal: Goal;
  memory: MemoryView;
  store: EventStore;
  now: () => number;
  activeRepoRoot: string | undefined;
  checkpointKnowledge?: CheckpointVerifyGateway | undefined;
  checkpointShaMemo: CheckpointShaMemo;
  runChild: (goal: Goal) => Promise<Report>;
}): Promise<void> {
  if (params.checkpointKnowledge === undefined) return;

  const { refreshChildren, drifted } = await verifyKnowledgeAtCheckpoint({
    goal: params.goal,
    repoRoot: params.activeRepoRoot ?? '',
    knowledge: params.checkpointKnowledge,
    checkpoint: 'integrate',
    shaMemo: params.checkpointShaMemo,
    store: params.store,
    now: params.now,
  });
  if (!drifted || refreshChildren.length === 0) return;

  const refreshGoals = await buildSplitChildGoals({
    parent: params.goal,
    children: refreshChildren,
    memory: params.memory,
  });
  await appendChildSpawnedEvents({
    parent: params.goal,
    children: refreshChildren,
    childGoals: refreshGoals,
    store: params.store,
    now: params.now,
  });
  for (const refreshGoal of refreshGoals) {
    await params.runChild(refreshGoal);
  }
}
