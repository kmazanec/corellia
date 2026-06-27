import { spawn } from 'node:child_process';
import type { ScriptResult } from '../contract/tool.js';

/** Truncation cap for model-facing process output. */
export const OUTPUT_TRUNCATION_CAP = 4096;
/** Hard cap for retained child-process output before the child is killed. */
export const FULL_OUTPUT_CAPTURE_CAP = 256 * 1024;

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
  return new Promise<ScriptResult>((resolve) => {
    new CapturedProcessRun(options, resolve).start();
  });
}

class CapturedProcessRun {
  readonly #started = Date.now();
  readonly #output = new BoundedOutputCapture(FULL_OUTPUT_CAPTURE_CAP);
  readonly #options: CapturedProcessOptions;
  readonly #resolve: (result: ScriptResult) => void;
  #settled = false;
  #timer: NodeJS.Timeout | undefined;

  constructor(
    options: CapturedProcessOptions,
    resolve: (result: ScriptResult) => void,
  ) {
    this.#options = options;
    this.#resolve = resolve;
  }

  start(): void {
    const child = spawn(this.#options.command, [...(this.#options.args ?? [])], {
      cwd: this.#options.cwd,
      shell: this.#options.shell,
      stdio: ['ignore', 'pipe', 'pipe'],
      ...(this.#options.env !== undefined ? { env: this.#options.env } : {}),
    });

    child.stdout.on('data', (chunk: Buffer) => this.#capture(chunk, child));
    child.stderr.on('data', (chunk: Buffer) => this.#capture(chunk, child));
    this.#timer = this.#startTimer(child);
    child.on('close', (code) => this.#finishClose(code));
    child.on('error', (err) => this.#finishError(err));
  }

  #startTimer(child: ReturnType<typeof spawn>): NodeJS.Timeout {
    const timer = setTimeout(() => {
      if (!this.#settle()) return;
      child.kill('SIGKILL');
      this.#finish({ ok: false, exitStatus: null, timedOut: true });
    }, this.#options.timeLimitMs);
    timer.unref();
    return timer;
  }

  #capture(chunk: Buffer, child: ReturnType<typeof spawn>): void {
    if (this.#settled) return;
    if (this.#output.append(chunk) !== 'truncated') return;
    if (!this.#settle()) return;
    child.kill('SIGKILL');
    this.#finish({ ok: false, exitStatus: null, timedOut: false });
  }

  #finishClose(code: number | null): void {
    if (!this.#settle()) return;
    const exitStatus = code ?? null;
    this.#finish({ ok: exitStatus === 0, exitStatus, timedOut: false });
  }

  #finishError(err: Error): void {
    if (!this.#settle()) return;
    this.#resolve(freezeProcessError(this.#started, err));
  }

  #settle(): boolean {
    if (this.#settled) return false;
    this.#settled = true;
    if (this.#timer !== undefined) clearTimeout(this.#timer);
    return true;
  }

  #finish(status: Pick<ScriptResult, 'ok' | 'exitStatus' | 'timedOut'>): void {
    this.#resolve(freezeProcessResult(this.#started, this.#output, status));
  }
}

class BoundedOutputCapture {
  readonly #chunks: Buffer[] = [];
  #capturedBytes = 0;
  #truncated = false;

  constructor(readonly limitBytes: number) {}

  append(chunk: Buffer): 'captured' | 'truncated' {
    const remaining = this.limitBytes - this.#capturedBytes;
    if (remaining > 0) {
      const captured = chunk.byteLength > remaining ? chunk.subarray(0, remaining) : chunk;
      this.#chunks.push(captured);
      this.#capturedBytes += captured.byteLength;
    }
    if (chunk.byteLength <= remaining) return 'captured';
    this.#truncated = true;
    return 'truncated';
  }

  toString(): string {
    return Buffer.concat(this.#chunks).toString('utf8');
  }

  get truncated(): boolean {
    return this.#truncated;
  }
}

function freezeProcessResult(
  started: number,
  capturedOutput: BoundedOutputCapture,
  status: Pick<ScriptResult, 'ok' | 'exitStatus' | 'timedOut'>,
): ScriptResult {
  const fullOutput = capturedOutput.toString();
  return Object.freeze({
    ...status,
    output: truncateOutput(fullOutput),
    fullOutput,
    durationMs: Date.now() - started,
    ...(capturedOutput.truncated ? { outputTruncated: true } : {}),
  });
}

function freezeProcessError(started: number, err: Error): ScriptResult {
  return Object.freeze({
    ok: false,
    exitStatus: null,
    output: err.message,
    fullOutput: err.message,
    durationMs: Date.now() - started,
    timedOut: false,
  });
}
