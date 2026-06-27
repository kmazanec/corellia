import type { EventStore } from '../contract/events.js';
import type { Goal } from '../contract/goal.js';
import type { Registry } from '../contract/goal-type.js';
import type { Report } from '../contract/report.js';
import { blockedReport } from './reports.js';
import { diffWithinScope, treeChangedWithinScope } from './worktree.js';

export async function applyRootEmissionGate(params: {
  goal: Goal;
  report: Report;
  worktree: { root: string; baseSha: string };
  registry: Registry;
  store: EventStore;
  now: () => number;
}): Promise<Report> {
  if (params.report.blockers.length > 0) return params.report;

  const diff = diffWithinScope(params.worktree.root, params.goal.scope);
  const rootKind = params.registry.has(params.goal.type)
    ? params.registry.get(params.goal.type).kind
    : undefined;
  const changedSinceBase = treeChangedWithinScope(
    params.worktree.root,
    params.worktree.baseSha,
    params.goal.scope,
  );
  const artifactHasFiles =
    params.report.artifact?.kind === 'files' &&
    (params.report.artifact.files?.length ?? 0) > 0;

  if (diff.ok && rootKind === 'make' && changedSinceBase === 0 && !artifactHasFiles) {
    return blockRootEmission({
      goal: params.goal,
      store: params.store,
      now: params.now,
      reason:
        `Hollow emit: "${params.goal.type}" reported success but produced NO change within ` +
        `scope (${params.goal.scope.join(', ') || '(none)'}). A make goal must deliver a real ` +
        `worktree change or a files artifact; its children emitted text/PR calls ` +
        `without writing the product.`,
    });
  }

  if (!diff.ok) {
    return blockRootEmission({
      goal: params.goal,
      store: params.store,
      now: params.now,
      reason: `Scope insufficiency at tree emission: ${
        diff.scopeInsufficiency ?? 'diff exceeds declared scope'
      }`,
    });
  }

  return params.report;
}

async function blockRootEmission(params: {
  goal: Goal;
  store: EventStore;
  now: () => number;
  reason: string;
}): Promise<Report> {
  await params.store.append({
    type: 'blocked',
    at: params.now(),
    goalId: params.goal.id,
    brief: {
      question: params.reason,
      options: ['deny', 'park', 'bounce'],
      links: [params.goal.id],
      deadlineMs: 0,
      onTimeout: 'deny',
    },
    resolution: 'deny',
  });
  return blockedReport(params.reason);
}
