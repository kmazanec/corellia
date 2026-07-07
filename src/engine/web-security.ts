/**
 * SSRF hygiene for the research-family web tools (issue: web-fetch-tool): the
 * private-network denylist, the injectable host resolver, the operator block-list,
 * and https-only URL vetting. This mirrors run_command's "no network to the
 * inside" floor — a research fetch must never become a pivot into loopback, an
 * RFC-1918 range, the link-local cloud-metadata endpoint, or another non-public
 * address, and must never leave https.
 */

import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/**
 * Resolve a hostname to its addresses. Injectable so tests exercise the denylist
 * without a live DNS server. The real implementation returns every A/AAAA address
 * so a multi-homed host cannot smuggle one public and one private record past the
 * check.
 */
export type HostResolver = (hostname: string) => Promise<string[]>;

/** The real resolver: every A/AAAA record for the host. */
export const realHostResolver: HostResolver = async (hostname) => {
  const records = await lookup(hostname, { all: true });
  return records.map((r) => r.address);
};

/**
 * Whether an IP literal names a non-public address the factory must never reach:
 * loopback, RFC-1918 private ranges, link-local (incl. the 169.254.169.254
 * cloud-metadata endpoint), unspecified, CGNAT, and the IPv6 equivalents (ULA,
 * v4-mapped). Refusing these is the SSRF floor — a research fetch must not become
 * a pivot into the private network or the instance-metadata service.
 */
export function isBlockedAddress(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) return isBlockedV4(ip);
  if (kind === 6) return isBlockedV6(ip);
  // Not an IP literal — caller resolves the host first; a non-literal here is unsafe.
  return true;
}

function isBlockedV4(ip: string): boolean {
  const parts = ip.split('.').map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true;
  }
  const [a, b] = parts as [number, number, number, number];
  if (a === 0) return true; // 0.0.0.0/8 "this network"
  if (a === 10) return true; // 10.0.0.0/8 private
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local + metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 private
  if (a === 192 && b === 168) return true; // 192.168.0.0/16 private
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  if (a >= 224) return true; // 224+ multicast / reserved
  return false;
}

function isBlockedV6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === '::1' || lower === '::') return true; // loopback / unspecified
  if (lower.startsWith('fe80')) return true; // link-local
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // unique-local (fc00::/7)
  if (lower.startsWith('ff')) return true; // multicast
  // IPv4-mapped (::ffff:a.b.c.d) — validate the embedded v4.
  const mapped = lower.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped && mapped[1]) return isBlockedV4(mapped[1]);
  return false;
}

/**
 * Extra hostnames an operator wants refused beyond the IP denylist, from
 * WEB_FETCH_BLOCK_HOSTS (comma-separated, matched case-insensitively against the
 * URL host). The IP denylist is the non-negotiable floor; this only ever ADDS
 * refusals, so an operator cannot open a hole in the private-network block.
 */
export function extraBlockedHosts(source: NodeJS.ProcessEnv = process.env): Set<string> {
  const raw = source['WEB_FETCH_BLOCK_HOSTS'];
  if (typeof raw !== 'string' || raw.trim().length === 0) return new Set();
  return new Set(raw.split(',').map((h) => h.trim().toLowerCase()).filter((h) => h.length > 0));
}

export type UrlCheck = { ok: true; url: URL } | { ok: false; reason: string };

/** Parse and vet a caller-supplied URL: https-only, well-formed, not an IP-literal blocked host. */
export function vetUrl(raw: string, extraHosts: Set<string>): UrlCheck {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: `web_fetch: "${raw}" is not a valid URL` };
  }
  if (url.protocol !== 'https:') {
    return { ok: false, reason: `web_fetch: only https:// URLs are allowed (got ${url.protocol}//)` };
  }
  const host = url.hostname.toLowerCase();
  if (extraHosts.has(host)) {
    return { ok: false, reason: `web_fetch: host "${host}" is on the operator block list` };
  }
  // If the host is an IP literal, vet it now (no DNS needed).
  if (isIP(host) !== 0 && isBlockedAddress(host)) {
    return { ok: false, reason: `web_fetch: address "${host}" is a private/loopback/metadata endpoint` };
  }
  // URL.hostname strips brackets from an IPv6 literal, but guard the bracketed form too.
  const unbracketed = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
  if (isIP(unbracketed) !== 0 && isBlockedAddress(unbracketed)) {
    return { ok: false, reason: `web_fetch: address "${unbracketed}" is a private/loopback/metadata endpoint` };
  }
  return { ok: true, url };
}

/**
 * Resolve a non-literal host and return a refusal reason if ANY resolved address
 * is blocked, else null. An IP literal is vetted by {@link vetUrl}; here we only
 * re-confirm it. This closes the DNS-rebind hole: the host that resolved public
 * at vet time is re-resolved and every record checked before the request.
 */
export async function vetResolvedHost(hostname: string, resolve: HostResolver): Promise<string | null> {
  if (isIP(hostname) !== 0) {
    return isBlockedAddress(hostname) ? `address "${hostname}" is private/loopback/metadata` : null;
  }
  let addresses: string[];
  try {
    addresses = await resolve(hostname);
  } catch (err) {
    return `could not resolve host "${hostname}" (${err instanceof Error ? err.message : String(err)})`;
  }
  if (addresses.length === 0) {
    return `host "${hostname}" resolved to no addresses`;
  }
  for (const addr of addresses) {
    if (isBlockedAddress(addr)) {
      return `host "${hostname}" resolves to a private/loopback/metadata address (${addr})`;
    }
  }
  return null;
}
