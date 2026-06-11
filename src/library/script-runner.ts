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
  run(name: string, timeLimitMs?: number): Promise<ScriptResult>;
}

const DEFAULT_TIME_LIMIT_MS = 30_000;

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
 */
export function createScriptRunner(repoRoot: string, declaredScripts: DeclaredScripts): ScriptRunner {
  return {
    async run(name: string, timeLimitMs = DEFAULT_TIME_LIMIT_MS): Promise<ScriptResult> {
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

      const scriptPath = join(repoRoot, entryPoint);
      const started = Date.now();

      return new Promise<ScriptResult>((resolve) => {
        const chunks: Buffer[] = [];
        let settled = false;

        const child = spawn(process.execPath, [scriptPath], {
          cwd: repoRoot,
          shell: false,
          stdio: ['ignore', 'pipe', 'pipe'],
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
        'Run a repo-declared script by name in the sandbox worktree. The name must be in the declared entry-point set; shell text is not accepted.',
      parameters: {
        type: 'object',
        properties: {
          script: {
            type: 'string',
            description: 'The name of the declared script to run.',
          },
        },
        required: ['script'],
      },
    },
    async execute(_goal, args) {
      const name = String(args['script'] ?? '');
      const result = await runner.run(name);
      const statusLine = result.timedOut
        ? 'timed out'
        : result.exitStatus === null
          ? 'error'
          : `exit ${result.exitStatus}`;
      return {
        ok: result.ok,
        output: `[run_script: ${name}] ${statusLine}\n${result.output}`,
      };
    },
  };
}

/**
 * Verify that every declared script entry point exists on disk.
 *
 * Returns `{ok:true}` when all paths are present; returns `{ok:false, reason}`
 * naming the first missing entry point.
 */
export async function verifyEntryPoints(
  repoRoot: string,
  declaredScripts: DeclaredScripts,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  for (const [name, entryPoint] of Object.entries(declaredScripts)) {
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
    async run(name: string, timeLimitMs?: number): Promise<ScriptResult> {
      const result = await runner.run(name, timeLimitMs);
      const outputRef = `${goalId}:${name}:${now()}`;
      const event: FactoryEvent = {
        type: 'script-ran',
        at: now(),
        goalId,
        command: name,
        exitStatus: result.exitStatus,
        durationMs: result.durationMs,
        outputRef,
      };
      await store.append(event);
      return result;
    },
  };
}
