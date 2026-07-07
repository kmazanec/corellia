import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, get as httpGet, type Server } from 'node:http';

import { createCaptureRunner, validateDeclaredCaptures } from '../../src/library/capture-runner.js';
import type { DeclaredCaptures } from '../../src/contract/capture.js';
import type { ScriptRunner } from '../../src/library/script-runner.js';
import type { BrowserLauncher, ScreenshotJob } from '../../src/library/browser-capture.js';

const roots: string[] = [];
const servers: Server[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
  for (const s of servers.splice(0)) s.close();
});
function tmpRoot(): string {
  const r = mkdtempSync(join(tmpdir(), 'cap-'));
  roots.push(r);
  return r;
}

/** A ScriptRunner stub that runs a supplied side effect and reports ok/exit. */
function stubRunner(effect: (name: string) => Promise<{ ok: boolean }>): ScriptRunner {
  return {
    async run(name: string) {
      const { ok } = await effect(name);
      return { ok, exitStatus: ok ? 0 : 1, output: ok ? 'ok' : 'fail', fullOutput: '', durationMs: 1, timedOut: false };
    },
  };
}

describe('createCaptureRunner', () => {
  it('refuses an undeclared capture name', async () => {
    const run = createCaptureRunner(tmpRoot(), {}, stubRunner(async () => ({ ok: true })));
    const r = await run('nope');
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/not in the declared set/);
  });

  it('render-document passes when the render script writes non-empty output', async () => {
    const root = tmpRoot();
    const captures: DeclaredCaptures = {
      doc: { kind: 'render-document', file: 'in.txt', renderScript: 'render', outputPath: 'out.txt' },
    };
    const runner = stubRunner(async () => {
      writeFileSync(join(root, 'out.txt'), 'rendered', 'utf8');
      return { ok: true };
    });
    const r = await createCaptureRunner(root, captures, runner)('doc');
    expect(r.ok).toBe(true);
    expect(r.outputRef).toBe('out.txt');
  });

  it('render-document fails when the render script succeeds but writes nothing', async () => {
    const root = tmpRoot();
    const captures: DeclaredCaptures = {
      doc: { kind: 'render-document', file: 'in.txt', renderScript: 'render', outputPath: 'out.txt' },
    };
    const r = await createCaptureRunner(root, captures, stubRunner(async () => ({ ok: true })))('doc');
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/no output/);
  });

  it('render-document fails when the render script exits non-zero', async () => {
    const root = tmpRoot();
    const captures: DeclaredCaptures = {
      doc: { kind: 'render-document', file: 'in.txt', renderScript: 'render', outputPath: 'out.txt' },
    };
    const r = await createCaptureRunner(root, captures, stubRunner(async () => ({ ok: false })))('doc');
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/render script/);
  });

  it('drive-endpoint drives a loopback server and captures the response', async () => {
    const root = tmpRoot();
    const server = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('healthy');
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;

    const captures: DeclaredCaptures = {
      health: { kind: 'drive-endpoint', startScript: 'noop', port, method: 'GET', path: '/health', outputPath: 'resp.txt', timeoutMs: 3000 },
    };
    // The server is already up; the start script is a no-op that stays "running".
    const runner = stubRunner(async () => new Promise<{ ok: boolean }>(() => {}) as never);
    const r = await createCaptureRunner(root, captures, runner)('health');
    expect(r.ok).toBe(true);
    expect(readFileSync(join(root, 'resp.txt'), 'utf8')).toBe('healthy');
  });

  it('drive-endpoint fails when the server never becomes ready', async () => {
    const root = tmpRoot();
    const captures: DeclaredCaptures = {
      health: { kind: 'drive-endpoint', startScript: 'noop', port: 59999, method: 'GET', path: '/x', outputPath: 'resp.txt', timeoutMs: 800 },
    };
    const runner = stubRunner(async () => new Promise<{ ok: boolean }>(() => {}) as never);
    const r = await createCaptureRunner(root, captures, runner)('health');
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/did not become ready/);
  });

  it('rejects an output path that escapes the worktree', async () => {
    const root = tmpRoot();
    const captures: DeclaredCaptures = {
      doc: { kind: 'render-document', file: 'in.txt', renderScript: 'render', outputPath: '../escape.txt' },
    };
    const r = await createCaptureRunner(root, captures, stubRunner(async () => ({ ok: true })))('doc');
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/worktree-relative/);
    expect(existsSync(join(root, '..', 'escape.txt'))).toBe(false);
  });
});

