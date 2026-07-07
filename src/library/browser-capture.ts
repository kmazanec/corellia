/**
 * Built-in fallback for `screenshot-ui` captures (ADR-042). A repo that ships its
 * own start-and-screenshot script keeps precedence — that path is the repo's, and
 * this module is never reached for it. This is the FLOOR: for a repo that ships no
 * screenshot script (most repos; every greenfield project), the factory can still
 * produce a real PNG proof of a running UI by starting a server (a declared serve
 * script, or a built-in static file server for plain HTML) and driving a headless
 * browser to a route itself.
 *
 * The browser is an OPTIONAL runtime dependency, resolved by dynamic import: when
 * it is absent the built-in path is simply unavailable and the capture fails with
 * a clear reason — the repo-script path and the zero-dep factory core are
 * untouched. Tests drive an injected {@link BrowserLauncher} seam, so the built-in
 * path is provable without ever downloading a browser in CI.
 *
 * The safety envelope is the one ADR-042 fixed for every capture: the server is
 * started through the worktree-pinned, env-scrubbed ScriptRunner; the browser
 * reaches 127.0.0.1 on the declared port only; the whole capture is wall-clock
 * bounded; the PNG lands at a worktree-relative, in-bounds path.
 */

import { createServer, type Server } from 'node:http';
import { createReadStream, type Stats } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join, normalize, extname } from 'node:path';

/**
 * A minimal headless-browser seam: navigate to a loopback URL and write a PNG to
 * an absolute path. Playwright is the production implementation (resolved at
 * runtime); tests inject a fake. The launcher owns the browser lifecycle — it must
 * always close the browser before resolving, whether the screenshot succeeded or
 * threw.
 */
export type BrowserLauncher = (job: ScreenshotJob) => Promise<void>;

/** One screenshot request handed to a {@link BrowserLauncher}. */
export interface ScreenshotJob {
  /** The full loopback URL to navigate to (e.g. `http://127.0.0.1:5173/`). */
  url: string;
  /** Absolute filesystem path the PNG must be written to. */
  outputAbsPath: string;
  /** Wall-clock ceiling for navigation + screenshot, in milliseconds. */
  timeoutMs: number;
  /** Extra settle time after load before the shot, in milliseconds. */
  waitForMs: number;
}

/**
 * Resolve the built-in Playwright launcher, or null when Playwright is not
 * installed. The import is dynamic and its failure is swallowed: the factory core
 * declares no dependency on Playwright, so its absence is a normal, expected state
 * that degrades the built-in capture rather than crashing anything.
 */
export async function resolvePlaywrightLauncher(): Promise<BrowserLauncher | null> {
  let chromium: PlaywrightChromium;
  try {
    // A computed specifier keeps `playwright` out of the static module graph, so
    // the factory declares no build-time dependency on it: `tsc` does not try to
    // resolve it, and its runtime absence is caught here, not at load.
    const specifier = 'playwright';
    const mod = (await import(specifier)) as { chromium?: PlaywrightChromium };
    if (mod.chromium === undefined) return null;
    chromium = mod.chromium;
  } catch {
    return null;
  }
  if (typeof chromium.launch !== 'function') return null;
  return async (job: ScreenshotJob): Promise<void> => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.goto(job.url, { waitUntil: 'networkidle', timeout: job.timeoutMs });
      if (job.waitForMs > 0) await page.waitForTimeout(job.waitForMs);
      await page.screenshot({ path: job.outputAbsPath, fullPage: true });
    } finally {
      await browser.close();
    }
  };
}

/** The slice of Playwright's `chromium` surface the built-in launcher uses. */
interface PlaywrightChromium {
  launch(options: { headless: boolean }): Promise<PlaywrightBrowser>;
}
interface PlaywrightBrowser {
  newPage(): Promise<PlaywrightPage>;
  close(): Promise<void>;
}
interface PlaywrightPage {
  goto(url: string, options: { waitUntil: string; timeout: number }): Promise<unknown>;
  waitForTimeout(ms: number): Promise<void>;
  screenshot(options: { path: string; fullPage: boolean }): Promise<unknown>;
}

/**
 * A running loopback server, either a repo serve script (already launched by the
 * caller through the ScriptRunner and killed via its timeout) or a built-in static
 * file server this module owns. `stop` tears down whatever this module started; it
 * is a no-op for a serve-script server (that one dies with the capture timeout).
 */
export interface RunningServer {
  port: number;
  stop(): Promise<void>;
}

/**
 * Start a built-in static file server rooted at `rootDir`, bound to loopback on an
 * OS-assigned free port. It serves files under `rootDir` only — a request path is
 * lexically confined to the root, and traversal outside it is a 403. This is the
 * plain-HTML fallback: a repo with an `index.html` and no serve command still gets
 * a URL to screenshot.
 */
export async function startStaticServer(rootDir: string): Promise<RunningServer> {
  const server = createServer((req, res) => {
    void serveStaticFile(rootDir, req.url ?? '/', res);
  });
  const port = await listenOnFreePort(server);
  return {
    port,
    stop: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

async function serveStaticFile(
  rootDir: string,
  rawUrl: string,
  res: import('node:http').ServerResponse,
): Promise<void> {
  const requested = decodeRequestPath(rawUrl);
  if (requested === null) return respond(res, 403, 'Forbidden');
  const rel = requested === '' || requested.endsWith('/') ? `${requested}index.html` : requested;
  const abs = join(rootDir, rel);
  let info: Stats;
  try {
    info = await stat(abs);
  } catch {
    return respond(res, 404, 'Not Found');
  }
  if (info.isDirectory()) return serveStaticFile(rootDir, `${requested.replace(/\/$/, '')}/`, res);
  res.writeHead(200, { 'content-type': CONTENT_TYPES[extname(abs).toLowerCase()] ?? 'application/octet-stream' });
  createReadStream(abs).pipe(res);
}

/**
 * Normalize a request URL to a root-relative path, or null if it escapes the root.
 * The query string is dropped; `%..%2f`-style traversal is rejected after decode.
 */
function decodeRequestPath(rawUrl: string): string | null {
  const withoutQuery = rawUrl.split('?')[0] ?? '/';
  let decoded: string;
  try {
    decoded = decodeURIComponent(withoutQuery);
  } catch {
    return null;
  }
  const trimmed = decoded.replace(/^\/+/, '');
  const normalized = normalize(trimmed);
  if (normalized === '..' || normalized.startsWith('..')) return null;
  return normalized === '.' ? '' : normalized;
}

function respond(res: import('node:http').ServerResponse, code: number, body: string): void {
  res.writeHead(code, { 'content-type': 'text/plain; charset=utf-8' });
  res.end(body);
}

function listenOnFreePort(server: Server): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (addr === null || typeof addr === 'string') {
        server.close();
        reject(new Error('static server did not bind a numeric port'));
        return;
      }
      resolve(addr.port);
    });
  });
}
