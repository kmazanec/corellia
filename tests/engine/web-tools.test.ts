/**
 * Tests for the research-family web tools (issue: web-fetch-tool). No network
 * calls are made — every test injects a stub transport and a stub host resolver,
 * following the injected-fetch pattern in tests/brains/llm.test.ts and pr-tools.
 *
 * Coverage: happy-path text/HTML/JSON, HTML→text extraction, size + time caps,
 * https-only, SSRF denylist refusals (loopback / RFC-1918 / link-local metadata /
 * DNS-resolved-to-private), redirect limit + redirect-host re-vetting, binary
 * refusal, and web_search provider gating (offered only when configured).
 */

import { describe, it, expect } from 'vitest';
import type { Goal } from '../../src/contract/goal.js';
import {
  webFetchTool,
  webSearchTool,
  webTools,
  searchProviderConfigured,
  classifyContentType,
  extractText,
  isBlockedAddress,
  extraBlockedHosts,
  WEB_FETCH_MAX_BYTES,
  WEB_FETCH_MAX_REDIRECTS,
  type WebFetchResponse,
  type WebFetchTransport,
  type HostResolver,
} from '../../src/engine/web-tools.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const goal: Goal = {
  id: 'g1',
  type: 'research-external',
  parentId: null,
  title: 'research',
  spec: {},
  intent: 'production',
  scope: [],
  budget: { attempts: 3, tokens: 1000, toolCalls: 10, wallClockMs: 60000 },
  memories: [],
};

/** A canned response for a transport stub. */
interface Canned {
  status: number;
  headers: Record<string, string>;
  body: string;
}

function response(c: Canned): WebFetchResponse {
  const headers = new Map(Object.entries(c.headers).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    status: c.status,
    headers: { get: (name: string) => headers.get(name.toLowerCase()) ?? null },
    text: async () => c.body,
  };
}

/** A transport that returns canned responses keyed by request order, recording URLs. */
function stubTransport(...cans: Canned[]): { transport: WebFetchTransport; urls: string[] } {
  const urls: string[] = [];
  let idx = 0;
  const transport: WebFetchTransport = async (url) => {
    urls.push(url);
    const c = cans[Math.min(idx++, cans.length - 1)];
    if (c === undefined) throw new Error('no canned response');
    return response(c);
  };
  return { transport, urls };
}

/** A resolver that always returns a fixed public address. */
const publicResolver: HostResolver = async () => ['93.184.216.34'];

function ok(body: string, contentType = 'text/plain'): Canned {
  return { status: 200, headers: { 'content-type': contentType }, body };
}

// ---------------------------------------------------------------------------
// web_fetch — happy paths
// ---------------------------------------------------------------------------

describe('web_fetch — happy path', () => {
  it('returns text with a citation header carrying finalUrl + retrievedAt', async () => {
    const { transport } = stubTransport(ok('hello world'));
    const tool = webFetchTool({ transport, resolve: publicResolver, env: {} });
    const res = await tool.execute(goal, { url: 'https://example.com/doc' });
    expect(res.ok).toBe(true);
    expect(res.output).toContain('hello world');
    expect(res.output).toContain('finalUrl=https://example.com/doc');
    expect(res.output).toMatch(/retrievedAt=\d{4}-\d{2}-\d{2}T/);
    expect(res.output).toContain('CITE THIS SOURCE');
  });

  it('passes JSON through unmodified', async () => {
    const { transport } = stubTransport(ok('{"version":"1.2.3"}', 'application/json'));
    const tool = webFetchTool({ transport, resolve: publicResolver, env: {} });
    const res = await tool.execute(goal, { url: 'https://api.example.com/v' });
    expect(res.ok).toBe(true);
    expect(res.output).toContain('{"version":"1.2.3"}');
  });

  it('strips HTML to readable text', async () => {
    const html =
      '<html><head><title>t</title><style>.a{x}</style></head><body>' +
      '<script>evil()</script><h1>Title</h1><p>First&nbsp;para.</p><p>Second &amp; last.</p></body></html>';
    const { transport } = stubTransport(ok(html, 'text/html'));
    const tool = webFetchTool({ transport, resolve: publicResolver, env: {} });
    const res = await tool.execute(goal, { url: 'https://example.com/' });
    expect(res.ok).toBe(true);
    expect(res.output).toContain('Title');
    expect(res.output).toContain('First para.');
    expect(res.output).toContain('Second & last.');
    expect(res.output).not.toContain('evil()');
    expect(res.output).not.toContain('.a{x}');
  });
});

