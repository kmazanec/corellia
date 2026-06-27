import type { Usage } from '../contract/goal.js';

/**
 * Per-tree spend ceiling default (learning phase, ADR-017).
 * Applied at the root when Goal.spendCeilingUsd is absent.
 */
export const DEFAULT_SPEND_CEILING_USD = 15;

/**
 * Worst-case price constant for the conservative token-only ceiling fallback
 * (ADR-017). Used when an endpoint reports tokens but not cost.
 * Covers output-token worst-case for high-tier models (~$0.000025/token).
 * The fallback fires only on cost-silent endpoints; over-conservatism just
 * halts earlier, which is preferable to under-bounding real spend.
 */
export const WORST_CASE_PRICE_PER_TOKEN = 0.000025;

/**
 * Mutable tree-scoped accumulator for the dollar ceiling. Created once at the
 * root run() call and passed by reference through all recursive child runs so
 * the whole tree shares a single spend counter. Never subdivided.
 */
export interface TreeState {
  /** Running total of reported costUsd across all brain calls in the tree. */
  spentUsd: number;
  /**
   * The dollar ceiling for this tree. When spentUsd reaches ceilingUsd the
   * tree halts via runBlock with a decision brief and a ceiling-reached event.
   */
  ceilingUsd: number;
  /**
   * Set to true after the first 'ceiling-reached' event is emitted for this
   * tree. Prevents duplicate emission when concurrent branches all find the
   * ceiling tripped (ADR-017 one-in-flight exception: at most one event per
   * tree, not one per branch that trips it).
   */
  ceilingEmitted?: boolean;
}

export function createTreeState(ceilingUsd = DEFAULT_SPEND_CEILING_USD): TreeState {
  return { spentUsd: 0, ceilingUsd };
}

export function debitTreeState(treeState: TreeState, usage: Usage): void {
  if (usage.costUsd !== undefined) {
    treeState.spentUsd += usage.costUsd;
    return;
  }

  // Conservative token-only fallback (ADR-017): when the endpoint reports
  // tokens but not cost, use the documented worst-case price constant to bound
  // spend. This prevents uncapped execution on cost-silent endpoints.
  const tokens = usage.promptTokens + usage.completionTokens;
  treeState.spentUsd += tokens * WORST_CASE_PRICE_PER_TOKEN;
}

export function hasReachedSpendCeiling(treeState: TreeState): boolean {
  return treeState.spentUsd >= treeState.ceilingUsd;
}
