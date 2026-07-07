/**
 * Pure projection functions over FactoryEvent[]. Every read-model the factory
 * surfaces — memory state, per-type stats, run tree — is derived here by folding
 * the event log with no side effects.
 */

import type { FactoryEvent } from '../contract/events.js';
import type { MemoryPointer, Tier, Usage } from '../contract/goal.js';
import type { MemoryView } from '../contract/memory.js';
import type { KnowledgeArtifact, KnowledgeCategory, RegionFacts } from '../contract/knowledge.js';

// ──────────────────────────────────────────────
// projectMemory
// ──────────────────────────────────────────────

/** Internal bookkeeping per memory entry while folding the log. */
interface MemorySlot {
  pointer: MemoryPointer;
  successCount: number;
  failureCount: number;
}

/**
 * Fold memory-written and memory-reinforced events into a MemoryView.
 *
 * Promotion rule: after 2 reinforced-success events a pointer's provenance
 * becomes 'trusted'. Decay rule: after 2 reinforced-failure events the pointer
 * is evicted from the projection entirely.
 *
 * query(topic, scope) returns pointers whose content contains the topic
 * (case-insensitive substring). The scope parameter is accepted for interface
 * compliance but is not used for filtering in this skeleton — content match is
 * the sole relevance signal.
 */
export function projectMemory(events: FactoryEvent[]): MemoryView {
  const slots = new Map<string, MemorySlot>();

  for (const e of events) {
    if (e.type === 'memory-written') {
      // Write initialises or replaces the slot; reset counters on overwrite.
      slots.set(e.pointer.id, {
        pointer: { ...e.pointer },
        successCount: 0,
        failureCount: 0,
      });
    } else if (e.type === 'memory-reinforced') {
      const slot = slots.get(e.memoryId);
      if (!slot) continue; // Reinforcement for an already-evicted memory — skip.

      if (e.outcome === 'success') {
        slot.successCount += 1;
        if (slot.successCount >= 2) {
          slot.pointer = { ...slot.pointer, provenance: 'trusted' };
        }
      } else {
        slot.failureCount += 1;
        if (slot.failureCount >= 2) {
          slots.delete(e.memoryId);
        }
      }
    }
  }

  return {
    async query(topic: string, _scope: string[]): Promise<MemoryPointer[]> {
      const lower = topic.toLowerCase();
      const results: MemoryPointer[] = [];
      for (const { pointer } of slots.values()) {
        if (pointer.content.toLowerCase().includes(lower)) {
          results.push({ ...pointer });
        }
      }
      return results;
    },
  };
}

// ──────────────────────────────────────────────
// projectPatternTrust
// ──────────────────────────────────────────────

export type PatternTrustStatus = 'provisional' | 'trusted';

export function projectPatternTrust(
  events: FactoryEvent[],
  opts: { upToIndex?: number } = {},
): Map<string, PatternTrustStatus> {
  const trust = new Map<string, PatternTrustStatus>();
  const limit = opts.upToIndex ?? events.length;

  for (const e of events.slice(0, limit)) {
    if (e.type === 'pattern-recorded') {
      if (!trust.has(e.shape)) trust.set(e.shape, 'provisional');
    } else if (e.type === 'pattern-trust-signed') {
      trust.set(e.shape, e.to);
    }
  }

  return trust;
}

// ──────────────────────────────────────────────
// traceStats
// ──────────────────────────────────────────────

export interface GoalTypeStats {
  attempts: number;
  passes: number;
  failures: number;
  repairs: number;
  escalations: number;
}

/**
 * Aggregate per-goal-type stats from the event log.
 *
 * Goal type comes from the goal-received event's goal.type. Counts are rolled
 * up across all goals of that type:
 *   - attempts    = distinct goalIds that received a goal-received event
 *   - passes      = deterministic-checked or judge-verdict events with pass verdict
 *   - failures    = deterministic-checked or judge-verdict events with fail verdict
 *   - repairs     = repair-applied events
 *   - escalations = tier-escalated events
 */
