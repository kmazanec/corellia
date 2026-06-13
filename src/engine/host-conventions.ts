/**
 * Host-convention reader (F-69 — ADR-028 layer 2).
 *
 * Locates the target repo's AGENTS.md / CLAUDE.md, strips outer-harness-
 * operational sections, caps the result at 8 000 characters, and returns the
 * slice as a plain string to be injected into goal context as "data to weigh".
 *
 * Resolution rule (AC-2, ADR-028):
 *   AGENTS.md present → use it exclusively (it is the canonical agent-facing
 *   convention file by name).
 *   CLAUDE.md only    → use it as the fallback.
 *   Neither present   → return ''.
 *   Both present      → AGENTS.md wins; CLAUDE.md is ignored.
 *
 * Trust posture: this function returns a plain string. Nothing in the engine
 * parses the returned text for grants, tools, or operational keywords — host
 * content enters the context under the "evidence to weigh" label and can shape
 * but never command the factory. This is a discipline posture, not a security
 * boundary; the strip patterns below are noise-reduction heuristics only.
 */

import { statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Maximum number of bytes we will even attempt to read from a host file.
 * Files larger than this are skipped before decode so a giant or symlinked
 * file cannot OOM the process. (Separate from the 8 000-char post-strip cap.)
 */
const MAX_FILE_BYTES = 512_000; // 512 KB

/** Maximum characters of stripped text to inject into context. */
const MAX_CONTEXT_CHARS = 8_000;

const TRUNCATION_SUFFIX = '[… truncated — host file exceeds 8 000-char budget]';

/**
 * Heading patterns for outer-harness-operational sections to strip before
 * injection. These are noise-reduction heuristics — NOT a security boundary.
 * A host file that uses non-standard headings will pass cruft through; v1
 * accepts this. The regex matches any level of ATX heading (#, ##, ###, …)
 * followed by one of the listed keywords as the full heading text.
 */
const OPERATIONAL_HEADING_RE =
  /^#{1,6}\s+(Commands|Bash|Shell|Hooks|Permissions|Tools|MCP|Settings)\s*$/im;

/**
 * Strip sections whose heading matches the operational-section pattern.
 *
 * Algorithm: split into lines, find headings that match, determine their
 * "depth" (number of leading #), then skip all subsequent lines until a
 * heading of the same depth or shallower is found (or EOF). Non-matching
 * sections are emitted as-is.
 */
function stripOperationalSections(text: string): string {
  const lines = text.split('\n');
  const out: string[] = [];
  let skipUntilDepth: number | null = null;

  for (const line of lines) {
    // Detect ATX heading
    const headingMatch = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (headingMatch) {
      const depth = headingMatch[1]!.length;

      // If we are skipping, a heading at the same or shallower depth ends the skip
      if (skipUntilDepth !== null && depth <= skipUntilDepth) {
        skipUntilDepth = null;
      }

      // Check if THIS heading triggers a skip (after potentially ending a prior one)
      if (skipUntilDepth === null) {
        const keywordMatch = /^(Commands|Bash|Shell|Hooks|Permissions|Tools|MCP|Settings)$/i.exec(
          headingMatch[2]!.trim(),
        );
        if (keywordMatch) {
          skipUntilDepth = depth;
          continue; // drop this heading line
        }
        out.push(line);
      }
      // else: still skipping — drop the line
    } else {
      if (skipUntilDepth === null) {
        out.push(line);
      }
      // else: still skipping — drop the line
    }
  }

  return out.join('\n');
}

/**
 * Apply the 8 000-char context cap. If the text exceeds the cap, truncate at
 * the last newline before the 8 000th character and append the truncation
 * suffix.
 */
function applyContextCap(text: string): string {
  if (text.length <= MAX_CONTEXT_CHARS) return text;

  // Find the last newline before the cap position
  const slice = text.slice(0, MAX_CONTEXT_CHARS);
  const lastNl = slice.lastIndexOf('\n');
  const cutPoint = lastNl > 0 ? lastNl : MAX_CONTEXT_CHARS;
  return text.slice(0, cutPoint) + '\n' + TRUNCATION_SUFFIX;
}

/**
 * Attempt to read a candidate file path. Returns the stripped + capped text
 * on success, or null on any failure (file absent, unreadable, binary, or
 * exceeds the hard byte cap).
 *
 * LENIENT: all failures resolve to null; none throw into the caller.
 */
function tryReadFile(filePath: string): string | null {
  try {
    // Size check before decode: skip files that exceed the hard read cap.
    // statSync follows symlinks (resolves their target size), which is what we
    // want — symlinked convention files are valid, but their resolved size still
    // counts against the cap.
    let size: number;
    try {
      const st = statSync(filePath);
      size = st.size;
    } catch {
      // File does not exist or is inaccessible
      return null;
    }

    if (size > MAX_FILE_BYTES) return null;

    let raw: string;
    try {
      raw = readFileSync(filePath, 'utf8');
    } catch {
      // EACCES, EISDIR, or other read failure
      return null;
    }

    // Binary check: NUL bytes indicate a non-text file — treat as absent.
    if (raw.includes('\0')) return null;

    const stripped = stripOperationalSections(raw);
    return applyContextCap(stripped);
  } catch {
    // Belt-and-suspenders: any unexpected error resolves to null.
    return null;
  }
}

/**
 * Load the target repo's host conventions from its AGENTS.md or CLAUDE.md.
 *
 * Returns the stripped, capped convention text on success, or '' when no
 * usable file is found or any error occurs. Never throws into the harness.
 *
 * Resolution order: AGENTS.md > CLAUDE.md (AGENTS.md is authoritative when
 * both are present).
 */
export function loadHostConventions(repoRoot: string): string {
  try {
    // Try AGENTS.md first — authoritative when present.
    const agentsPath = join(repoRoot, 'AGENTS.md');
    const agentsText = tryReadFile(agentsPath);
    if (agentsText !== null) return agentsText;

    // Fall back to CLAUDE.md.
    const claudePath = join(repoRoot, 'CLAUDE.md');
    const claudeText = tryReadFile(claudePath);
    if (claudeText !== null) return claudeText;

    return '';
  } catch {
    // Catch-all: any error (including join() failures) → empty string.
    return '';
  }
}
