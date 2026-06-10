/**
 * Pure projection functions over FactoryEvent[]. Every read-model the factory
 * surfaces — memory state, per-type stats, run tree — is derived here by folding
 * the event log with no side effects.
 */

import type { FactoryEvent } from '../contract/events.js';
import type { MemoryPointer } from '../contract/goal.js';
import type { MemoryView } from '../contract/memory.js';

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
    query(topic: string, _scope: string[]): MemoryPointer[] {
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
    }
  }

  return result;
}

// ──────────────────────────────────────────────
// renderTree
// ──────────────────────────────────────────────

/** Status glyph for a goal's terminal state. */
function statusGlyph(
  goalId: string,
  events: FactoryEvent[],
): string {
  // Emitted with a passing deterministic-checked or judge-verdict → ✓
  const emitted = events.some((e) => e.type === 'emitted' && e.goalId === goalId);
  if (emitted) {
    const hasPass =
      events.some(
        (e) =>
          (e.type === 'deterministic-checked' || e.type === 'judge-verdict') &&
          e.goalId === goalId &&
          e.verdict.pass,
      );
    return hasPass ? '✓' : '✓';
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
