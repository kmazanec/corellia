/**
 * Resolve the sandbox one tree runs under.
 *
 * An engine carries a sandbox fixed when it is built — the daemon builds one at
 * boot for every tree it will ever run. A root goal may carry its commission's
 * own declared scripts and captures; this module layers them over the engine's
 * defaults so each tree gets the check vocabulary its commission declared. A
 * commission entry wins over a default of the same name.
 */

import type { Goal } from '../contract/goal.js';
import { validateDeclaredCaptures } from '../library/capture-runner.js';
import type { SandboxConfig } from './assembly.js';

/**
 * The sandbox for the tree rooted at `goal`: the engine's sandbox with the
 * goal's declared scripts and captures merged in. Returns the engine sandbox
 * unchanged when the goal declares neither.
 *
 * @throws When the merged captures reference an undeclared script or an
 *   out-of-bounds path — a bad declaration fails before any worktree opens.
 */
export function treeSandboxFor(sandbox: SandboxConfig, goal: Goal): SandboxConfig {
  if (goal.declaredScripts === undefined && goal.declaredCaptures === undefined) {
    return sandbox;
  }
  const declaredScripts = { ...sandbox.declaredScripts, ...goal.declaredScripts };
  const captures =
    sandbox.declaredCaptures === undefined && goal.declaredCaptures === undefined
      ? undefined
      : { ...sandbox.declaredCaptures, ...goal.declaredCaptures };

  if (captures !== undefined) {
    const problem = validateDeclaredCaptures(captures, new Set(Object.keys(declaredScripts)));
    if (problem !== null) {
      throw new Error(`tree "${goal.id}" declares an invalid capture: ${problem}`);
    }
  }

  return {
    ...sandbox,
    declaredScripts,
    ...(captures !== undefined ? { declaredCaptures: captures } : {}),
  };
}
