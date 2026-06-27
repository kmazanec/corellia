import { spawn } from 'node:child_process';
import type { ScriptResult } from '../contract/tool.js';

/** Truncation cap for model-facing process output. */
export const OUTPUT_TRUNCATION_CAP = 4096;

export interface CapturedProcessOptions {
  command: string;
  args?: readonly string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
  shell: boolean;
  timeLimitMs: number;
}

export function instantScriptFailure(message: string): ScriptResult {
  return Object.freeze({
    ok: false,
    exitStatus: null,
    output: message,
    fullOutput: message,
    durationMs: 0,
    timedOut: false,
  });
}

export function truncateOutput(output: string): string {
  if (output.length <= OUTPUT_TRUNCATION_CAP) return output;
  return output.slice(output.length - OUTPUT_TRUNCATION_CAP);
}

export function runCapturedProcess(options: CapturedProcessOptions): Promise<ScriptResult> {
  const started = Date.now();
  const args = [...(options.args ?? [])];

  return new Promise<ScriptResult>((resolve) => {
    const chunks: Buffer[] = [];
    let settled = false;

    const child = spawn(options.command, args, {
      cwd: options.cwd,
      shell: options.shell,
      stdio: ['ignore', 'pipe', 'pipe'],
      ...(options.env !== undefined ? { env: options.env } : {}),
    });

    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => chunks.push(chunk));

    const finish = (result: Pick<ScriptResult, 'ok' | 'exitStatus' | 'timedOut'>): void => {
      const durationMs = Date.now() - started;
      const fullOutput = Buffer.concat(chunks).toString('utf8');
      resolve(
        Object.freeze({
          ...result,
          output: truncateOutput(fullOutput),
          fullOutput,
          durationMs,
        }),
      );
    };

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      finish({ ok: false, exitStatus: null, timedOut: true });
    }, options.timeLimitMs);
    timer.unref();

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const exitStatus = code ?? null;
      finish({ ok: exitStatus === 0, exitStatus, timedOut: false });
    });

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const durationMs = Date.now() - started;
      resolve(
        Object.freeze({
          ok: false,
          exitStatus: null,
          output: err.message,
          fullOutput: err.message,
          durationMs,
          timedOut: false,
        }),
      );
    });
  });
}
