/**
 * Bare-process script execution for repo-declared entry points.
 *
 * Scripts are looked up by name from a declared map; shell text is structurally
 * impossible (spawn with shell:false). The runner captures stdout+stderr, enforces
 * a wall-clock bound, and returns a frozen ScriptResult.
 */

import { join } from 'node:path';
import { access } from 'node:fs/promises';
import type { ScriptResult } from '../contract/tool.js';
import type { EventStore, FactoryEvent } from '../contract/events.js';
import {
  instantScriptFailure,
  runCapturedProcess,
} from './process-runner.js';

export { OUTPUT_TRUNCATION_CAP } from './process-runner.js';

/**
 * A map of script name → entry-point path (relative to the repo root), as
 * declared by the commission. The runner never reads package.json — the
 * caller supplies this map.
 */
export type DeclaredScripts = Record<string, string>;

/**
 * Runs repo-declared scripts by name as bare child processes.
 * The repo root and declared script map are bound at construction; the
 * wall-clock ceiling is per-call.
 */
export interface ScriptRunner {
  /**
   * Run a declared script by name. An optional `target` (a path or test pattern)
   * is validated and appended to the declared command's args, so the factory can
   * run a targeted subset (e.g. one test file) instead of the whole suite —
   * without a freeform-shell hole. The operator-declared command fixes the runner
   * (any language/paradigm); only the target is the model's input.
   */
  run(name: string, target?: string, timeLimitMs?: number): Promise<ScriptResult>;
}

const DEFAULT_TIME_LIMIT_MS = 30_000;

/**
 * Validate a model-supplied script target. Allowed: a relative, in-repo path or
 * test pattern — letters, digits, and `._-/*` only. Rejected: absolute paths,
 * `..` traversal, and any shell metacharacter — so a target can never become a
 * second command. Returns the trimmed target, or null if invalid.
 */
