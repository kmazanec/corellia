/**
 * `web_fetch` and `web_search` — the research-family web tools (issue:
 * web-fetch-tool). Both are broker-mediated ToolImpls granted only to the
 * research/diagnose family (`web.fetch` / `web.search`), so a build-family goal
 * that names them is refused by the broker before any request is made.
 *
 * `web_fetch(url)` performs an https-only GET, capped in size, time, and redirect
 * count, extracts readable text from HTML (passing text/JSON through and refusing
 * binaries — binary assets are external-asset-acquisition's job), and returns a
 * result carrying the fetched URL + retrieved-at timestamp so a finding can cite
 * its sources. `web_search(query)` is behind a pluggable, env-configured provider
 * (a generic SEARCH_URL template returning JSON); with no provider configured the
 * tool is not offered, so a research goal degrades to fetch-only rather than
 * erroring.
 *
 * The SSRF denylist and URL vetting live in {@link ./web-security.js}; content
 * classification and HTML→text extraction live in {@link ./web-extract.js}. This
 * module owns the injectable transport, the caps, the redirect-following fetch
 * orchestration, and the two ToolImpl factories. The request runs in the engine
 * process (never a spawned child), and the transport is injectable so tests never
 * touch the live network.
 */

import type { Goal } from '../contract/goal.js';
import type { ToolImpl } from '../contract/tool.js';
import {
  realHostResolver,
  extraBlockedHosts,
  vetUrl,
  vetResolvedHost,
  type HostResolver,
} from './web-security.js';
import { classifyContentType, extractText } from './web-extract.js';

// ---------------------------------------------------------------------------
// Caps and injectable transport
// ---------------------------------------------------------------------------

/** Maximum decoded body size retained; a larger body is truncated with a notice. */
export const WEB_FETCH_MAX_BYTES = 2 * 1024 * 1024;
/** Wall-clock ceiling for a single fetch (connect + download), enforced via AbortController. */
export const WEB_FETCH_TIME_LIMIT_MS = 20_000;
/** Maximum redirects followed manually before the fetch is refused. */
export const WEB_FETCH_MAX_REDIRECTS = 5;

/** The minimal response surface the web tools read from a fetch transport. */
export interface WebFetchResponse {
  status: number;
  /** Case-insensitive header access, matching the platform `Headers` shape. */
  headers: { get(name: string): string | null };
  /** The response body as text. */
  text(): Promise<string>;
}

/** The init surface the web tools pass to a transport. */
export interface WebFetchInit {
  redirect: 'manual';
  signal: AbortSignal;
  headers: Record<string, string>;
}

/**
 * Injectable fetch transport. The real transport wraps global `fetch` with
 * redirect following disabled (redirects are resolved manually so each hop's
 * host can be re-validated); tests supply a stub that never touches the network.
 */
export type WebFetchTransport = (url: string, init: WebFetchInit) => Promise<WebFetchResponse>;

/** The real (global `fetch`) transport. Redirects are handled by the caller. */
export const realWebFetchTransport: WebFetchTransport = (url, init) =>
  fetch(url, init) as unknown as Promise<WebFetchResponse>;

// Re-exported so callers (and tests) that import from web-tools keep one entry point.
export {
  realHostResolver,
  isBlockedAddress,
  extraBlockedHosts,
  type HostResolver,
} from './web-security.js';
export { classifyContentType, extractText } from './web-extract.js';

/** Cap a body to WEB_FETCH_MAX_BYTES (by UTF-16 length proxy), flagging truncation. */
function capBody(text: string): { text: string; truncated: boolean } {
  if (text.length <= WEB_FETCH_MAX_BYTES) return { text, truncated: false };
  return { text: text.slice(0, WEB_FETCH_MAX_BYTES), truncated: true };
}

// ---------------------------------------------------------------------------
// web_fetch
// ---------------------------------------------------------------------------

/** Dependencies injected into the web tools — real values in assembly, stubs in tests. */
export interface WebFetchDeps {
  transport?: WebFetchTransport;
  resolve?: HostResolver;
  env?: NodeJS.ProcessEnv;
}

/**
 * The structured result of one successful fetch, surfaced to the model as text
 * with a citation header so findings carry the fetched URL + retrieved-at.
 */
export interface WebFetchResult {
  url: string;
  finalUrl: string;
  retrievedAt: string;
  contentType: string;
  text: string;
  truncated: boolean;
}

