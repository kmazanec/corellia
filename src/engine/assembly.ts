/**
 * Assembly: the composition layer that binds the six iteration-3 modules into a
 * single sandboxed tree. The engine asks this module, at the tree root, to open
 * a worktree, construct the one broker bound to that worktree, and manufacture
 * the per-goal CheckContext the deterministic gate reads.
 *
 * Trust posture (ADR-016): the worktree's child scripts run with a SCRUBBED
 * environment — the factory's own secrets (OpenRouter keys, database URLs) are
 * deleted before the repo's declared scripts ever see them. PATH/HOME and the
 * rest of the benign shell environment are kept so node and the toolchain still
 * resolve.
 */

import type { EventStore } from '../contract/events.js';
import type { Registry, CheckContext } from '../contract/goal-type.js';
import type { Goal } from '../contract/goal.js';
import type { ToolBroker, ToolImpl } from '../contract/tool.js';
import type { ScriptResult } from '../contract/tool.js';
import { Broker } from './broker.js';
import { createFileTools } from './tools.js';
import {
  createScriptRunner,
  runScriptTool,
  loggingScriptRunner,
  type ScriptRunner,
  type DeclaredScripts,
} from '../library/script-runner.js';
import { openTreeWorktree, type TreeWorktree } from './worktree.js';

/**
 * The optional sandbox/assembly configuration the engine accepts. When present
 * the tree root opens a worktree against `repoRoot` and binds the broker to it;
 * `declaredScripts` is the name → entry-point map the run_script tool runs from.
 */
export interface SandboxConfig {
  /** The target repo the tree operates against; its worktree becomes the broker root. */
  repoRoot: string;
  /** The declared script entry points (name → repo-relative path) run_script may invoke. */
  declaredScripts: DeclaredScripts;
}

/**
 * Build a child-process environment with the factory's secrets removed. Starts
 * from the current process env and deletes every key that names an LLM provider
 * credential or a database connection, plus anything prefixed OPENROUTER_,
 * POSTGRES_, GH_TOKEN, GITHUB_TOKEN, NPM_TOKEN, AWS_, GOOGLE_, or STRIPE_, and
 * any key whose suffix matches _KEY, _SECRET, _TOKEN, _PASSWORD, or _CREDENTIALS
 * (case-insensitive). Benign entries (PATH, HOME, TMPDIR, LANG, TERM, …) are
 * preserved so the toolchain still resolves.
 */
export function scrubEnv(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...source };

  // Exact names that must always be removed.
  const exactDeletes = [
    'DATABASE_URL',
    'OPENAI_API_KEY',
    'ANTHROPIC_API_KEY',
    'GH_TOKEN',
    'GITHUB_TOKEN',
    'NPM_TOKEN',
  ];
  for (const key of exactDeletes) {
    delete env[key];
  }

  // Suffix pattern: any key ending with these strings (case-insensitive) is a secret.
  const secretSuffixPattern = /(_KEY|_SECRET|_TOKEN|_PASSWORD|_CREDENTIALS?)$/i;

  // Prefix patterns: any key whose name starts with these prefixes is a secret.
  const secretPrefixes = [
    'OPENROUTER_',
    'POSTGRES_',
    'AWS_',
    'GOOGLE_',
    'STRIPE_',
  ];

  for (const key of Object.keys(env)) {
    if (secretSuffixPattern.test(key)) {
      delete env[key];
      continue;
    }
    if (secretPrefixes.some((p) => key.startsWith(p))) {
      delete env[key];
    }
  }

  return env;
}

/**
 * The composed tree handle the engine holds for the duration of a sandboxed run:
 * the broker bound to the worktree, the full worktree descriptor (for collect /
 * preserve), and a factory that mints a per-goal CheckContext.
 */
export interface SandboxAssembly {
  /** The single broker for the whole tree, bound to the worktree root. */
  broker: ToolBroker;
  /** The full worktree descriptor for collect/preserve at tree end. */
  worktree: TreeWorktree;
  /**
   * Manufacture the CheckContext an executing deterministic check reads, with a
   * script runner that logs `script-ran` against the EXECUTING goal's id — not
   * the tree root's. Called per leaf at the deterministic-check invocation site.
   */
  checkContextFor(goalId: string): CheckContext;
}

/**
 * Open the tree's worktree and compose the broker, the scrubbed-env script
 * runner, and the per-goal CheckContext factory. Called once, by the tree root,
 * when a SandboxConfig is present.
 *
 * The broker's run_script tool logs each `script-ran` event against the goal
 * that calls it (ToolImpl.execute receives the goal), so a leaf running the
 * test script is honestly attributed even though the broker is tree-scoped.
 */
export async function openSandboxAssembly(
  config: SandboxConfig,
  rootGoalId: string,
  registry: Registry,
  store: EventStore,
  now: () => number = () => Date.now(),
): Promise<SandboxAssembly> {
  const { treeId, branch, root } = await openTreeWorktree(config.repoRoot, rootGoalId, store);

  const worktree: TreeWorktree = {
    treeId,
    branch,
    root,
    repoRoot: config.repoRoot,
    goalId: rootGoalId,
  };

  // The base runner is bound to the worktree root + declared scripts, with a
  // scrubbed child env so repo scripts never inherit the factory's secrets.
  const baseRunner: ScriptRunner = createScriptRunner(root, config.declaredScripts, scrubEnv());

  // The broker's run_script tool logs each run against the CALLING goal's id
  // (ToolImpl.execute receives the goal). We wrap the base runner per call so
  // the 'script-ran' event carries the executing leaf's id, not the tree root.
  const runScriptImpl: ToolImpl = (() => {
    const base = runScriptTool(baseRunner);
    return {
      def: base.def,
      async execute(goal: Goal, args: Record<string, unknown>) {
        const perGoal = runScriptTool(loggingScriptRunner(store, baseRunner, goal.id, now));
        return perGoal.execute(goal, args);
      },
    };
  })();

  const fileTools = createFileTools(root);
  const broker = new Broker({
    root,
    registry,
    store,
    tools: [fileTools.readFile, fileTools.writeFile, fileTools.listDir, fileTools.search, runScriptImpl],
  });

  const checkContextFor = (goalId: string): CheckContext => {
    const perGoalRunner = loggingScriptRunner(store, baseRunner, goalId, now);
    return {
      sandboxRoot: root,
      runScript: (name: string): Promise<ScriptResult> => perGoalRunner.run(name),
    };
  };

  return { broker, worktree, checkContextFor };
}
