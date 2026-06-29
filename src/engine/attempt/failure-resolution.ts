import type { Goal, Tier, Usage } from '../../contract/goal.js';
import type { Artifact } from '../../contract/report.js';
import type { Verdict } from '../../contract/verdict.js';
import { debitTreeState, hasReachedSpendCeiling } from '../tree-spend.js';
import {
  resolveAttemptFailure,
  type AttemptFailureResolution,
} from './failure.js';
import { salvageWorktreeArtifact } from './worktree-salvage.js';
import type { AttemptLoopContext } from './loop.js';

export function handleAttemptFailure(params: {
  context: AttemptLoopContext;
  artifact: Artifact;
  verdict: Verdict;
  budget: Goal['budget'];
  tier: Tier;
  tierIndex: number;
  priorAttempt: { artifact: Artifact | null; verdict: Verdict } | undefined;
}): Promise<AttemptFailureResolution> {
  return resolveAttemptFailure({
    goal: params.context.goal,
    artifact: params.artifact,
    verdict: params.verdict,
    budget: params.budget,
    tier: params.tier,
    tierIndex: params.tierIndex,
    tierLadder: params.context.tierLadder,
    priorAttempt: params.priorAttempt,
    salvagedArtifact: blockSalvage(params.context),
    brain: params.context.deps.brain,
    store: params.context.deps.store,
    now: params.context.deps.now,
    onBrief: params.context.deps.onBrief(),
    debitUsage: (usage: Usage) => debitTreeState(params.context.treeState, usage),
    hasReachedCeiling: () => hasReachedSpendCeiling(params.context.treeState),
    onCeilingReached: () =>
      params.context.deps.ceilingReport(params.context.goal, params.context.treeState),
  });
}

/**
 * Partial work to carry on a blocked report: for a make goal with a sandbox, the
 * in-scope files written to the worktree. Null for non-make goals, no sandbox, or
 * an empty worktree — the report's artifact stays null, exactly as before.
 */
function blockSalvage(context: AttemptLoopContext): Artifact | null {
  if (context.typeDef.kind !== 'make') return null;
  const root = context.deps.sandboxRepoRoot();
  if (root === undefined) return null;
  return salvageWorktreeArtifact(root, context.goal.scope) ?? null;
}
