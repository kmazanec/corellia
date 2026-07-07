/**
 * Content handling for the research-family web tools (issue: web-fetch-tool):
 * deciding how to treat a response by its Content-Type, and stripping HTML to
 * readable prose. web_fetch returns readable text only — HTML is extracted, text
 * and JSON/XML pass through, and binaries are refused (binary assets are
 * external-asset-acquisition's job). This is a deliberately small, dependency-free
 * extractor: enough to give the model prose to cite, not a full DOM renderer.
 */

export type ContentDecision =
  | { kind: 'html' }
  | { kind: 'text' }
  | { kind: 'refuse'; reason: string };

/**
 * Decide how to handle a response by its Content-Type: extract text from HTML,
 * pass text/JSON/XML through, and refuse binaries. A missing Content-Type is
 * treated as text — the size cap still bounds it.
 */
export function classifyContentType(contentType: string | null): ContentDecision {
  if (contentType === null || contentType.trim().length === 0) return { kind: 'text' };
  const type = contentType.split(';')[0]?.trim().toLowerCase() ?? '';
  if (type === 'text/html' || type === 'application/xhtml+xml') return { kind: 'html' };
  if (type.startsWith('text/')) return { kind: 'text' };
  if (
    type === 'application/json' ||
    type === 'application/xml' ||
    type.endsWith('+json') ||
    type.endsWith('+xml')
  ) {
    return { kind: 'text' };
  }
  return {
    kind: 'refuse',
    reason:
      `web_fetch: refusing binary/unsupported content type "${type}" — web_fetch returns readable text only; ` +
      `binary assets are out of scope for this tool.`,
  };
}

/**
 * Strip HTML to readable text: drop script/style/head-noise, convert block-level
 * tags to newlines, remove all remaining tags, decode the common entities, and
 * collapse runs of blank lines.
 */
export function extractText(html: string): string {
  let s = html;
  // Remove whole non-content elements including their content.
  s = s.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ');
  s = s.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ');
  s = s.replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ');
  s = s.replace(/<!--[\s\S]*?-->/g, ' ');
  // Block-level boundaries become newlines so text does not run together.
  s = s.replace(/<\/(p|div|section|article|header|footer|li|ul|ol|tr|table|h[1-6]|blockquote)\s*>/gi, '\n');
  s = s.replace(/<(br|hr)\s*\/?>/gi, '\n');
  // Drop every remaining tag.
  s = s.replace(/<[^>]+>/g, ' ');
  // Decode the handful of entities that matter for readable prose.
  s = decodeEntities(s);
  // Collapse whitespace: trim each line, drop runs of blank lines.
  const lines = s.split('\n').map((line) => line.replace(/[ \t\f\v]+/g, ' ').trim());
  const out: string[] = [];
  let blank = false;
  for (const line of lines) {
    if (line.length === 0) {
      if (!blank) out.push('');
      blank = true;
    } else {
      out.push(line);
      blank = false;
    }
  }
  return out.join('\n').trim();
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code: string) => safeFromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => safeFromCodePoint(parseInt(code, 16)));
}

function safeFromCodePoint(code: number): string {
  if (!Number.isInteger(code) || code < 0 || code > 0x10ffff) return '';
  try {
    return String.fromCodePoint(code);
  } catch {
    return '';
  }
}