export function traceStats(events: FactoryEvent[]): Record<string, GoalTypeStats> {
  // First pass: map goalId → goal type.
  const goalType = new Map<string, string>();
  for (const e of events) {
    if (e.type === 'goal-received') {
      goalType.set(e.goalId, e.goal.type);
    }
  }

  const defaultStats = (): GoalTypeStats => ({
    attempts: 0,
    passes: 0,
    failures: 0,
    repairs: 0,
    escalations: 0,
  });

  const ensure = (type: string): GoalTypeStats => {
    let s = result[type];
    if (!s) {
      s = defaultStats();
      result[type] = s;
    }
    return s;
  };

  const result: Record<string, GoalTypeStats> = {};

  // Track which goalIds we've counted as attempts to avoid double-counting
  // if somehow goal-received fires twice (defensive).
  const counted = new Set<string>();

  for (const e of events) {
    const type = goalType.get(e.goalId);
    if (!type) continue; // Event for a goal we never saw goal-received for — skip.

    const s = ensure(type);

    switch (e.type) {
      case 'goal-received':
        if (!counted.has(e.goalId)) {
          counted.add(e.goalId);
          s.attempts += 1;
        }
        break;

      case 'deterministic-checked':
        if (e.verdict.pass) s.passes += 1;
        else s.failures += 1;
        break;

      case 'judge-verdict':
        if (e.verdict.pass) s.passes += 1;
        else s.failures += 1;
        break;

      case 'repair-applied':
        s.repairs += 1;
        break;

      case 'tier-escalated':
        s.escalations += 1;
        break;

      // Iteration-3 members do not contribute to the per-type stats yet; a
      // later projection counts tool, step, script, worktree, and spend events.
      case 'tool-call':
      case 'step':
      case 'script-ran':
      case 'capture-ran':
      case 'worktree-created':
      case 'worktree-collected':
      case 'worktree-preserved':
      case 'worktree-reaped':
      case 'files-touched':
      case 'partial-delivered':
      case 'produced':
      case 'ceiling-reached':
      case 'transport-retry':
      case 'malformation-reprompt':
      case 'knowledge-written':
      case 'knowledge-facts-written':
      case 'knowledge-checked':
      case 'golden-candidate':
      case 'branch-pushed':
      case 'pr-opened':
      case 'blocker-routed':
        break;
    }
  }

  return result;
}

// ──────────────────────────────────────────────
// toolCallSignal — per-tier model-capability signal (ADR-044, issue D2)
// ──────────────────────────────────────────────

/** The tier band a goal's events are attributed to, or 'unknown' when unobservable. */
export type SignalTier = Tier | 'unknown';

/**
 * Per-tier tool-calling health, folded from the event log. The fields are exactly
 * what the events genuinely support (no invented model id per event):
 *
 * - `steps`         — `step` events attributed to the tier (the denominator).
 * - `malformations` — `malformation-reprompt` events: a step whose tool-call
 *   arguments could not be parsed and needed a corrective re-prompt. This is the
 *   honest per-tier tool-calling-weakness signal — a model that keeps emitting
 *   unparseable tool calls is failing tool calls.
 * - `transportRetries` — `transport-retry` events (endpoint flakiness, not a model
 *   capability signal; reported for context, never as the flag reason).
 * - `toolCallsRan` / `toolCallsRefused` — broker outcomes; refusals are governance
 *   (out-of-scope, denied), NOT tool-calling weakness, so they inform but do not
 *   trigger the flag.
 * - `escalationsFrom` — `tier-escalated` events leaving this tier (a tier a goal
 *   routinely escalates OUT of is one whose model under-served the band).
 */
export interface TierToolCallStats {
  steps: number;
  malformations: number;
  transportRetries: number;
  toolCallsRan: number;
  toolCallsRefused: number;
  escalationsFrom: number;
  /**
   * malformations / steps when steps > 0, else undefined. The flag threshold is
   * applied to THIS rate — a tier whose steps routinely produce malformed tool
   * calls should have its catalog model re-tagged (weaker toolCalling) or replaced.
   */
  malformationRate: number | undefined;
}