// ---------------------------------------------------------------------------
// web_fetch — caps
// ---------------------------------------------------------------------------

describe('web_fetch — caps', () => {
  it('truncates a body over the size cap and flags it', async () => {
    const big = 'x'.repeat(WEB_FETCH_MAX_BYTES + 5000);
    const { transport } = stubTransport(ok(big));
    const tool = webFetchTool({ transport, resolve: publicResolver, env: {} });
    const res = await tool.execute(goal, { url: 'https://example.com/big' });
    expect(res.ok).toBe(true);
    expect(res.output).toContain('truncated=true');
    // Body carried is capped (header + cap, not the full oversized body).
    expect(res.output.length).toBeLessThan(WEB_FETCH_MAX_BYTES + 1000);
  });

  it('reports a time-limit refusal when the transport aborts', async () => {
    const transport: WebFetchTransport = async (_url, init) => {
      // Simulate an abort: throw once the signal fires (the tool sets a short-lived timer).
      const err = new Error('aborted');
      // Mark the signal aborted so the tool reports the timeout branch.
      Object.defineProperty(init.signal, 'aborted', { value: true, configurable: true });
      throw err;
    };
    const tool = webFetchTool({ transport, resolve: publicResolver, env: {} });
    const res = await tool.execute(goal, { url: 'https://example.com/slow' });
    expect(res.ok).toBe(false);
    expect(res.output).toContain('time limit');
  });
});

// ---------------------------------------------------------------------------
// web_fetch — https-only + input validation
// ---------------------------------------------------------------------------

