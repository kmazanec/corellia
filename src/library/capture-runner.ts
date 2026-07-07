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
import {
  resolvePlaywrightLauncher,
  startStaticServer,
  type BrowserLauncher,
  type RunningServer,
} from './browser-capture.js';

const DEFAULT_CAPTURE_TIMEOUT_MS = 30_000;
const READINESS_POLL_INTERVAL_MS = 250;

/**
 * How the built-in `screenshot-ui` path obtains a headless browser. Production
 * resolves Playwright by dynamic import ({@link resolvePlaywrightLauncher}); tests
 * inject a fake so the built-in path is provable without a real browser download.
 * A resolver that returns null means "no browser available" — the built-in path
 * degrades to a clear failure and the repo-script path is untouched.
 */
export type BrowserLauncherResolver = () => Promise<BrowserLauncher | null>;

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
  resolveBrowserLauncher: BrowserLauncherResolver = resolvePlaywrightLauncher,
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
          return await runScreenshotUi(def, worktreeRoot, scriptRunner, resolveBrowserLauncher, timeoutMs, started);
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
  resolveBrowserLauncher: BrowserLauncherResolver,
  timeoutMs: number,
  started: number,
): Promise<CaptureResult> {
  const kind = 'screenshot-ui' as const;
  const outAbs = safeWorktreePath(worktreeRoot, def.outputPath);
  if (outAbs === null) {
    return { ok: false, kind, detail: 'screenshot output path must be worktree-relative and in-bounds', durationMs: Date.now() - started };
  }
  // A repo-declared screenshot script always wins (ADR-042); the built-in browser
  // is only the FLOOR for repos that ship none. `screenshotMode` fixes which path
  // runs — default 'script' keeps every existing declaration byte-identical.
  return (def.screenshotMode ?? 'script') === 'built-in'
    ? runBuiltInScreenshot(def, worktreeRoot, outAbs, scriptRunner, resolveBrowserLauncher, timeoutMs, started)
    : runScriptScreenshot(def, outAbs, scriptRunner, timeoutMs, started);
}

