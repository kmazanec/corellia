/**
 * Write helpers for knowledge events — thin, typed wrappers so producers
 * (map-repo, deep-dive-region, freshness checkpoints) don't hand-roll
 * `knowledge-written` / `knowledge-facts-written` / `knowledge-checked` events.
 *
 * Each helper appends exactly one event and returns void; the store is the
 * caller's concern (InMemory, JSONL, or pg).
 */

import type { EventStore } from '../contract/events.js';
import type { KnowledgeArtifact, KnowledgeCategory, RegionFacts } from '../contract/knowledge.js';

/**
 * Append a `knowledge-written` event recording the latest artifact the producer
 * generated for a repo × category. The projection will replace any prior artifact
 * for the same key and reset freshness to 'fresh'.
 */
export async function writeKnowledge(
  store: EventStore,
  goalId: string,
  artifact: KnowledgeArtifact,
): Promise<void> {
  await store.append({
    type: 'knowledge-written',
    at: Date.now(),
    goalId,
    artifact,
  });
}

/**
 * Append a `knowledge-facts-written` event recording the dive facts a
 * deep-dive-region run produced for a repo × region. The projection will replace
 * any prior facts for the same key.
 */
export async function writeRegionFacts(
  store: EventStore,
  goalId: string,
  facts: RegionFacts,
): Promise<void> {
  await store.append({
    type: 'knowledge-facts-written',
    at: Date.now(),
    goalId,
    facts,
  });
}

/**
 * Append a `knowledge-checked` event recording the outcome of the freshness
 * checkpoint a consumer ran against an artifact (verify-on-read, ADR-019).
 */
export async function recordKnowledgeCheck(
  store: EventStore,
  goalId: string,
  check: { repoRoot: string; category: KnowledgeCategory; sha: string; outcome: 'fresh' | 'stale-validated' | 'invalid' },
): Promise<void> {
  await store.append({
    type: 'knowledge-checked',
    at: Date.now(),
    goalId,
    repoRoot: check.repoRoot,
    category: check.category,
    sha: check.sha,
    outcome: check.outcome,
  });
}