/** The full per-tier signal plus the tier→resolved-model mapping at run config. */
export interface ToolCallSignal {
  byTier: Record<SignalTier, TierToolCallStats>;
  /**
   * The tier→model mapping in force for the run, if the caller supplies it (from
   * the brain config's `modelByTier`). The events do NOT carry the model id per
   * step, so this mapping is how a reader connects a failing tier to a concrete
   * model to re-tag. Absent when the caller has no config to hand.
   */
  modelByTier: Record<Tier, string> | undefined;
}

function emptyTierStats(): TierToolCallStats {
  return {
    steps: 0,
    malformations: 0,
    transportRetries: 0,
    toolCallsRan: 0,
    toolCallsRefused: 0,
    escalationsFrom: 0,
    malformationRate: undefined,
  };
}

/**
 * Fold per-tier tool-calling health from the event log (ADR-044; covers issue
 * D2, "no model-capability signal").
 *
 * ATTRIBUTION: the events do not stamp a tier on `step` / `tool-call` /
 * `malformation-reprompt`, so each goal's current tier is reconstructed by
 * replay: a goal's tier is seeded the first time it is observable — the `from` of
 * its first `tier-escalated`, or a `judge-verdict.tier` — and advanced by each
 * subsequent `tier-escalated`. Events for a goal whose tier is never observable
 * are attributed to `'unknown'` (honest: the log genuinely does not say). This is
 * why `modelByTier` is reported alongside — it is the only bridge from a flagged
 * tier to a concrete model id, since no event carries the model.
 *
 * @param events - the event log.
 * @param modelByTier - optional tier→model map (the run's brain config) so a
 *   reader can name the model behind a flagged tier.
 */
export function toolCallSignal(
  events: FactoryEvent[],
  modelByTier?: Record<Tier, string>,
): ToolCallSignal {
  // First pass: reconstruct each goal's tier trajectory as an ordered list of
  // (eventIndex, tier) so a later event attributes to the tier in force at its time.
  const tierAt = new Map<string, { index: number; tier: Tier }[]>();
  const noteTier = (goalId: string, index: number, tier: Tier): void => {
    const seq = tierAt.get(goalId);
    if (!seq) {
      tierAt.set(goalId, [{ index, tier }]);
    } else {
      seq.push({ index, tier });
    }
  };
  for (let i = 0; i < events.length; i++) {
    const e = events[i]!;
    if (e.type === 'tier-escalated') {
      // The first escalation reveals BOTH the pre-escalation tier (from) and the
      // post (to): seed with `from` at its own index if the goal has no earlier
      // anchor, then record `to` from this point on.
      if (!tierAt.has(e.goalId)) noteTier(e.goalId, i, e.from);
      noteTier(e.goalId, i, e.to);
    } else if (e.type === 'judge-verdict') {
      if (!tierAt.has(e.goalId)) noteTier(e.goalId, i, e.tier);
    }
  }

  const tierForEvent = (goalId: string, index: number): SignalTier => {
    const seq = tierAt.get(goalId);
    if (!seq) return 'unknown';
    // The tier in force at `index` is the last anchor at or before it; if the
    // event precedes the first anchor, use the earliest known tier (the goal ran
    // at some tier before it was first observable — the earliest is the best guess).
    let current: Tier = seq[0]!.tier;
    for (const anchor of seq) {
      if (anchor.index <= index) current = anchor.tier;
      else break;
    }
    return current;
  };

  const byTier: Record<SignalTier, TierToolCallStats> = {
    low: emptyTierStats(),
    mid: emptyTierStats(),
    high: emptyTierStats(),
    unknown: emptyTierStats(),
  };

  for (let i = 0; i < events.length; i++) {
    const e = events[i]!;
    switch (e.type) {
      case 'step':
        byTier[tierForEvent(e.goalId, i)].steps += 1;
        break;
      case 'malformation-reprompt':
        byTier[tierForEvent(e.goalId, i)].malformations += 1;
        break;
      case 'transport-retry':
        byTier[tierForEvent(e.goalId, i)].transportRetries += 1;
        break;
      case 'tool-call':
        if (e.outcome === 'ran') byTier[tierForEvent(e.goalId, i)].toolCallsRan += 1;
        else byTier[tierForEvent(e.goalId, i)].toolCallsRefused += 1;
        break;
      case 'tier-escalated':
        byTier[e.from].escalationsFrom += 1;
        break;
      default:
        break;
    }
  }

  for (const stats of Object.values(byTier)) {
    stats.malformationRate = stats.steps > 0 ? stats.malformations / stats.steps : undefined;
  }

  return { byTier, modelByTier };
}