/**
 * A fake BrowserLauncher: instead of a real browser, it GETs the URL over loopback
 * and writes the fetched bytes to the PNG path. This exercises the whole built-in
 * path — resolve launcher → bring server up → wait for port → drive → write PNG →
 * deterministic floor — with no browser download, and records the URL it drove.
 */
function fetchingLauncher(seen: ScreenshotJob[]): BrowserLauncher {
  return async (job) => {
    seen.push(job);
    const body = await new Promise<string>((resolve, reject) => {
      httpGet(job.url, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      }).on('error', reject);
    });
    writeFileSync(job.outputAbsPath, `PNG:${body}`, 'utf8');
  };
}

describe('createCaptureRunner built-in screenshot (fallback)', () => {
  it('drives the built-in static server and writes a PNG via the injected launcher', async () => {
    const root = tmpRoot();
    writeFileSync(join(root, 'index.html'), '<h1>hello ui</h1>', 'utf8');
    const captures: DeclaredCaptures = {
      home: { kind: 'screenshot-ui', screenshotMode: 'built-in', route: '/', outputPath: 'shot.png', timeoutMs: 4000 },
    };
    const seen: ScreenshotJob[] = [];
    // No serve script is used, so the ScriptRunner is never invoked.
    const runner = stubRunner(async () => ({ ok: true }));
    const run = createCaptureRunner(root, captures, runner, async () => fetchingLauncher(seen));
    const r = await run('home');
    expect(r.ok).toBe(true);
    expect(r.outputRef).toBe('shot.png');
    expect(readFileSync(join(root, 'shot.png'), 'utf8')).toBe('PNG:<h1>hello ui</h1>');
    expect(seen[0]?.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
  });

  it('serves a nested staticDir and route', async () => {
    const root = tmpRoot();
    mkdirSync(join(root, 'public'), { recursive: true });
    writeFileSync(join(root, 'public', 'about.html'), '<p>about page</p>', 'utf8');
    const captures: DeclaredCaptures = {
      about: { kind: 'screenshot-ui', screenshotMode: 'built-in', staticDir: 'public', route: '/about.html', outputPath: 'about.png', timeoutMs: 4000 },
    };
    const seen: ScreenshotJob[] = [];
    const run = createCaptureRunner(root, captures, stubRunner(async () => ({ ok: true })), async () => fetchingLauncher(seen));
    const r = await run('about');
    expect(r.ok).toBe(true);
    expect(readFileSync(join(root, 'about.png'), 'utf8')).toBe('PNG:<p>about page</p>');
  });

  it('uses a declared serve script + port when startScript is present', async () => {
    const root = tmpRoot();
    const server = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<b>served</b>');
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;

    const captures: DeclaredCaptures = {
      ui: { kind: 'screenshot-ui', screenshotMode: 'built-in', startScript: 'serve', port, route: '/', outputPath: 'ui.png', timeoutMs: 4000 },
    };
    let serveRan = false;
    // The serve script "stays running" (never resolves) — killed via the timeout.
    const runner: ScriptRunner = {
      async run(name: string) {
        if (name === 'serve') serveRan = true;
        return new Promise(() => {}) as never;
      },
    };
    const seen: ScreenshotJob[] = [];
    const run = createCaptureRunner(root, captures, runner, async () => fetchingLauncher(seen));
    const r = await run('ui');
    expect(r.ok).toBe(true);
    expect(serveRan).toBe(true);
    expect(readFileSync(join(root, 'ui.png'), 'utf8')).toBe('PNG:<b>served</b>');
    expect(seen[0]?.url).toBe(`http://127.0.0.1:${port}/`);
  });

  it('degrades to a clear failure when no browser is resolvable (playwright absent)', async () => {
    const root = tmpRoot();
    writeFileSync(join(root, 'index.html'), '<h1>x</h1>', 'utf8');
    const captures: DeclaredCaptures = {
      home: { kind: 'screenshot-ui', screenshotMode: 'built-in', route: '/', outputPath: 'shot.png' },
    };
    const run = createCaptureRunner(root, captures, stubRunner(async () => ({ ok: true })), async () => null);
    const r = await run('home');
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/no headless browser is installed/);
    expect(existsSync(join(root, 'shot.png'))).toBe(false);
  });

  it('fails when the launcher writes nothing (the deterministic floor)', async () => {
    const root = tmpRoot();
    writeFileSync(join(root, 'index.html'), '<h1>x</h1>', 'utf8');
    const captures: DeclaredCaptures = {
      home: { kind: 'screenshot-ui', screenshotMode: 'built-in', route: '/', outputPath: 'shot.png', timeoutMs: 4000 },
    };
    // A launcher that "succeeds" but writes no file — the floor must reject it.
    const noopLauncher: BrowserLauncher = async () => {};
    const run = createCaptureRunner(root, captures, stubRunner(async () => ({ ok: true })), async () => noopLauncher);
    const r = await run('home');
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/produced no image/);
  });

  it('script mode is unchanged and never resolves a browser (repo-script precedence)', async () => {
    const root = tmpRoot();
    const captures: DeclaredCaptures = {
      ui: { kind: 'screenshot-ui', startScript: 'shot', port: 4321, route: '/', outputPath: 'ui.png', timeoutMs: 4000 },
    };
    let resolverCalled = false;
    const runner = stubRunner(async () => {
      writeFileSync(join(root, 'ui.png'), 'repo-png', 'utf8');
      return { ok: true };
    });
    const run = createCaptureRunner(root, captures, runner, async () => {
      resolverCalled = true;
      return null;
    });
    const r = await run('ui');
    expect(r.ok).toBe(true);
    expect(resolverCalled).toBe(false);
    expect(readFileSync(join(root, 'ui.png'), 'utf8')).toBe('repo-png');
  });
});

