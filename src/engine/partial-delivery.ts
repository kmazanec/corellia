/**
 * Ship-what's-green: elect a partial delivery at root collection (issue A5).
 *
 * ADR-037 stopped a blocked-but-partial dependency from cascade-blocking its
 * dependents. What remains is the downstream half: when children GENUINELY block
 * producing nothing, the root today emits an all-or-nothing block even if most of
 * the tree is green. This module decides — from the final root report and the
 * worktree — whether to COLLECT the green subtree (and open a PR for it) with the
 * blocked modules enumerated, instead of preserving the whole tree.
 *
 * The decision is deliberately conservative and honest:
 *   - It fires only when real green work was delivered (a worktree diff exists) —
 *     an all-blocked tree is preserved exactly as before.
 *   - It fires only when the ONLY blockers are child-module blocks. A root-level
 *     acceptance/integration failure (the root's own judges rejecting what WAS
 *     delivered) still gates: a partial that fails acceptance is not shipped.
 *   - The report's `blockers` stay populated and the blocked modules are
 *     enumerated — no silent partiality.
 */

import type { Report } from '../contract/report.js';
import { treeDiffWithinScope } from './worktree.js';

export interface PartialDeliveryDecision {
  /** Collect the green subtree (PR path) rather than preserve the whole tree. */
  shipGreen: boolean;
  /** Why — for the event/audit trail and the operator. */
  reason: string;
}

/** The delivered-work signal decidePartialDeliveryFor consumes (a worktree diff). */
export interface DeliveredDiff {
  /** In-scope files changed since base. Zero means no green work delivered. */
  changedCount: number;
  /** False when the diff escaped the declared scope. */
  ok: boolean;
  scopeInsufficiency?: string;
}

/**
 * Decide whether a blocked root report should ship its green subtree.
 *
 * Only a report that actually blocked (`blockers.length > 0`) is a candidate;
 * a clean report collects normally and never reaches here. Reads the worktree
 * diff to confirm real green work exists, then defers to the pure predicate.
 */
export function decidePartialDelivery(params: {
  report: Report;
  worktreeRoot: string;
  baseSha: string;
  scope: string[];
}): PartialDeliveryDecision {
  const diff = treeDiffWithinScope(params.worktreeRoot, params.baseSha, params.scope);
  return decidePartialDeliveryFor(params.report, diff);
}

/**
 * The pure ship-what's-green predicate: given a blocked report and the delivered
 * diff, decide whether to ship the green subtree. Separated from the git read so
 * the honesty rules are testable without a worktree.
 */
export function decidePartialDeliveryFor(report: Report, diff: DeliveredDiff): PartialDeliveryDecision {
  const partial = report.partialDelivery;
  if (partial === undefined || partial.blockedModules.length === 0) {
    return { shipGreen: false, reason: 'no blocked child modules to ship around' };
  }

  // The root's own acceptance/integration judges run against what WAS delivered.
  // If any blocker is NOT one of the child-module blockers, it is a root-level
  // failure (integration eval, unmet acceptance, hollow/scope gate) — the green
  // work itself did not pass, so we must NOT ship it. Honesty over completion.
  const childBlockers = new Set(partial.childBlockers);
  const rootBlockers = report.blockers.filter((b) => !childBlockers.has(b));
  if (rootBlockers.length > 0) {
    return {
      shipGreen: false,
      reason: `root-level acceptance/integration failure blocks the delivered work: ${rootBlockers[0]}`,
    };
  }

  // At least one child must have delivered real work — otherwise there is no green
  // subtree to ship. Gate on the actual worktree diff, not on a proxy (same
  // discipline as the hollow-emit gate).
  if (diff.changedCount === 0) {
    return { shipGreen: false, reason: 'no green work delivered (empty worktree diff) — nothing to ship' };
  }

  // A partial that also escaped scope is not clean-green: preserve for inspection
  // rather than ship an out-of-scope diff.
  if (!diff.ok) {
    return {
      shipGreen: false,
      reason: `delivered work escaped declared scope: ${diff.scopeInsufficiency ?? 'diff exceeds scope'}`,
    };
  }

  const count = partial.blockedModules.length;
  return {
    shipGreen: true,
    reason: `shipping green subtree; ${count} module(s) blocked and are enumerated for the operator`,
  };
}

/**
 * A human-readable block of the blocked modules, for the PR body / report so the
 * partiality is unmissable to whoever merges the green work.
 */
export function renderBlockedModules(report: Report): string {
  const partial = report.partialDelivery;
  if (partial === undefined || partial.blockedModules.length === 0) return '';
  const lines = partial.blockedModules.map((m) => `- ${m.title} (${m.goalId}): ${m.blocker}`);
  return `Partial delivery — ${partial.blockedModules.length} module(s) blocked and were NOT delivered:\n${lines.join('\n')}`;
}
