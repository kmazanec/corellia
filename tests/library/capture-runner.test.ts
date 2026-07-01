import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, type Server } from 'node:http';

import { createCaptureRunner, validateDeclaredCaptures } from '../../src/library/capture-runner.js';
import type { DeclaredCaptures } from '../../src/contract/capture.js';
import type { ScriptRunner } from '../../src/library/script-runner.js';

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
});