// ──────────────────────────────────────────────
// costSummary
// ──────────────────────────────────────────────

/** Accumulated token and dollar totals for a set of events. */
export interface UsageTotals {
  promptTokens: number;
  completionTokens: number;
  cachedPromptTokens: number;
  costUsd: number | undefined;
  /**
   * Fraction of prompt tokens that were served from the provider cache.
   * Defined as cachedPromptTokens / promptTokens when promptTokens > 0
   * AND at least one usage in the set reported cached tokens.
   * Undefined when no usage in the set reported cached tokens.
   */
  cacheHitShare: number | undefined;
}

/** Per-goal and tree-wide aggregated usage totals from the event log. */
export interface CostSummary {
  byGoal: Record<string, UsageTotals>;
  tree: UsageTotals;
}

/** Mutable accumulator — hasCached tracks whether any usage reported cachedPromptTokens. */
interface Accumulator {
  promptTokens: number;
  completionTokens: number;
  cachedPromptTokens: number;
  hasCached: boolean;
  costUsd: number | undefined;
}

function addUsage(acc: Accumulator, usage: Usage): void {
  acc.promptTokens += usage.promptTokens;
  acc.completionTokens += usage.completionTokens;
  if (usage.cachedPromptTokens !== undefined) {
    acc.cachedPromptTokens += usage.cachedPromptTokens;
    acc.hasCached = true;
  }
  if (usage.costUsd !== undefined) {
    acc.costUsd = (acc.costUsd ?? 0) + usage.costUsd;
  }
}

function emptyAcc(): Accumulator {
  return { promptTokens: 0, completionTokens: 0, cachedPromptTokens: 0, hasCached: false, costUsd: undefined };
}

function finalise(acc: Accumulator): UsageTotals {
  const cacheHitShare =
    acc.hasCached && acc.promptTokens > 0
      ? acc.cachedPromptTokens / acc.promptTokens
      : undefined;
  return {
    promptTokens: acc.promptTokens,
    completionTokens: acc.completionTokens,
    cachedPromptTokens: acc.cachedPromptTokens,
    costUsd: acc.costUsd,
    cacheHitShare,
  };
}

/**
 * Fold usage-bearing events into per-goal and per-tree token/dollar totals.
 *
 * Events that carry usage: produced (required), decided (optional),
 * judge-verdict (optional), repair-applied (optional), step (optional).
 * All other event members are visited but do not contribute to cost totals.
 * Satisfies the exhaustive-switch discipline from ADR-003.
 */