export function validateScriptTarget(raw: string): string | null {
  const target = raw.trim();
  if (target.length === 0 || target.length > 512) return null;
  if (target.startsWith('/') || target.startsWith('~')) return null;
  if (target.split('/').includes('..')) return null;
  // Safe character class only: no spaces, quotes, $, ;, |, &, <, >, backticks, etc.
  if (!/^[A-Za-z0-9._/*-]+$/.test(target)) return null;
  return target;
}

/**
 * Build a ScriptRunner bound to a specific repo root and declared-scripts map.
 *
 * - Undeclared names (including names containing shell metacharacters) are
 *   refused immediately — no spawn occurs.
 * - Declared names spawn the entry-point path with {shell:false, cwd:repoRoot}.
 * - Output is captured from both stdout and stderr.
 * - A wall-clock timer kills the immediate child on timeout.
 * - `output` is the trailing truncated slice (≤ OUTPUT_TRUNCATION_CAP bytes);
 *   `fullOutput` is the complete capture.
 *
 * The optional `env` controls the child process environment. When omitted the
 * child inherits the parent's environment (current behavior). Assembly passes a
 * scrubbed env so repo scripts cannot read the factory's secrets.
 */
export function createScriptRunner(
  repoRoot: string,
  declaredScripts: DeclaredScripts,
  env?: NodeJS.ProcessEnv,
): ScriptRunner {
  return {
    async run(
      name: string,
      target?: string,
      timeLimitMs = DEFAULT_TIME_LIMIT_MS,
    ): Promise<ScriptResult> {
      const entryPoint = declaredScripts[name];
      if (entryPoint === undefined) {
        return instantScriptFailure(`Script "${name}" is not in the declared set.`);
      }

      // A target (path/pattern to scope the run) is validated, never shelled.
      let safeTarget: string | undefined;
      if (target !== undefined && target.length > 0) {
        const validated = validateScriptTarget(target);
        if (validated === null) {
          const msg = `Invalid script target "${target}": must be a relative in-repo path/pattern (no shell metacharacters, no "..").`;
          return instantScriptFailure(msg);
        }
        safeTarget = validated;
      }

      // Three declared-entry forms, all name-based and shell-free (the operator
      // fixes the runner; only `target` is the model's input, and it is validated):
      //   "npm-script:<name>"  -> execute via the package manager (npm run <name>),
      //                           the form package.json scripts actually require;
      //   "make:<target>"      -> execute `make <target>` (stack-agnostic: any repo
      //                           with a Makefile, e.g. a Python repo's `make test`);
      //   anything else        -> a repo-relative node script file path.
      const npmScript = entryPoint.startsWith('npm-script:')
        ? entryPoint.slice('npm-script:'.length)
        : null;
      const makeTarget = entryPoint.startsWith('make:')
        ? entryPoint.slice('make:'.length)
        : null;

      let command: string;
      let baseArgs: string[];
      if (npmScript !== null) {
        command = 'npm';
        baseArgs = ['run', npmScript];
      } else if (makeTarget !== null) {
        command = 'make';
        baseArgs = [makeTarget];
      } else {
        command = process.execPath;
        baseArgs = [join(repoRoot, entryPoint)];
      }
      // npm needs `--` to forward the target as an arg to the underlying runner;
      // make and the node-file form take the target as a trailing positional arg.
      const args =
        safeTarget === undefined
          ? baseArgs
          : npmScript !== null
            ? [...baseArgs, '--', safeTarget]
            : [...baseArgs, safeTarget];
      return runCapturedProcess({
        command,
        args,
        cwd: repoRoot,
        shell: false,
        timeLimitMs,
        ...(env !== undefined ? { env } : {}),
      });
    },
  };
}

// ---------------------------------------------------------------------------
// run_command — a general worktree shell (ADR-016 amendment)
// ---------------------------------------------------------------------------

/**
 * Network-reaching command patterns refused by {@link runCommandTool}. The
 * worktree's only sanctioned egress is the brokered `push_branch`/`open_pr` path
 * (ADR-025), which runs the process-clean gate. A general shell must not become a
 * second, ungated egress — so anything that fetches, pushes, installs from, or
 * otherwise talks to the network is blocked. The scan is over the WHOLE command
 * string (a word-boundary regex), so shell chaining (`a && curl …`, `$(wget …)`)
 * cannot smuggle a blocked verb past a first-word check.
 *
 * This is a denylist, deliberately: a worktree shell is dual-use and the operator
 * opted into broad latitude; the floor is "no network", not "only these verbs".
 * Local git (status/diff/checkout/restore/add/commit/log/stash) is fully allowed —
 * only the network-reaching git subcommands (push/pull/fetch/clone/remote) are not.
 */
const NETWORK_COMMAND_PATTERNS: ReadonlyArray<RegExp> = [
  /\bgit\s+push\b/,
  /\bgit\s+pull\b/,
  /\bgit\s+fetch\b/,
  /\bgit\s+clone\b/,
  /\bgit\s+remote\b/,
  /\bcurl\b/,
  /\bwget\b/,
  /\bnc\b/,
  /\bncat\b/,
  /\bssh\b/,
  /\bscp\b/,
  /\bsftp\b/,
  /\btelnet\b/,
  /\brsync\b/,
  // Package installs and publishes reach the registry network.
  /\bnpm\s+(i|install|ci|publish|update|add)\b/,
  /\b(yarn|pnpm)\s+(add|install|up|publish)\b/,
  /\bnpx\b/, // npx fetches packages on demand
  /\bpip\s+install\b/,
  /\bcargo\s+(install|publish|fetch)\b/,
  /\bgo\s+(get|install)\b/,
  /\bbrew\s+install\b/,
  /\bapt(-get)?\s+install\b/,
];

/** Returns the matched blocked verb if the command reaches the network, else null. */
export function networkCommandBlock(command: string): string | null {
  for (const pat of NETWORK_COMMAND_PATTERNS) {
    const m = command.match(pat);
    if (m) return m[0];
  }
  return null;
}

/**
 * A general shell, pinned to the sandbox worktree. The four floors (operator
 * decision, run 18): cwd = worktree (cannot escape), env scrubbed of the factory's
 * secrets, network/push blocked (the brokered push path is the only egress), and a
 * per-command wall-clock kill. Within those, the factory runs whatever a developer
 * would — `git checkout` to undo a bad edit, its own test/lint/build scripts,
 * formatters, scratch node one-liners — without a declared-script allowlist.
 *
 * `shell: true` so command strings (pipes, `&&`, redirects) work as written; the
 * worktree isolation + scrub + network block are what contain it, not arg parsing.
 */
export function createCommandRunner(
  worktreeRoot: string,
  env?: NodeJS.ProcessEnv,
): { run(command: string, timeLimitMs?: number): Promise<ScriptResult> } {
  return {
    async run(command: string, timeLimitMs = DEFAULT_TIME_LIMIT_MS): Promise<ScriptResult> {
      const cmd = command.trim();
      if (cmd.length === 0) {
        return instantScriptFailure('run_command: empty command.');
      }
      const blocked = networkCommandBlock(cmd);
      if (blocked !== null) {
        const msg =
          `run_command: "${blocked}" reaches the network, which is blocked in the worktree. ` +
          `Local work only — to publish, use the push_branch / open_pr boundary (it runs the ` +
          `process-clean gate). Local git (status/diff/checkout/restore/add/commit/log/stash) is allowed.`;
        return instantScriptFailure(msg);
      }

      return runCapturedProcess({
        command: cmd,
        cwd: worktreeRoot,
        shell: true,
        timeLimitMs,
        ...(env !== undefined ? { env } : {}),
      });
    },
  };
}

/**
 * A ToolImpl wrapping a command runner. The model passes a `command` string;
 * runs in the worktree under the four floors (see {@link createCommandRunner}).
 */
export function runCommandTool(runner: { run(command: string, timeLimitMs?: number): Promise<ScriptResult> }): {
  def: { name: string; description: string; parameters: Record<string, unknown> };
  execute(goal: import('../contract/goal.js').Goal, args: Record<string, unknown>): Promise<{ ok: boolean; output: string }>;
} {
  return {
    def: {
      name: 'run_command',
      description:
        'Run a shell command in the sandbox worktree (your isolated checkout). Use it like a ' +
        'developer terminal: run your own tests/lint/build, format code, and use LOCAL git to ' +
        'manage your work — `git status`, `git diff`, `git checkout <path>` / `git restore <path>` ' +
        'to undo a bad edit, `git add`/`git commit` per chunk. The command runs with the worktree ' +
        'as its working directory. Network access is blocked (no push/pull/fetch/clone, no curl/wget, ' +
        'no package installs) — to publish, use push_branch/open_pr. A command is killed after a ' +
        'wall-clock timeout, so scope test runs to what you changed rather than the whole suite.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'The shell command to run in the worktree, e.g. "git checkout src/engine/engine.ts" or "npm run test -- tests/x.test.ts".' },
        },
        required: ['command'],
      },
    },
    async execute(_goal, args) {
      const command = String(args['command'] ?? '');
      const result = await runner.run(command);
      const statusLine = result.timedOut ? 'timed out' : result.exitStatus === null ? 'error' : `exit ${result.exitStatus}`;
      return { ok: result.ok, output: `[run_command: ${command}] ${statusLine}\n${result.output}` };
    },
  };
}

/**
 * Wraps a command runner so every run appends a `script-ran` event (the same event
 * the declared-script runner logs), with the full command as the label.
 */
export function loggingCommandRunner(
  store: EventStore,
  runner: { run(command: string, timeLimitMs?: number): Promise<ScriptResult> },
  goalId: string,
  now: () => number = () => Date.now(),
): { run(command: string, timeLimitMs?: number): Promise<ScriptResult> } {
  return {
    async run(command: string, timeLimitMs?: number): Promise<ScriptResult> {
      const result = await runner.run(command, timeLimitMs);
      const event: FactoryEvent = {
        type: 'script-ran',
        at: now(),
        goalId,
        command,
        exitStatus: result.exitStatus,
        durationMs: result.durationMs,
        outputRef: `${goalId}:${command}:${now()}`,
      };
      await store.append(event);
      return result;
    },
  };
}

/**
 * A ToolImpl whose execute function calls the runner with the `script` arg.
 * Exported for registration in the broker's injectable dispatch table; the
 * broker's wiring is assembly work done elsewhere.
 */
export function runScriptTool(runner: ScriptRunner): {
  def: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
  execute(
    goal: import('../contract/goal.js').Goal,
    args: Record<string, unknown>,
  ): Promise<{ ok: boolean; output: string }>;
} {
  return {
    def: {
      name: 'run_script',
      description:
        'Run a repo-declared script by name in the sandbox worktree. The name must be in the declared entry-point set; shell text is not accepted. Pass an optional "target" (a relative path or test pattern) to scope the run to a subset, e.g. run the test script against one file instead of the whole suite.',
      parameters: {
        type: 'object',
        properties: {
          script: {
            type: 'string',
            description: 'The name of the declared script to run.',
          },
          target: {
            type: 'string',
            description: 'Optional relative path/pattern to scope the run (e.g. tests/util/x.test.ts). Validated as an in-repo path; no shell metacharacters.',
          },
        },
        required: ['script'],
      },
    },
    async execute(_goal, args) {
      const name = String(args['script'] ?? '');
      const target = args['target'] !== undefined ? String(args['target']) : undefined;
      const result = await runner.run(name, target);
      const statusLine = result.timedOut
        ? 'timed out'
        : result.exitStatus === null
          ? 'error'
          : `exit ${result.exitStatus}`;
      const label = target ? `${name} ${target}` : name;
      return {
        ok: result.ok,
        output: `[run_script: ${label}] ${statusLine}\n${result.output}`,
      };
    },
  };
}

/**
 * Verify that every declared script entry point exists on disk.
 *
 * Only the repo-relative node-file form is disk-checked. The scheme-prefixed
 * forms (`npm-script:<name>`, `make:<target>`) name a runner target, not a path —
 * their existence is the runner's/`make`'s concern at run time, not a file on
 * disk — so they are skipped here.
 *
 * Returns `{ok:true}` when all node-file paths are present; returns
 * `{ok:false, reason}` naming the first missing entry point.
 */
export async function verifyEntryPoints(
  repoRoot: string,
  declaredScripts: DeclaredScripts,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  for (const [name, entryPoint] of Object.entries(declaredScripts)) {
    if (entryPoint.startsWith('npm-script:') || entryPoint.startsWith('make:')) continue;
    const full = join(repoRoot, entryPoint);
    try {
      await access(full);
    } catch {
      return { ok: false, reason: `Declared script "${name}" entry point not found: ${entryPoint}` };
    }
  }
  return { ok: true };
}

/**
 * Wraps a ScriptRunner so every run appends exactly one `script-ran` event to
 * the store. The `outputRef` is the `goalId:name:timestamp` key — opaque, no
 * new store is introduced. Full output is retained on the ScriptResult itself.
 */
export function loggingScriptRunner(
  store: EventStore,
  runner: ScriptRunner,
  goalId: string,
  now: () => number = () => Date.now(),
): ScriptRunner {
  return {
    async run(name: string, target?: string, timeLimitMs?: number): Promise<ScriptResult> {
      const result = await runner.run(name, target, timeLimitMs);
      const label = target ? `${name} ${target}` : name;
      const outputRef = `${goalId}:${label}:${now()}`;
      const event: FactoryEvent = {
        type: 'script-ran',
        at: now(),
        goalId,
        command: label,
        exitStatus: result.exitStatus,
        durationMs: result.durationMs,
        outputRef,
      };
      await store.append(event);
      return result;
    },
  };
}