/** Render a WebFetchResult as the model-facing tool output (citation header + text). */
export function renderFetchResult(r: WebFetchResult): string {
  const header =
    `[web_fetch] url=${r.url} finalUrl=${r.finalUrl} retrievedAt=${r.retrievedAt} ` +
    `contentType=${r.contentType}${r.truncated ? ' truncated=true' : ''}\n` +
    `CITE THIS SOURCE: any claim drawn from the text below must carry this finalUrl and retrievedAt.\n` +
    `---`;
  return `${header}\n${r.text}`;
}

/**
 * Build the `web_fetch` ToolImpl. The broker enforces the `web.fetch` grant before
 * dispatch; this impl performs the vetted request. Redirects are followed manually
 * (up to {@link WEB_FETCH_MAX_REDIRECTS}) so each hop's host is re-validated — a
 * public URL cannot 302 into the private network.
 */
export function webFetchTool(deps: WebFetchDeps = {}): ToolImpl {
  const transport = deps.transport ?? realWebFetchTransport;
  const resolve = deps.resolve ?? realHostResolver;
  const env = deps.env ?? process.env;

  return {
    def: {
      name: 'web_fetch',
      description:
        'Fetch a single https:// web page or API response and return its readable text. Use this to ' +
        'read current external documentation, a library\'s changelog, or an API\'s shape when your task ' +
        'needs facts that are not in the repo. GET only; https only; the body is size- and time-capped ' +
        'and HTML is stripped to readable text (binary/asset URLs are refused). CITATION DISCIPLINE: the ' +
        'result carries the final URL and a retrievedAt timestamp — every claim in your finding that comes ' +
        'from a fetched page MUST carry that URL and timestamp as its source. Private, loopback, and cloud ' +
        'metadata addresses are refused.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'The absolute https:// URL to fetch.' },
        },
        required: ['url'],
      },
    },

    async execute(_goal: Goal, args: Record<string, unknown>): Promise<{ ok: boolean; output: string }> {
      const rawUrl = args['url'];
      if (typeof rawUrl !== 'string' || rawUrl.trim().length === 0) {
        return { ok: false, output: 'web_fetch: url must be a non-empty string' };
      }
      const result = await performFetch(rawUrl.trim(), { transport, resolve, env });
      if (!result.ok) return { ok: false, output: result.reason };
      return { ok: true, output: renderFetchResult(result.value) };
    },
  };
}

type FetchOutcome =
  | { ok: true; value: WebFetchResult }
  | { ok: false; reason: string };

/** Perform the vetted, redirect-following, capped fetch. Extracted so tests drive it directly. */
export async function performFetch(
  rawUrl: string,
  deps: { transport: WebFetchTransport; resolve: HostResolver; env: NodeJS.ProcessEnv },
): Promise<FetchOutcome> {
  const extraHosts = extraBlockedHosts(deps.env);
  let currentUrl = rawUrl;

  for (let hop = 0; hop <= WEB_FETCH_MAX_REDIRECTS; hop++) {
    const vetted = vetUrl(currentUrl, extraHosts);
    if (!vetted.ok) return { ok: false, reason: vetted.reason };

    const hostBlock = await vetResolvedHost(vetted.url.hostname, deps.resolve);
    if (hostBlock !== null) return { ok: false, reason: `web_fetch: ${hostBlock}` };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), WEB_FETCH_TIME_LIMIT_MS);
    let response: WebFetchResponse;
    try {
      response = await deps.transport(vetted.url.toString(), {
        redirect: 'manual',
        signal: controller.signal,
        headers: { accept: 'text/html,application/xhtml+xml,text/plain,application/json;q=0.9,*/*;q=0.5' },
      });
    } catch (err) {
      clearTimeout(timer);
      const aborted = controller.signal.aborted;
      return {
        ok: false,
        reason: aborted
          ? `web_fetch: request exceeded the ${WEB_FETCH_TIME_LIMIT_MS}ms time limit`
          : `web_fetch: request failed (${errorMessage(err)})`,
      };
    }
    clearTimeout(timer);

    // Manual redirect handling: re-vet the next hop's host on the next loop.
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (location === null || location.trim().length === 0) {
        return { ok: false, reason: `web_fetch: ${response.status} redirect with no Location header` };
      }
      if (hop === WEB_FETCH_MAX_REDIRECTS) {
        return { ok: false, reason: `web_fetch: exceeded ${WEB_FETCH_MAX_REDIRECTS} redirects` };
      }
      currentUrl = resolveRedirect(vetted.url, location);
      continue;
    }

    if (response.status < 200 || response.status >= 300) {
      return { ok: false, reason: `web_fetch: request returned HTTP ${response.status}` };
    }

    const contentType = response.headers.get('content-type');
    const decision = classifyContentType(contentType);
    if (decision.kind === 'refuse') return { ok: false, reason: decision.reason };

    let body: string;
    try {
      body = await response.text();
    } catch (err) {
      return { ok: false, reason: `web_fetch: failed reading body (${errorMessage(err)})` };
    }

    const extracted = decision.kind === 'html' ? extractText(body) : body;
    const capped = capBody(extracted);
    return {
      ok: true,
      value: {
        url: rawUrl,
        finalUrl: vetted.url.toString(),
        retrievedAt: new Date().toISOString(),
        contentType: contentType ?? 'unknown',
        text: capped.text,
        truncated: capped.truncated,
      },
    };
  }
  // Unreachable: the loop returns on the last hop.
  return { ok: false, reason: `web_fetch: exceeded ${WEB_FETCH_MAX_REDIRECTS} redirects` };
}