export function costSummary(events: FactoryEvent[]): CostSummary {
  const byGoal: Record<string, Accumulator> = {};
  const tree: Accumulator = emptyAcc();

  const ensure = (goalId: string): Accumulator => {
    let t = byGoal[goalId];
    if (!t) {
      t = emptyAcc();
      byGoal[goalId] = t;
    }
    return t;
  };

  for (const e of events) {
    switch (e.type) {
      case 'produced': {
        const t = ensure(e.goalId);
        addUsage(t, e.usage);
        addUsage(tree, e.usage);
        break;
      }

      case 'decided': {
        if (e.usage !== undefined) {
          const t = ensure(e.goalId);
          addUsage(t, e.usage);
          addUsage(tree, e.usage);
        }
        break;
      }

      case 'judge-verdict': {
        if (e.usage !== undefined) {
          const t = ensure(e.goalId);
          addUsage(t, e.usage);
          addUsage(tree, e.usage);
        }
        break;
      }

      case 'repair-applied': {
        if (e.usage !== undefined) {
          const t = ensure(e.goalId);
          addUsage(t, e.usage);
          addUsage(tree, e.usage);
        }
        break;
      }

      case 'step': {
        if (e.usage !== undefined) {
          const t = ensure(e.goalId);
          addUsage(t, e.usage);
          addUsage(tree, e.usage);
        }
        break;
      }

      case 'goal-received':
      case 'gate-checked':
      case 'child-spawned':
      case 'deterministic-checked':
      case 'tier-escalated':
      case 'blocked':
      case 'memory-written':
      case 'memory-reinforced':
      case 'emitted':
      case 'budget-exhausted':
      case 'risk-classified':
      case 'gate-decision':
      case 'parked':
      case 'resumed':
      case 'pattern-consulted':
      case 'pattern-recorded':
      case 'pattern-trust-signed':
      case 'tool-call':
      case 'script-ran':
      case 'capture-ran':
      case 'worktree-created':
      case 'worktree-collected':
      case 'worktree-preserved':
      case 'worktree-reaped':
      case 'files-touched':
      case 'partial-delivered':
      case 'ceiling-reached':
      case 'transport-retry':
      case 'malformation-reprompt':
      case 'knowledge-written':
      case 'knowledge-facts-written':
      case 'knowledge-checked':
      case 'golden-candidate':
      case 'branch-pushed':
      case 'pr-opened':
      case 'blocker-routed':
        break;
    }
  }

  const finalisedByGoal: Record<string, UsageTotals> = {};
  for (const [id, t] of Object.entries(byGoal)) {
    finalisedByGoal[id] = finalise(t);
  }
  return { byGoal: finalisedByGoal, tree: finalise(tree) };
}

// ──────────────────────────────────────────────
// projectKnowledge
// ──────────────────────────────────────────────

/** Freshness state layered on top of an artifact by knowledge-checked events. */
export type ArtifactFreshness = 'fresh' | 'stale-validated' | 'invalid';

/** The projection's view of one artifact: the artifact itself plus its current freshness. */
export interface ArtifactEntry {
  artifact: KnowledgeArtifact;
  freshness: ArtifactFreshness;
}

/** The full knowledge state projected from the event log. */
export interface KnowledgeView {
  /**
   * Latest artifact per repo × category key (`${repoRoot}::${category}`).
   * A subsequent knowledge-written for the same key replaces the previous one
   * and resets freshness to 'fresh'.
   */
  artifacts: Map<string, ArtifactEntry>;
  /**
   * Latest dive facts per repo × region key (`${repoRoot}::${region}`).
   * A subsequent knowledge-facts-written for the same key replaces the previous one.
   */
  diveFacts: Map<string, RegionFacts>;
}

/**
 * Fold knowledge-written, knowledge-facts-written, and knowledge-checked events
 * into a KnowledgeView.
 *
 * Latest-wins per key: a new knowledge-written for the same repo × category
 * replaces the previous artifact and resets freshness to 'fresh'. A
 * knowledge-checked event updates the freshness of the artifact at that key
 * without replacing the artifact. A knowledge-facts-written replaces the
 * previous RegionFacts for the same repo × region.
 *
 * All other event members are visited but do not contribute. Exhaustive switch
 * ensures the union is covered as new members are added.
 */