describe('web_fetch — protocol + input', () => {
  it('refuses non-https URLs', async () => {
    const { transport, urls } = stubTransport(ok('nope'));
    const tool = webFetchTool({ transport, resolve: publicResolver, env: {} });
    const res = await tool.execute(goal, { url: 'http://example.com/' });
    expect(res.ok).toBe(false);
    expect(res.output).toContain('only https');
    expect(urls).toHaveLength(0);
  });

  it('refuses a non-string / empty url', async () => {
    const tool = webFetchTool({ transport: stubTransport(ok('x')).transport, resolve: publicResolver, env: {} });
    expect((await tool.execute(goal, { url: '' })).ok).toBe(false);
    expect((await tool.execute(goal, {})).ok).toBe(false);
  });

  it('refuses a malformed URL', async () => {
    const tool = webFetchTool({ transport: stubTransport(ok('x')).transport, resolve: publicResolver, env: {} });
    const res = await tool.execute(goal, { url: 'https://' });
    expect(res.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// web_fetch — SSRF denylist
// ---------------------------------------------------------------------------

describe('web_fetch — SSRF denylist', () => {
  it('refuses an https URL whose host is a loopback IP literal', async () => {
    const { transport, urls } = stubTransport(ok('secret'));
    const tool = webFetchTool({ transport, resolve: publicResolver, env: {} });
    const res = await tool.execute(goal, { url: 'https://127.0.0.1/admin' });
    expect(res.ok).toBe(false);
    expect(res.output).toMatch(/private|loopback|metadata/);
    expect(urls).toHaveLength(0);
  });

  it('refuses the cloud metadata endpoint (169.254.169.254)', async () => {
    const { transport } = stubTransport(ok('creds'));
    const tool = webFetchTool({ transport, resolve: publicResolver, env: {} });
    const res = await tool.execute(goal, { url: 'https://169.254.169.254/latest/meta-data/' });
    expect(res.ok).toBe(false);
    expect(res.output).toMatch(/private|loopback|metadata/);
  });

  it('refuses a hostname that DNS-resolves to an RFC-1918 address', async () => {
    const { transport, urls } = stubTransport(ok('internal'));
    const privateResolver: HostResolver = async () => ['10.0.0.5'];
    const tool = webFetchTool({ transport, resolve: privateResolver, env: {} });
    const res = await tool.execute(goal, { url: 'https://sneaky.example.com/' });
    expect(res.ok).toBe(false);
    expect(res.output).toContain('private/loopback/metadata');
    expect(urls).toHaveLength(0);
  });

  it('refuses when ANY resolved address is private (multi-homed rebind)', async () => {
    const { transport } = stubTransport(ok('x'));
    const mixedResolver: HostResolver = async () => ['93.184.216.34', '192.168.1.1'];
    const tool = webFetchTool({ transport, resolve: mixedResolver, env: {} });
    const res = await tool.execute(goal, { url: 'https://rebind.example.com/' });
    expect(res.ok).toBe(false);
  });

  it('honors the WEB_FETCH_BLOCK_HOSTS operator addition', async () => {
    const { transport } = stubTransport(ok('x'));
    const tool = webFetchTool({ transport, resolve: publicResolver, env: { WEB_FETCH_BLOCK_HOSTS: 'evil.example.com, other.test' } });
    const res = await tool.execute(goal, { url: 'https://evil.example.com/' });
    expect(res.ok).toBe(false);
    expect(res.output).toContain('operator block list');
  });
});

// ---------------------------------------------------------------------------
// web_fetch — redirects
// ---------------------------------------------------------------------------

describe('web_fetch — redirects', () => {
  it('follows a redirect and re-vets each hop, returning the final body', async () => {
    const { transport, urls } = stubTransport(
      { status: 302, headers: { location: 'https://example.com/final' }, body: '' },
      ok('final content'),
    );
    const tool = webFetchTool({ transport, resolve: publicResolver, env: {} });
    const res = await tool.execute(goal, { url: 'https://example.com/start' });
    expect(res.ok).toBe(true);
    expect(res.output).toContain('final content');
    expect(res.output).toContain('finalUrl=https://example.com/final');
    expect(urls).toEqual(['https://example.com/start', 'https://example.com/final']);
  });

  it('refuses a redirect into a private address', async () => {
    // First hop public, redirect Location points at a loopback literal.
    const { transport } = stubTransport(
      { status: 302, headers: { location: 'https://127.0.0.1/' }, body: '' },
      ok('should not reach'),
    );
    const tool = webFetchTool({ transport, resolve: publicResolver, env: {} });
    const res = await tool.execute(goal, { url: 'https://example.com/start' });
    expect(res.ok).toBe(false);
    expect(res.output).toMatch(/private|loopback|metadata/);
  });

  it('refuses after exceeding the redirect limit', async () => {
    // Every hop redirects to a fresh public URL — never terminates within the cap.
    let n = 0;
    const transport: WebFetchTransport = async () => {
      n += 1;
      return response({ status: 302, headers: { location: `https://example.com/hop${n}` }, body: '' });
    };
    const tool = webFetchTool({ transport, resolve: publicResolver, env: {} });
    const res = await tool.execute(goal, { url: 'https://example.com/hop0' });
    expect(res.ok).toBe(false);
    expect(res.output).toContain('redirects');
    // At most MAX_REDIRECTS + 1 requests were issued.
    expect(n).toBeLessThanOrEqual(WEB_FETCH_MAX_REDIRECTS + 1);
  });
});

// ---------------------------------------------------------------------------
// web_fetch — content-type refusal + HTTP errors
// ---------------------------------------------------------------------------

describe('web_fetch — content handling', () => {
  it('refuses a binary content type', async () => {
    const { transport } = stubTransport({ status: 200, headers: { 'content-type': 'image/png' }, body: 'PNGDATA' });
    const tool = webFetchTool({ transport, resolve: publicResolver, env: {} });
    const res = await tool.execute(goal, { url: 'https://example.com/pic.png' });
    expect(res.ok).toBe(false);
    expect(res.output).toContain('binary');
  });

  it('reports an HTTP error status as a refusal', async () => {
    const { transport } = stubTransport({ status: 404, headers: { 'content-type': 'text/html' }, body: 'nope' });
    const tool = webFetchTool({ transport, resolve: publicResolver, env: {} });
    const res = await tool.execute(goal, { url: 'https://example.com/missing' });
    expect(res.ok).toBe(false);
    expect(res.output).toContain('HTTP 404');
  });
});

// ---------------------------------------------------------------------------
// web_search — provider gating
// ---------------------------------------------------------------------------

describe('web_search — provider gating', () => {
  it('is not configured without a WEB_SEARCH_URL template', () => {
    expect(searchProviderConfigured({})).toBe(false);
    expect(searchProviderConfigured({ WEB_SEARCH_URL: 'https://s.example/nolplaceholder' })).toBe(false);
    expect(searchProviderConfigured({ WEB_SEARCH_URL: 'https://s.example/?q={query}' })).toBe(true);
  });

  it('webTools offers fetch-only when no provider is configured', () => {
    const names = webTools({ env: {} }).map((t) => t.def.name);
    expect(names).toEqual(['web_fetch']);
  });

  it('webTools offers web_search when a provider is configured', () => {
    const names = webTools({ env: { WEB_SEARCH_URL: 'https://s.example/?q={query}' } }).map((t) => t.def.name);
    expect(names).toContain('web_fetch');
    expect(names).toContain('web_search');
  });

  it('web_search substitutes the query and fetches the provider JSON', async () => {
    const { transport, urls } = stubTransport(ok('{"results":[{"url":"https://a.test"}]}', 'application/json'));
    const tool = webSearchTool({
      transport,
      resolve: publicResolver,
      env: { WEB_SEARCH_URL: 'https://s.example/?q={query}' },
    });
    const res = await tool.execute(goal, { query: 'pinned version' });
    expect(res.ok).toBe(true);
    expect(urls[0]).toBe('https://s.example/?q=pinned%20version');
    expect(res.output).toContain('a.test');
  });

  it('webSearchTool throws if constructed without a configured provider', () => {
    expect(() => webSearchTool({ env: {} })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Pure-function units
// ---------------------------------------------------------------------------

describe('isBlockedAddress', () => {
  it('blocks loopback, private, link-local, metadata, and IPv6 equivalents', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.0.1', '169.254.169.254', '0.0.0.0', '100.64.0.1']) {
      expect(isBlockedAddress(ip)).toBe(true);
    }
    for (const ip of ['::1', '::', 'fe80::1', 'fc00::1', 'fd12::1', '::ffff:127.0.0.1']) {
      expect(isBlockedAddress(ip)).toBe(true);
    }
  });

  it('allows public addresses', () => {
    expect(isBlockedAddress('93.184.216.34')).toBe(false);
    expect(isBlockedAddress('8.8.8.8')).toBe(false);
    expect(isBlockedAddress('2606:2800:220:1:248:1893:25c8:1946')).toBe(false);
  });

  it('blocks a non-IP string (must be resolved first)', () => {
    expect(isBlockedAddress('example.com')).toBe(true);
  });
});

describe('classifyContentType', () => {
  it('classifies html, text, json/xml, and binary', () => {
    expect(classifyContentType('text/html; charset=utf-8').kind).toBe('html');
    expect(classifyContentType('text/plain').kind).toBe('text');
    expect(classifyContentType('application/json').kind).toBe('text');
    expect(classifyContentType('application/ld+json').kind).toBe('text');
    expect(classifyContentType(null).kind).toBe('text');
    expect(classifyContentType('image/png').kind).toBe('refuse');
    expect(classifyContentType('application/octet-stream').kind).toBe('refuse');
  });
});

describe('extractText', () => {
  it('decodes numeric entities and collapses blank lines', () => {
    const out = extractText('<p>a</p>\n\n\n<p>&#65;&#x42;</p>');
    expect(out).toContain('a');
    expect(out).toContain('AB');
    expect(out).not.toMatch(/\n\n\n/);
  });
});

describe('extraBlockedHosts', () => {
  it('parses a comma list, lowercasing and trimming', () => {
    const set = extraBlockedHosts({ WEB_FETCH_BLOCK_HOSTS: 'A.com, b.TEST ,  ' });
    expect(set.has('a.com')).toBe(true);
    expect(set.has('b.test')).toBe(true);
    expect(set.size).toBe(2);
  });

  it('is empty when unset', () => {
    expect(extraBlockedHosts({}).size).toBe(0);
  });
});