describe('validateDeclaredCaptures', () => {
  it('accepts a well-formed capture whose script is declared', () => {
    const err = validateDeclaredCaptures(
      { doc: { kind: 'render-document', file: 'in.txt', renderScript: 'render', outputPath: 'out.txt' } },
      new Set(['render']),
    );
    expect(err).toBeNull();
  });

  it('rejects a capture referencing an undeclared script', () => {
    const err = validateDeclaredCaptures(
      { doc: { kind: 'render-document', file: 'in.txt', renderScript: 'ghost', outputPath: 'out.txt' } },
      new Set(['render']),
    );
    expect(err).toMatch(/undeclared script/);
  });

  it('rejects an out-of-bounds output path', () => {
    const err = validateDeclaredCaptures(
      { doc: { kind: 'render-document', file: 'in.txt', renderScript: 'render', outputPath: '/etc/passwd' } },
      new Set(['render']),
    );
    expect(err).toMatch(/worktree-relative/);
  });

  it('rejects an invalid port', () => {
    const err = validateDeclaredCaptures(
      { ui: { kind: 'screenshot-ui', startScript: 'start', port: 0, route: '/', outputPath: 'shot.png' } },
      new Set(['start']),
    );
    expect(err).toMatch(/invalid port/);
  });

  it('rejects a script-mode screenshot with no startScript', () => {
    const err = validateDeclaredCaptures(
      { ui: { kind: 'screenshot-ui', route: '/', outputPath: 'shot.png' } },
      new Set(),
    );
    expect(err).toMatch(/must declare a startScript/);
  });

  it('accepts a built-in static screenshot with no startScript or port', () => {
    const err = validateDeclaredCaptures(
      { ui: { kind: 'screenshot-ui', screenshotMode: 'built-in', staticDir: 'public', route: '/', outputPath: 'shot.png' } },
      new Set(),
    );
    expect(err).toBeNull();
  });

  it('requires a port for a built-in screenshot that uses a serve script', () => {
    const err = validateDeclaredCaptures(
      { ui: { kind: 'screenshot-ui', screenshotMode: 'built-in', startScript: 'serve', route: '/', outputPath: 'shot.png' } },
      new Set(['serve']),
    );
    expect(err).toMatch(/invalid port/);
  });

  it('rejects a built-in screenshot whose serve script is undeclared', () => {
    const err = validateDeclaredCaptures(
      { ui: { kind: 'screenshot-ui', screenshotMode: 'built-in', startScript: 'ghost', port: 3000, route: '/', outputPath: 'shot.png' } },
      new Set(),
    );
    expect(err).toMatch(/undeclared script/);
  });

  it('rejects an out-of-bounds staticDir', () => {
    const err = validateDeclaredCaptures(
      { ui: { kind: 'screenshot-ui', screenshotMode: 'built-in', staticDir: '../secrets', route: '/', outputPath: 'shot.png' } },
      new Set(),
    );
    expect(err).toMatch(/staticDir must be worktree-relative/);
  });
});
