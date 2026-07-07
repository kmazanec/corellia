import type { ChildPlan } from '../contract/decision.js';
import type { EventStore } from '../contract/events.js';
import type { Goal } from '../contract/goal.js';
import type { KnowledgeArtifact } from '../contract/knowledge.js';
import type { KnowledgeForCoverage, MissingRequirement } from '../library/coverage.js';
import { checkpointVerifyArtifacts } from './coverage-checkpoint.js';

/**
 * The verify-on-read a consistency checkpoint runs before it acts on a fact
 * (DESIGN "Branches coordinate through shared state, by pull — checkpoint
 * consistency"): re-read the depended-on knowledge, and if a fact drifted and no
 * longer self-validates, mint a refresh so the checkpoint acts on fresh
 * knowledge instead of a silently-stale one. One mechanism serves all three
 * checkpoints (decide / split / integrate); the split gate already composes
 * `checkpointVerifyArtifacts` inline, so this wrapper is what the decide and
 * integrate edges call.
 */
export interface CheckpointVerifyGateway {
  query: (repoRoot: string) => Promise<KnowledgeForCoverage>;
  headSha: (repoRoot: string) => Promise<string>;
  validate: (artifact: KnowledgeArtifact) => Promise<boolean>;
  mintComprehension: (missing: MissingRequirement[]) => ChildPlan[];
}

/**
 * A per-tree memo of the HEAD SHA at which each repo was last fully verified.
 * The cheap fast path: if HEAD has not moved since the last checkpoint, no fact
 * can have drifted, so an unchanged repo costs one `headSha` call and skips the
 * artifact query + per-artifact self-validation entirely. Keyed by repoRoot so a
 * multi-repo tree memoizes each independently. Constructed once per tree and
 * threaded to every checkpoint; a fresh Map means "verify from scratch".
 */
export type CheckpointShaMemo = Map<string, string>;

export function createCheckpointShaMemo(): CheckpointShaMemo {
  return new Map<string, string>();
}

export interface CheckpointVerifyResult {
  /** Comprehension children to inject as dependencies before the checkpoint acts. */
  refreshChildren: ChildPlan[];
  /** True when a depended-on fact drifted and failed self-validation. */
  drifted: boolean;
}

const CLEAN: CheckpointVerifyResult = { refreshChildren: [], drifted: false };

/**
 * Run verify-on-read at a decide or integrate checkpoint. Returns the refresh
 * children to inject (empty when nothing drifted) and whether any fact drifted —
 * so the caller can force a re-decision / re-integration instead of acting on
 * the stale fact.
 *
 * Cost discipline: consult the SHA memo first. When HEAD equals the last-verified
 * SHA for this repo, return CLEAN after a single `headSha` call. Only on a HEAD
 * move do we query artifacts and self-validate the drifted ones (the existing
 * per-artifact SHA short-circuit inside `checkpointVerifyArtifacts` then skips any
 * artifact that already matches the new HEAD).
 *
 * The memo advances to the current HEAD whenever this HEAD has been *processed* —
 * whether it verified clean or the checkpoint minted refreshes for the drifted
 * facts. The refreshes are handled once per HEAD (run inline at integrate, or
 * sequenced ahead of fan-out by the split gate that follows a decide), so a later
 * checkpoint at the same HEAD must not re-mint them; it acts only on a genuinely
 * newer HEAD. This is the "bounded staleness — at most one checkpoint interval
 * stale" contract: each checkpoint reconciles its own HEAD exactly once.
 */
export async function verifyKnowledgeAtCheckpoint(params: {
  goal: Goal;
  repoRoot: string;
  knowledge: CheckpointVerifyGateway;
  checkpoint: 'decide' | 'integrate';
  shaMemo: CheckpointShaMemo;
  store: EventStore;
  now: () => number;
}): Promise<CheckpointVerifyResult> {
  if (params.repoRoot.length === 0) return CLEAN;

  const headSha = await params.knowledge.headSha(params.repoRoot);
  if (params.shaMemo.get(params.repoRoot) === headSha) {
    return CLEAN;
  }

  const knowledgeState = await params.knowledge.query(params.repoRoot);
  const { refreshChildren } = await checkpointVerifyArtifacts({
    goal: params.goal,
    knowledge: knowledgeState,
    repoRoot: params.repoRoot,
    knowledgeGateway: params.knowledge,
    store: params.store,
    now: params.now,
    checkpoint: params.checkpoint,
  });

  // This HEAD is now reconciled (clean, or its drift handed to a refresh) — record
  // it so the next checkpoint at the same HEAD short-circuits instead of re-minting
  // the same refresh.
  params.shaMemo.set(params.repoRoot, knowledgeState.headSha);

  if (refreshChildren.length === 0) return CLEAN;
  return { refreshChildren, drifted: true };
}
