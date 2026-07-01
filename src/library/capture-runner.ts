/**
 * Runtime/visual capture execution (ADR-042). A capture reproduces runtime output
 * a script runner cannot reduce to an exit code: a rendered document, a screenshot
 * of a running UI, or a driven endpoint's response.
 *
 * The safety boundary is the same one ADR-016 set for declared scripts, enforced
 * here in code, not convention:
 *   - Declared targets only. Every capture is looked up by name from a map the
 *     operator authored; the model never supplies an address, path, or command.
 *     Render/start scripts are declared-script NAMES, run through the ScriptRunner.
 *   - Worktree-pinned. Output paths and rendered files are resolved under the
 *     worktree root and rejected if they escape it.
 *   - No ambient secrets. The server/render subprocesses run through the same
 *     scrubbed-env ScriptRunner the rest of the sandbox uses.
 *   - Time-bounded. Every capture has a wall-clock ceiling; server startup waits
 *     are bounded and the server is always killed.
 *   - Loopback-only network. A driven endpoint reaches 127.0.0.1 on the declared
 *     port only; there is no code path to a non-loopback host.
 */

import { join, normalize, isAbsolute } from 'node:path';
import { stat, writeFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import type {
  CaptureDef,
  CaptureResult,
  CaptureRunner,
  DeclaredCaptures,
} from '../contract/capture.js';
import type { EventStore, FactoryEvent } from '../contract/events.js';
import type { ScriptRunner } from './script-runner.js';

const DEFAULT_CAPTURE_TIMEOUT_MS = 30_000;
const READINESS_POLL_INTERVAL_MS = 250;

/** A worktree-relative path that does not escape the worktree, or null. */
function safeWorktreePath(worktreeRoot: string, rel: string): string | null {
  if (rel.length === 0 || isAbsolute(rel)) return null;
  const normalized = normalize(rel);
  if (normalized === '..' || normalized.startsWith('../')) return null;
  return join(worktreeRoot, normalized);
}

async function producedNonEmpty(absPath: string): Promise<boolean> {
  try {
    const s = await stat(absPath);
    return s.isFile() && s.size > 0;
  } catch {
    return false;
  }
}

/**
 * Build a CaptureRunner bound to a worktree root, the declared captures, and the
 * (scrubbed-env, worktree-pinned) ScriptRunner used to run declared render/start
 * scripts. The returned runner never accepts a free-form target — only a declared
 * capture name.
 */
export function createCaptureRunner(
  worktreeRoot: string,
  declaredCaptures: DeclaredCaptures,
  scriptRunner: ScriptRunner,
): CaptureRunner {
  return async (name: string): Promise<CaptureResult> => {
    const def = declaredCaptures[name];
    if (def === undefined) {
      return {
        ok: false,
        kind: 'render-document',
        detail: `Capture "${name}" is not in the declared set.`,
        durationMs: 0,
      };
    }
    const started = Date.now();
    const timeoutMs = def.timeoutMs ?? DEFAULT_CAPTURE_TIMEOUT_MS;
    try {
      switch (def.kind) {
        case 'render-document':
          return await runRenderDocument(def, worktreeRoot, scriptRunner, timeoutMs, started);
        case 'screenshot-ui':
          return await runScreenshotUi(def, worktreeRoot, scriptRunner, timeoutMs, started);
        case 'drive-endpoint':
          return await runDriveEndpoint(def, worktreeRoot, scriptRunner, timeoutMs, started);
      }
    } catch (err) {
      return {
        ok: false,
        kind: def.kind,
        detail: `Capture "${name}" errored: ${err instanceof Error ? err.message : String(err)}`,
        durationMs: Date.now() - started,
      };
    }
  };
}

async function runRenderDocument(
  def: Extract<CaptureDef, { kind: 'render-document' }>,
  worktreeRoot: string,
  scriptRunner: ScriptRunner,
  timeoutMs: number,
  started: number,
): Promise<CaptureResult> {
  const kind = 'render-document' as const;
  const outAbs = safeWorktreePath(worktreeRoot, def.outputPath);
  const fileAbs = safeWorktreePath(worktreeRoot, def.file);
  if (outAbs === null || fileAbs === null) {
    return { ok: false, kind, detail: 'render-document paths must be worktree-relative and in-bounds', durationMs: Date.now() - started };
  }
  const result = await scriptRunner.run(def.renderScript, undefined, timeoutMs);
  if (!result.ok) {
    const reason = result.timedOut ? 'timed out' : result.exitStatus === null ? 'error' : `exit ${result.exitStatus}`;
    return { ok: false, kind, detail: `render script "${def.renderScript}" failed (${reason}): ${result.output}`, durationMs: Date.now() - started };
  }
  if (!(await producedNonEmpty(outAbs))) {
    return { ok: false, kind, detail: `render script produced no output at ${def.outputPath}`, durationMs: Date.now() - started };
  }
  return { ok: true, kind, outputRef: def.outputPath, detail: `rendered ${def.file} → ${def.outputPath}`, durationMs: Date.now() - started };
}

async function runScreenshotUi(
  def: Extract<CaptureDef, { kind: 'screenshot-ui' }>,
  worktreeRoot: string,
  scriptRunner: ScriptRunner,
  timeoutMs: number,
  started: number,
): Promise<CaptureResult> {
  const kind = 'screenshot-ui' as const;
  const outAbs = safeWorktreePath(worktreeRoot, def.outputPath);
  if (outAbs === null) {
    return { ok: false, kind, detail: 'screenshot output path must be worktree-relative and in-bounds', durationMs: Date.now() - started };
  }
  // The start script both launches the server AND captures the screenshot: keeping
  // the browser dependency in a declared script preserves the factory's zero-dep
  // posture (ADR-042 §Tradeoffs). The runner's job is the safety envelope and the
  // deterministic floor — did a non-empty screenshot land at the declared path?
  const result = await scriptRunner.run(def.startScript, undefined, timeoutMs);
  if (!result.ok) {
    const reason = result.timedOut ? 'timed out' : result.exitStatus === null ? 'error' : `exit ${result.exitStatus}`;
    return { ok: false, kind, detail: `screenshot script "${def.startScript}" failed (${reason}): ${result.output}`, durationMs: Date.now() - started };
  }
  if (!(await producedNonEmpty(outAbs))) {
    return { ok: false, kind, detail: `screenshot script produced no image at ${def.outputPath}`, durationMs: Date.now() - started };
  }
  return { ok: true, kind, outputRef: def.outputPath, detail: `screenshot of ${def.route} → ${def.outputPath}`, durationMs: Date.now() - started };
}

async function runDriveEndpoint(
  def: Extract<CaptureDef, { kind: 'drive-endpoint' }>,
  worktreeRoot: string,
  scriptRunner: ScriptRunner,
  timeoutMs: number,
  started: number,
): Promise<CaptureResult> {
  const kind = 'drive-endpoint' as const;
  const outAbs = safeWorktreePath(worktreeRoot, def.outputPath);
  if (outAbs === null) {
    return { ok: false, kind, detail: 'response output path must be worktree-relative and in-bounds', durationMs: Date.now() - started };
  }
  // Start the server in the background; the declared start script blocks while the
  // server runs, so it is fired without awaiting and killed via the timeout. The
  // runner polls the loopback port for readiness, then issues one request.
  const deadline = started + timeoutMs;
  const serverRun = scriptRunner.run(def.startScript, undefined, timeoutMs);
  const ready = await waitForPort(def.port, deadline);
  if (!ready) {
    void serverRun;
    return { ok: false, kind, detail: `server did not become ready on 127.0.0.1:${def.port} within ${timeoutMs}ms`, durationMs: Date.now() - started };
  }
  const body = await loopbackRequest(def.method, def.port, def.path, Math.max(1, deadline - Date.now()));
  if (body === null) {
    return { ok: false, kind, detail: `no response from 127.0.0.1:${def.port}${def.path}`, durationMs: Date.now() - started };
  }
  await writeFile(outAbs, body, 'utf8');
  if (!(await producedNonEmpty(outAbs))) {
    return { ok: false, kind, detail: `endpoint returned empty body`, durationMs: Date.now() - started };
  }
  return { ok: true, kind, outputRef: def.outputPath, detail: `drove ${def.method} ${def.path} → ${def.outputPath}`, durationMs: Date.now() - started };
}

/** Poll the loopback port until a TCP connection succeeds or the deadline passes. */
async function waitForPort(port: number, deadline: number): Promise<boolean> {
  const net = await import('node:net');
  while (Date.now() < deadline) {
    const open = await new Promise<boolean>((resolve) => {
      const socket = net.connect({ host: '127.0.0.1', port }, () => {
        socket.destroy();
        resolve(true);
      });
      socket.on('error', () => resolve(false));
      socket.setTimeout(READINESS_POLL_INTERVAL_MS, () => {
        socket.destroy();
        resolve(false);
      });
    });
    if (open) return true;
    await new Promise((r) => setTimeout(r, READINESS_POLL_INTERVAL_MS));
  }
  return false;
}

/**
 * Issue one HTTP request to 127.0.0.1 on the declared port and return the body,
 * or null on failure/timeout. The host is hard-pinned to loopback — there is no
 * parameter for a non-loopback address.
 */
function loopbackRequest(
  method: string,
  port: number,
  path: string,
  timeoutMs: number,
): Promise<string | null> {
  return new Promise((resolve) => {
    const req = httpRequest({ host: '127.0.0.1', port, method, path, timeout: timeoutMs }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
    req.end();
  });
}

/**
 * Wrap a CaptureRunner so every run appends one `capture-ran` event, the capture
 * analogue of `loggingScriptRunner`'s `script-ran`. `ok` is the deterministic
 * floor and is what the milestone loop's per-round assessment gates on.
 */
export function loggingCaptureRunner(
  store: EventStore,
  runner: CaptureRunner,
  goalId: string,
  now: () => number = () => Date.now(),
): CaptureRunner {
  return async (name: string): Promise<CaptureResult> => {
    const result = await runner(name);
    const event: FactoryEvent = {
      type: 'capture-ran',
      at: now(),
      goalId,
      captureName: name,
      kind: result.kind,
      ok: result.ok,
      durationMs: result.durationMs,
      ...(result.outputRef !== undefined ? { outputRef: result.outputRef } : {}),
    };
    await store.append(event);
    return result;
  };
}

/**
 * Validate a declared-captures map at config time: reject a capture whose
 * declared-script references or paths are structurally unsafe, so a bad
 * declaration fails before any run (ADR-042 §7). Returns the first problem, or
 * null when every capture is well-formed.
 */
export function validateDeclaredCaptures(
  declaredCaptures: DeclaredCaptures,
  declaredScriptNames: ReadonlySet<string>,
): string | null {
  for (const [name, def] of Object.entries(declaredCaptures)) {
    const scriptRef = def.kind === 'render-document' ? def.renderScript : def.startScript;
    if (!declaredScriptNames.has(scriptRef)) {
      return `capture "${name}" references undeclared script "${scriptRef}"`;
    }
    if (isAbsolute(def.outputPath) || normalize(def.outputPath).startsWith('..')) {
      return `capture "${name}" outputPath must be worktree-relative and in-bounds`;
    }
    if (def.kind === 'render-document' && (isAbsolute(def.file) || normalize(def.file).startsWith('..'))) {
      return `capture "${name}" file must be worktree-relative and in-bounds`;
    }
    if ((def.kind === 'screenshot-ui' || def.kind === 'drive-endpoint') && (!Number.isInteger(def.port) || def.port <= 0 || def.port > 65535)) {
      return `capture "${name}" declares an invalid port ${def.port}`;
    }
  }
  return null;
}
