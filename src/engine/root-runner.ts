import type { EventStore } from '../contract/events.js';
import type { Goal } from '../contract/goal.js';
import type { Registry } from '../contract/goal-type.js';
import type { Report } from '../contract/report.js';
import {
  openLearnAssembly,
  openSandboxAssembly,
  type SandboxAssembly,
  type SandboxConfig,
} from './assembly.js';
import { applyRootEmissionGate } from './root-emission-gate.js';
import { finalizeSandboxedRun } from './sandbox-finalization.js';
import {
  DEFAULT_SPEND_CEILING_USD,
  createTreeState,
  type TreeState,
} from './tree-spend.js';

const SCRIPT_GRANTS = new Set(['test.run_scoped', 'test.run_impacted']);

export async function runRootGoal(params: {
  goal: Goal;
  sandbox: SandboxConfig | undefined;
  registry: Registry;
  store: EventStore;
  now: () => number;
  setActiveAssembly: (assembly: SandboxAssembly | undefined) => void;
  runTree: (treeState: TreeState) => Promise<Report>;
}): Promise<Report> {
  const treeState = createTreeState(
    params.goal.spendCeilingUsd ?? DEFAULT_SPEND_CEILING_USD,
  );

  if (params.sandbox === undefined) {
    return params.runTree(treeState);
  }

  if (isLearnRootWithoutScripts(params.goal, params.registry)) {
    return runLearnRoot(params, treeState, params.sandbox);
  }

  return runSandboxedRoot(params, treeState, params.sandbox);
}

function isLearnRootWithoutScripts(goal: Goal, registry: Registry): boolean {
  return goal.parentId === null &&
    registry.has(goal.type) &&
    registry.get(goal.type).kind === 'learn' &&
    !registry.get(goal.type).grants.some((grant) => SCRIPT_GRANTS.has(grant));
}

async function runLearnRoot(
  params: Parameters<typeof runRootGoal>[0],
  treeState: TreeState,
  sandbox: SandboxConfig,
): Promise<Report> {
  const assembly = openLearnAssembly(
    sandbox,
    params.goal.id,
    params.registry,
    params.store,
  );
  params.setActiveAssembly(assembly);
  try {
    return await params.runTree(treeState);
  } finally {
    params.setActiveAssembly(undefined);
  }
}

async function runSandboxedRoot(
  params: Parameters<typeof runRootGoal>[0],
  treeState: TreeState,
  sandbox: SandboxConfig,
): Promise<Report> {
  const assembly = await openSandboxAssembly(
    sandbox,
    params.goal.id,
    params.registry,
    params.store,
    params.now,
  );
  params.setActiveAssembly(assembly);
  let report: Report | undefined;
  try {
    report = await params.runTree(treeState);
    report = await applyRootEmissionGate({
      goal: params.goal,
      report,
      worktree: assembly.worktree,
      registry: params.registry,
      store: params.store,
      now: params.now,
    });
    return report;
  } finally {
    await finalizeSandboxedRun({
      goal: params.goal,
      report,
      worktree: assembly.worktree,
      store: params.store,
      now: params.now,
    });
    params.setActiveAssembly(undefined);
  }
}
