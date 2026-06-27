import type { ChildPlan } from '../contract/decision.js';
import type { GoalTypeDef } from '../contract/goal-type.js';
import type { KnowledgeCategory } from '../contract/knowledge.js';
import type { MissingRequirement } from '../library/coverage.js';
import { renormalizeShares, validateSplit } from './split-validation.js';

/**
 * Encode a missing requirement into the gate-checked event's missing[] string
 * format.
 *
 * Encoding:
 *   - Category miss:  "<category>"
 *   - Region miss:    "<category>:<region>"
 */
export function encodeMissing(missing: MissingRequirement): string {
  return missing.region !== undefined
    ? `${missing.category}:${missing.region}`
    : missing.category;
}

export function filterMissingCoveredByRefresh(
  missing: MissingRequirement[],
  refreshedCategories: ReadonlySet<KnowledgeCategory>,
): MissingRequirement[] {
  return missing.filter((item) => !refreshedCategories.has(item.category));
}

export function gateMissingLabels(
  missing: MissingRequirement[],
  refreshChildren: ChildPlan[],
): string[] {
  return [
    ...missing.map(encodeMissing),
    ...refreshChildren.map((child) => `refresh:${child.type}:${child.localId}`),
  ];
}

export interface InjectCoverageChildrenParams {
  children: ChildPlan[];
  missing: MissingRequirement[];
  refreshChildren: ChildPlan[];
  mintComprehension: (missing: MissingRequirement[]) => ChildPlan[];
  resolveType?: (type: string) => GoalTypeDef | undefined;
}

export function injectCoverageChildren(params: InjectCoverageChildrenParams): ChildPlan[] {
  const comprehensionChildren =
    params.missing.length === 0 ? [] : params.mintComprehension(params.missing);

  const allInjected: ChildPlan[] = [
    ...withoutDependencies(comprehensionChildren),
    ...withoutDependencies(params.refreshChildren),
  ];

  if (allInjected.length === 0) return params.children;

  const rawAugmented: ChildPlan[] = [
    ...allInjected,
    ...params.children.map((child) => ({
      ...child,
      dependsOn: [...child.dependsOn, ...depsForChild(child, allInjected)],
    })),
  ];

  const augmented = renormalizeShares(rawAugmented);
  const error = validateSplit(augmented, params.resolveType);
  if (error !== null) {
    throw new Error(`coverage-gate-invalid-split:${error}`);
  }

  return augmented;
}

function withoutDependencies(children: ChildPlan[]): ChildPlan[] {
  return children.map((child) => ({ ...child, dependsOn: [] }));
}

function depsForChild(child: ChildPlan, injected: ChildPlan[]): string[] {
  return injected
    .filter((candidate) => candidate.scope.length === 0 || scopesOverlap(child.scope, candidate.scope))
    .map((candidate) => candidate.localId);
}

function scopesOverlap(a: string[], b: string[]): boolean {
  if (a.length === 0 || b.length === 0) return true;
  const norm = (path: string): string => path.replace(/\/+$/, '');
  return a.some((left) => {
    const leftNorm = norm(left);
    return b.some((right) => {
      const rightNorm = norm(right);
      return (
        leftNorm === rightNorm ||
        leftNorm.startsWith(`${rightNorm}/`) ||
        rightNorm.startsWith(`${leftNorm}/`)
      );
    });
  });
}
