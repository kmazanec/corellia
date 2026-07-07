import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { get as httpGet } from 'node:http';

import { startStaticServer, resolvePlaywrightLauncher } from '../../src/library/browser-capture.js';

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});
function tmpRoot(): string {
  const r = mkdtempSync(join(tmpdir(), 'browser-cap-'));
  roots.push(r);
  return r;
}

/** GET a loopback URL, resolving [status, body]. */
function fetchOnce(url: string): Promise<[number, string]> {
  return new Promise((resolve, reject) => {
    httpGet(url, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve([res.statusCode ?? 0, Buffer.concat(chunks).toString('utf8')]));
    }).on('error', reject);
  });
}

describe('startStaticServer', () => {
  it('serves a file and defaults a directory to index.html', async () => {
    const root = tmpRoot();
    writeFileSync(join(root, 'index.html'), '<h1>root</h1>', 'utf8');
    mkdirSync(join(root, 'sub'), { recursive: true });
    writeFileSync(join(root, 'sub', 'index.html'), '<p>sub</p>', 'utf8');

    const server = await startStaticServer(root);
    try {
      expect(await fetchOnce(`http://127.0.0.1:${server.port}/`)).toEqual([200, '<h1>root</h1>']);
      expect(await fetchOnce(`http://127.0.0.1:${server.port}/index.html`)).toEqual([200, '<h1>root</h1>']);
      expect(await fetchOnce(`http://127.0.0.1:${server.port}/sub/`)).toEqual([200, '<p>sub</p>']);
    } finally {
      await server.stop();
    }
  });

  it('404s a missing file', async () => {
    const root = tmpRoot();
    const server = await startStaticServer(root);
    try {
      const [status] = await fetchOnce(`http://127.0.0.1:${server.port}/nope.html`);
      expect(status).toBe(404);
    } finally {
      await server.stop();
    }
  });

  it('refuses path traversal outside the served root', async () => {
    const root = tmpRoot();
    // A secret one level ABOVE the served root must never be reachable.
    writeFileSync(join(root, 'secret.txt'), 'top-secret', 'utf8');
    const served = join(root, 'served');
    mkdirSync(served, { recursive: true });
    writeFileSync(join(served, 'index.html'), 'ok', 'utf8');

    const server = await startStaticServer(served);
    try {
      const [status, body] = await fetchOnce(`http://127.0.0.1:${server.port}/..%2fsecret.txt`);
      expect(status).toBe(403);
      expect(body).not.toContain('top-secret');
    } finally {
      await server.stop();
    }
  });
});

describe('resolvePlaywrightLauncher', () => {
  it('returns null when playwright is not installed (optional dependency)', async () => {
    // Playwright is intentionally NOT a dependency; the resolver must degrade to
    // null rather than throw, so the built-in path is simply unavailable.
    const launcher = await resolvePlaywrightLauncher();
    expect(launcher).toBeNull();
  });
});