export function projectKnowledge(events: FactoryEvent[]): KnowledgeView {
  const artifacts = new Map<string, ArtifactEntry>();
  const diveFacts = new Map<string, RegionFacts>();

  for (const e of events) {
    switch (e.type) {
      case 'knowledge-written': {
        const key = `${e.artifact.repoRoot}::${e.artifact.category}`;
        artifacts.set(key, { artifact: { ...e.artifact, pointers: e.artifact.pointers.map((p) => ({ ...p })) }, freshness: 'fresh' });
        break;
      }

      case 'knowledge-facts-written': {
        const key = `${e.facts.repoRoot}::${e.facts.region}`;
        diveFacts.set(key, { ...e.facts, facts: e.facts.facts.map((f) => ({ ...f, anchors: f.anchors.map((a) => ({ ...a })) })) });
        break;
      }

      case 'knowledge-checked': {
        const key = `${e.repoRoot}::${e.category}`;
        const entry = artifacts.get(key);
        if (entry) {
          artifacts.set(key, { ...entry, freshness: e.outcome });
        }
        // If there is no artifact yet for this key, the check is a no-op: there
        // is nothing to update freshness on.
        break;
      }

      case 'goal-received':
      case 'gate-checked':
      case 'decided':
      case 'child-spawned':
      case 'deterministic-checked':
      case 'judge-verdict':
      case 'repair-applied':
      case 'tier-escalated':
      case 'blocked':
      case 'memory-written':
      case 'memory-reinforced':
      case 'emitted':
      case 'budget-exhausted':
      case 'risk-classified':
      case 'gate-decision':
      case 'parked':
      case 'resumed':
      case 'pattern-consulted':
      case 'pattern-recorded':
      case 'pattern-trust-signed':
      case 'tool-call':
      case 'step':
      case 'script-ran':
      case 'capture-ran':
      case 'worktree-created':
      case 'worktree-collected':
      case 'worktree-preserved':
      case 'worktree-reaped':
      case 'files-touched':
      case 'partial-delivered':
      case 'produced':
      case 'ceiling-reached':
      case 'transport-retry':
      case 'malformation-reprompt':
      case 'golden-candidate':
      case 'branch-pushed':
      case 'pr-opened':
      case 'blocker-routed':
        break;
    }
  }

  return { artifacts, diveFacts };
}

// ──────────────────────────────────────────────
// renderTree
// ──────────────────────────────────────────────

/** Status glyph for a goal's terminal state. */
function statusGlyph(
  goalId: string,
  events: FactoryEvent[],
): string {
  // Find the emitted event for this goal
  const emittedEvent = events.find((e) => e.type === 'emitted' && e.goalId === goalId);
  if (emittedEvent && emittedEvent.type === 'emitted') {
    // An emitted report with non-empty blockers is a failure
    return emittedEvent.report.blockers.length > 0 ? '✗' : '✓';
  }

  const isBlocked = events.some((e) => e.type === 'blocked' && e.goalId === goalId);
  if (isBlocked) return '✗';

  return '◌'; // Still in flight.
}

/**
 * Build an ASCII tree of the run from the event log.
 *
 * Each line: `<indent><glyph> [<type>] <title>`.
 * Stable ordering by the position of the first goal-received event in the log.
 */
export function renderTree(events: FactoryEvent[]): string {
  interface Node {
    goalId: string;
    goalType: string;
    title: string;
    parentId: string | null;
    order: number; // Index of first-seen goal-received event for stable sort.
    children: string[];
  }

  const nodes = new Map<string, Node>();

  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if (!e || e.type !== 'goal-received') continue;
    if (nodes.has(e.goalId)) continue; // Already seen — keep first-seen order.
    nodes.set(e.goalId, {
      goalId: e.goalId,
      goalType: e.goal.type,
      title: e.goal.title,
      parentId: e.goal.parentId,
      order: i,
      children: [],
    });
  }

  // Wire up parent→child links; collect roots.
  const roots: Node[] = [];
  for (const node of nodes.values()) {
    if (node.parentId !== null && nodes.has(node.parentId)) {
      nodes.get(node.parentId)!.children.push(node.goalId);
    } else {
      roots.push(node);
    }
  }

  // Sort children by first-seen order for deterministic output.
  const sortChildren = (n: Node): void => {
    n.children.sort((a, b) => {
      const na = nodes.get(a);
      const nb = nodes.get(b);
      return (na?.order ?? 0) - (nb?.order ?? 0);
    });
    for (const childId of n.children) {
      const child = nodes.get(childId);
      if (child) sortChildren(child);
    }
  };

  roots.sort((a, b) => a.order - b.order);
  for (const root of roots) sortChildren(root);

  const lines: string[] = [];

  const visit = (nodeId: string, indent: string): void => {
    const node = nodes.get(nodeId);
    if (!node) return;
    const glyph = statusGlyph(node.goalId, events);
    lines.push(`${indent}${glyph} [${node.goalType}] ${node.title}`);
    for (const childId of node.children) {
      visit(childId, indent + '  ');
    }
  };

  for (const root of roots) visit(root.goalId, '');

  return lines.join('\n');
}

