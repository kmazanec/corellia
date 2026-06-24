/**
 * Bare-process script execution for repo-declared entry points.
 *
 * Scripts are looked up by name from a declared map; shell text is structurally
 * impossible (spawn with shell:false). The runner captures stdout+stderr, enforces
 * a wall-clock bound, and returns a frozen ScriptResult.
 */

import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { access } from 'node:fs/promises';
import type { ScriptResult } from '../contract/tool.js';
import type { EventStore, FactoryEvent } from '../contract/events.js';

/** Truncation cap for the model-facing output field: 4096 bytes. */
export const OUTPUT_TRUNCATION_CAP = 4096;

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
        return Object.freeze({
          ok: false,
          exitStatus: null,
          output: `Script "${name}" is not in the declared set.`,
          fullOutput: `Script "${name}" is not in the declared set.`,
          durationMs: 0,
          timedOut: false,
        });
      }

      // A target (path/pattern to scope the run) is validated, never shelled.
      let safeTarget: string | undefined;
      if (target !== undefined && target.length > 0) {
        const validated = validateScriptTarget(target);
        if (validated === null) {
          const msg = `Invalid script target "${target}": must be a relative in-repo path/pattern (no shell metacharacters, no "..").`;
          return Object.freeze({
            ok: false, exitStatus: null, output: msg, fullOutput: msg, durationMs: 0, timedOut: false,
          });
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
      const started = Date.now();

      return new Promise<ScriptResult>((resolve) => {
        const chunks: Buffer[] = [];
        let settled = false;

        const child = spawn(command, args, {
          cwd: repoRoot,
          shell: false,
          stdio: ['ignore', 'pipe', 'pipe'],
          ...(env !== undefined ? { env } : {}),
        });

        child.stdout.on('data', (d: Buffer) => chunks.push(d));
        child.stderr.on('data', (d: Buffer) => chunks.push(d));

        const timer = setTimeout(() => {
          if (!settled) {
            settled = true;
            child.kill('SIGKILL');
            const durationMs = Date.now() - started;
            const fullOutput = Buffer.concat(chunks).toString('utf8');
            const output = truncate(fullOutput);
            resolve(
              Object.freeze({
                ok: false,
                exitStatus: null,
                output,
                fullOutput,
                durationMs,
                timedOut: true,
              }),
            );
          }
        }, timeLimitMs);
        timer.unref();

        child.on('close', (code) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          const durationMs = Date.now() - started;
          const fullOutput = Buffer.concat(chunks).toString('utf8');
          const output = truncate(fullOutput);
          const exitStatus = code ?? null;
          resolve(
            Object.freeze({
              ok: exitStatus === 0,
              exitStatus,
              output,
              fullOutput,
              durationMs,
              timedOut: false,
            }),
          );
        });

        child.on('error', (err) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          const durationMs = Date.now() - started;
          const msg = err.message;
          resolve(
            Object.freeze({
              ok: false,
              exitStatus: null,
              output: msg,
              fullOutput: msg,
              durationMs,
              timedOut: false,
            }),
          );
        });
      });
    },
  };
}

/** Truncate to the trailing OUTPUT_TRUNCATION_CAP bytes of the output string. */
function truncate(s: string): string {
  if (s.length <= OUTPUT_TRUNCATION_CAP) return s;
  return s.slice(s.length - OUTPUT_TRUNCATION_CAP);
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