async function runScriptScreenshot(
  def: Extract<CaptureDef, { kind: 'screenshot-ui' }>,
  outAbs: string,
  scriptRunner: ScriptRunner,
  timeoutMs: number,
  started: number,
): Promise<CaptureResult> {
  const kind = 'screenshot-ui' as const;
  if (def.startScript === undefined) {
    return { ok: false, kind, detail: 'script-mode screenshot requires a startScript', durationMs: Date.now() - started };
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

/**
 * The built-in screenshot floor: bring a server up (declared serve script or the
 * built-in static server), drive a headless browser to the route, and write the
 * PNG. When no browser is resolvable the path degrades to a clear failure — the
 * repo-script path and the zero-dep core are untouched.
 */
async function runBuiltInScreenshot(
  def: Extract<CaptureDef, { kind: 'screenshot-ui' }>,
  worktreeRoot: string,
  outAbs: string,
  scriptRunner: ScriptRunner,
  resolveBrowserLauncher: BrowserLauncherResolver,
  timeoutMs: number,
  started: number,
): Promise<CaptureResult> {
  const kind = 'screenshot-ui' as const;
  const deadline = started + timeoutMs;
  const launcher = await resolveBrowserLauncher();
  if (launcher === null) {
    return { ok: false, kind, detail: 'built-in screenshot is unavailable: no headless browser is installed (optional dependency "playwright")', durationMs: Date.now() - started };
  }

  const server = await startCaptureServer(def, worktreeRoot, scriptRunner, deadline);
  if (!server.ok) return { ok: false, kind, detail: server.detail, durationMs: Date.now() - started };
  try {
    const ready = await waitForPort(server.port, deadline);
    if (!ready) {
      return { ok: false, kind, detail: `server did not become ready on 127.0.0.1:${server.port} within ${timeoutMs}ms`, durationMs: Date.now() - started };
    }
    await launcher({
      url: `http://127.0.0.1:${server.port}${normalizeRoute(def.route)}`,
      outputAbsPath: outAbs,
      timeoutMs: Math.max(1, deadline - Date.now()),
      waitForMs: def.waitForMs ?? 0,
    });
  } catch (err) {
    return { ok: false, kind, detail: `built-in browser failed to screenshot ${def.route}: ${err instanceof Error ? err.message : String(err)}`, durationMs: Date.now() - started };
  } finally {
    await server.stop();
  }

  if (!(await producedNonEmpty(outAbs))) {
    return { ok: false, kind, detail: `built-in screenshot produced no image at ${def.outputPath}`, durationMs: Date.now() - started };
  }
  return { ok: true, kind, outputRef: def.outputPath, detail: `built-in screenshot of ${def.route} → ${def.outputPath}`, durationMs: Date.now() - started };
}

type ServerHandle = { ok: true; port: number; stop: () => Promise<void> } | { ok: false; detail: string };

/**
 * Bring the server up for a built-in screenshot. A declared `startScript` is a
 * plain serve command: it is fired without awaiting (it blocks while the server
 * runs) and killed by the ScriptRunner's timeout — the same discipline as
 * `drive-endpoint`. With no `startScript`, the built-in static server serves the
 * worktree-relative `staticDir` on an OS-assigned free port.
 */
async function startCaptureServer(
  def: Extract<CaptureDef, { kind: 'screenshot-ui' }>,
  worktreeRoot: string,
  scriptRunner: ScriptRunner,
  deadline: number,
): Promise<ServerHandle> {
  if (def.startScript !== undefined) {
    if (def.port === undefined) {
      return { ok: false, detail: 'built-in screenshot with a startScript requires a declared port' };
    }
    void scriptRunner.run(def.startScript, undefined, Math.max(1, deadline - Date.now()));
    return { ok: true, port: def.port, stop: async () => {} };
  }
  const staticDir = def.staticDir ?? '.';
  const dirAbs = safeWorktreePath(worktreeRoot, staticDir);
  if (dirAbs === null) {
    return { ok: false, detail: 'built-in screenshot staticDir must be worktree-relative and in-bounds' };
  }
  let server: RunningServer;
  try {
    server = await startStaticServer(dirAbs);
  } catch (err) {
    return { ok: false, detail: `built-in static server failed to start: ${err instanceof Error ? err.message : String(err)}` };
  }
  return { ok: true, port: server.port, stop: () => server.stop() };
}

/** Ensure a route begins with a single leading slash so URL joining is well-formed. */
function normalizeRoute(route: string): string {
  if (route.length === 0) return '/';
  return route.startsWith('/') ? route : `/${route}`;
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
    if (outOfBounds(def.outputPath)) {
      return `capture "${name}" outputPath must be worktree-relative and in-bounds`;
    }
    const problem = validateCaptureDef(name, def, declaredScriptNames);
    if (problem !== null) return problem;
  }
  return null;
}

function validateCaptureDef(
  name: string,
  def: CaptureDef,
  declaredScriptNames: ReadonlySet<string>,
): string | null {
  switch (def.kind) {
    case 'render-document':
      if (!declaredScriptNames.has(def.renderScript)) {
        return `capture "${name}" references undeclared script "${def.renderScript}"`;
      }
      if (outOfBounds(def.file)) {
        return `capture "${name}" file must be worktree-relative and in-bounds`;
      }
      return null;
    case 'drive-endpoint':
      if (!declaredScriptNames.has(def.startScript)) {
        return `capture "${name}" references undeclared script "${def.startScript}"`;
      }
      if (!validPort(def.port)) return `capture "${name}" declares an invalid port ${def.port}`;
      return null;
    case 'screenshot-ui':
      return validateScreenshotUi(name, def, declaredScriptNames);
  }
}

/**
 * Screenshot-ui admits three shapes: `script` (startScript + port, both required),
 * `built-in` with a serve script (startScript + port), and `built-in` static (no
 * startScript, so no port is needed and the built-in static server binds a free
 * one). Every declared startScript must be in the declared-script set, and
 * staticDir must stay in-bounds.
 */
function validateScreenshotUi(
  name: string,
  def: Extract<CaptureDef, { kind: 'screenshot-ui' }>,
  declaredScriptNames: ReadonlySet<string>,
): string | null {
  if (def.startScript !== undefined && !declaredScriptNames.has(def.startScript)) {
    return `capture "${name}" references undeclared script "${def.startScript}"`;
  }
  if (def.staticDir !== undefined && outOfBounds(def.staticDir)) {
    return `capture "${name}" staticDir must be worktree-relative and in-bounds`;
  }
  const mode = def.screenshotMode ?? 'script';
  if (mode === 'script' && def.startScript === undefined) {
    return `capture "${name}" is script-mode and must declare a startScript`;
  }
  // A port is required whenever a server is reached by a fixed port — always in
  // script mode, and in built-in mode when a serve script (not the built-in static
  // server) is used.
  const needsPort = mode === 'script' || def.startScript !== undefined;
  if (needsPort && !validPort(def.port)) {
    return `capture "${name}" declares an invalid port ${def.port}`;
  }
  return null;
}

function outOfBounds(rel: string): boolean {
  return isAbsolute(rel) || normalize(rel).startsWith('..');
}

function validPort(port: number | undefined): boolean {
  return port !== undefined && Number.isInteger(port) && port > 0 && port <= 65535;
}
