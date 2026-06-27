import type { ChildPlan } from '../contract/decision.js';
import type { GoalTypeDef } from '../contract/goal-type.js';

/**
 * Scale every child's `budgetShare` by `1/total` when the shares sum to more
 * than 1, so the sum becomes exactly 1 while each child keeps its relative
 * allocation. Under-allocation is deliberate and preserved.
 */
export function renormalizeShares(children: ChildPlan[]): ChildPlan[] {
  const total = children.reduce((sum, child) => sum + child.budgetShare, 0);
  if (total <= 1 || total === 0) return children;
  return children.map((child) => ({ ...child, budgetShare: child.budgetShare / total }));
}

/**
 * Validate the dependency-graph and type-level structure of a proposed split.
 * Cost policy is intentionally absent here: ADR-033 says budget is observability
 * plus runaway backstop, not a fan-out shaper.
 */
export function validateSplit(
  children: ChildPlan[],
  resolveType?: (type: string) => GoalTypeDef | undefined,
): string | null {
  if (children.length === 0) return 'Split must have at least one child';

  const localIds = new Set(children.map((child) => child.localId));
  if (localIds.size !== children.length) return 'Duplicate localIds in split';

  const typeError = validateChildTypes(children, resolveType);
  if (typeError !== null) return typeError;

  const shareError = validateBudgetShares(children);
  if (shareError !== null) return shareError;

  const dependencyError = validateDependencyGraph(children, localIds);
  if (dependencyError !== null) return dependencyError;

  return null;
}

function validateChildTypes(
  children: ChildPlan[],
  resolveType: ((type: string) => GoalTypeDef | undefined) | undefined,
): string | null {
  if (resolveType === undefined) return null;

  for (const child of children) {
    const def = resolveType(child.type);
    if (!def) {
      return `Child "${child.localId}" has unknown goal type "${child.type}"`;
    }
    if (def.requiresScope && child.scope.length === 0) {
      return `Child "${child.localId}" (type "${child.type}") requires a non-empty scope — it must declare the region it touches (ADR-039)`;
    }
  }

  return null;
}

function validateBudgetShares(children: ChildPlan[]): string | null {
  const totalShare = children.reduce((sum, child) => sum + child.budgetShare, 0);
  if (totalShare <= 1.0001) return null;
  return `budgetShares sum to ${totalShare.toFixed(4)}, must be ≤ 1`;
}

function validateDependencyGraph(
  children: ChildPlan[],
  localIds: ReadonlySet<string>,
): string | null {
  for (const child of children) {
    for (const dep of child.dependsOn) {
      if (!localIds.has(dep)) {
        return `Child "${child.localId}" depends on unknown sibling "${dep}"`;
      }
      if (dep === child.localId) {
        return `Child "${child.localId}" depends on itself`;
      }
    }
  }

  return hasDependencyCycle(children) ? 'Cyclic dependency detected in split' : null;
}

function hasDependencyCycle(children: ChildPlan[]): boolean {
  const visited = new Set<string>();
  const inStack = new Set<string>();
  const depMap = new Map(children.map((child) => [child.localId, child.dependsOn]));

  const visit = (id: string): boolean => {
    if (inStack.has(id)) return true;
    if (visited.has(id)) return false;
    visited.add(id);
    inStack.add(id);
    for (const dep of depMap.get(id) ?? []) {
      if (visit(dep)) return true;
    }
    inStack.delete(id);
    return false;
  };

  return children.some((child) => visit(child.localId));
}