// ──────────────────────────────────────────────
// goldenCandidates
// ──────────────────────────────────────────────

/**
 * The exogenous ground-truth outcome joined to a candidate from a `golden-label`
 * event: the label itself, who/what delivered it, and optional context.
 */
export interface GoldenLabel {
  outcome: 'merged' | 'rejected' | 'confirmed' | 'refuted';
  source: string;
  note?: string;
  at: number;
}

/**
 * One captured golden-set candidate: a reference to a judge run (by digest)
 * plus provenance fields (verdict, tier, model when available). When an
 * exogenous `golden-label` for the same tree (goalId) exists, `label` carries
 * the ground truth the candidate can be curated and calibrated against.
 */
export interface GoldenCandidate {
  goalId: string;
  judgeType: string;
  artifactDigest: string;
  rubricDigest: string;
  verdictPass: boolean;
  tier: import('../contract/goal.js').Tier;
  model?: string;
  at: number;
  /** The exogenous outcome, joined by goalId. Absent until a label arrives. */
  label?: GoldenLabel;
}

/**
 * Fold `golden-candidate` events into a per-judgeType index, joining each
 * candidate to its exogenous `golden-label` (by `goalId`) when one exists.
 *
 * A tree's golden candidates and its outcome label are separate append-only
 * events (the label arrives later, from a merge/rejection or a human verdict —
 * ADR-024). This projection is the join: every candidate for a labeled tree
 * carries the label; the LAST label appended for a tree wins (a re-label
 * corrects an earlier one). Latest-appended order within each judgeType group
 * is preserved. Only `golden-candidate` and `golden-label` events contribute.
 */
export function goldenCandidates(events: FactoryEvent[]): Record<string, GoldenCandidate[]> {
  const labelByGoal = new Map<string, GoldenLabel>();
  for (const e of events) {
    if (e.type === 'golden-label') {
      labelByGoal.set(e.goalId, {
        outcome: e.outcome,
        source: e.source,
        at: e.at,
        ...(e.note !== undefined ? { note: e.note } : {}),
      });
    }
  }

  const result: Record<string, GoldenCandidate[]> = {};

  for (const e of events) {
    if (e.type === 'golden-candidate') {
      const bucket = result[e.judgeType];
      const label = labelByGoal.get(e.goalId);
      const candidate: GoldenCandidate = {
        goalId: e.goalId,
        judgeType: e.judgeType,
        artifactDigest: e.artifactDigest,
        rubricDigest: e.rubricDigest,
        verdictPass: e.verdictPass,
        tier: e.tier,
        at: e.at,
        ...(e.model !== undefined ? { model: e.model } : {}),
        ...(label !== undefined ? { label } : {}),
      };
      if (bucket) {
        bucket.push(candidate);
      } else {
        result[e.judgeType] = [candidate];
      }
    }
  }

  return result;
}

/**
 * The labeled subset of {@link goldenCandidates}: only candidates joined to an
 * exogenous outcome, grouped per judgeType. These are the pairs curation
 * promotes into a versioned golden set — a candidate without a label is not yet
 * ground truth, so it is filtered out here (empty judgeType groups are dropped).
 */
export function labeledGoldenCandidates(
  events: FactoryEvent[],
): Record<string, Array<GoldenCandidate & { label: GoldenLabel }>> {
  const all = goldenCandidates(events);
  const result: Record<string, Array<GoldenCandidate & { label: GoldenLabel }>> = {};
  for (const [judgeType, candidates] of Object.entries(all)) {
    const labeled = candidates.filter(
      (c): c is GoldenCandidate & { label: GoldenLabel } => c.label !== undefined,
    );
    if (labeled.length > 0) result[judgeType] = labeled;
  }
  return result;
}