/** Resolve a redirect Location (absolute or relative) against the current URL. */
function resolveRedirect(base: URL, location: string): string {
  try {
    return new URL(location, base).toString();
  } catch {
    return location;
  }
}

// ---------------------------------------------------------------------------
// web_search (pluggable, env-configured provider — offered only when configured)
// ---------------------------------------------------------------------------

/**
 * Whether a search provider is configured. `web_search` is registered ONLY when
 * this is true, so with no provider a research goal degrades to fetch-only rather
 * than seeing a tool that always errors. The provider is a generic JSON endpoint:
 * WEB_SEARCH_URL is a template containing `{query}`, which is replaced with the
 * URL-encoded query; the response is expected to be JSON.
 */
export function searchProviderConfigured(source: NodeJS.ProcessEnv = process.env): boolean {
  const template = source['WEB_SEARCH_URL'];
  return typeof template === 'string' && template.includes('{query}');
}

/**
 * Build the `web_search` ToolImpl backed by the env-configured provider. Returns
 * the provider's response text so the model can pick URLs to `web_fetch`. The same
 * SSRF vetting as web_fetch applies to the provider URL. Call
 * {@link searchProviderConfigured} before registering — this throws if the
 * template is absent, since an unconfigured tool must never be offered.
 */
export function webSearchTool(deps: WebFetchDeps = {}): ToolImpl {
  const transport = deps.transport ?? realWebFetchTransport;
  const resolve = deps.resolve ?? realHostResolver;
  const env = deps.env ?? process.env;
  const template = env['WEB_SEARCH_URL'];
  if (typeof template !== 'string' || !template.includes('{query}')) {
    throw new Error('webSearchTool: WEB_SEARCH_URL template (containing {query}) is not configured');
  }

  return {
    def: {
      name: 'web_search',
      description:
        'Search the web for a query and return a JSON list of candidate results (titles + URLs) to then ' +
        'read with web_fetch. Use this to DISCOVER which pages to fetch when you do not already have a URL. ' +
        'CITATION DISCIPLINE: web_search only finds candidates — a claim is only cited once you have ' +
        'web_fetch-ed the page and can carry its final URL and retrievedAt. Prefer official/primary sources.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'The search query.' },
        },
        required: ['query'],
      },
    },

    async execute(_goal: Goal, args: Record<string, unknown>): Promise<{ ok: boolean; output: string }> {
      const query = args['query'];
      if (typeof query !== 'string' || query.trim().length === 0) {
        return { ok: false, output: 'web_search: query must be a non-empty string' };
      }
      const searchUrl = template.replace('{query}', encodeURIComponent(query.trim()));
      const result = await performFetch(searchUrl, { transport, resolve, env });
      if (!result.ok) return { ok: false, output: result.reason.replace(/^web_fetch:/, 'web_search:') };
      return {
        ok: true,
        output:
          `[web_search] query=${JSON.stringify(query.trim())} via=${result.value.finalUrl} ` +
          `retrievedAt=${result.value.retrievedAt}\n${result.value.text}`,
      };
    },
  };
}

/**
 * The research-family web tools to register in a broker. Always includes
 * `web_fetch`; includes `web_search` only when a provider is configured, so an
 * unconfigured factory offers fetch-only. Grant enforcement (web.fetch /
 * web.search) is the broker's job via GRANT_TOOL_MAP — registering the impls here
 * does not grant them to any type that lacks the grant.
 */
export function webTools(deps: WebFetchDeps = {}): ToolImpl[] {
  const env = deps.env ?? process.env;
  const tools: ToolImpl[] = [webFetchTool(deps)];
  if (searchProviderConfigured(env)) tools.push(webSearchTool(deps));
  return tools;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
