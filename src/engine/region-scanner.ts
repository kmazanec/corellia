/**
 * The filesystem-backed {@link RegionScanner}: walks a region under a repo root
 * and returns each file's path, size, and a regex-grade list of exported
 * top-level symbol names.
 *
 * This is deliberately cheap — a pointer map for the structural floor, NOT
 * comprehension. It reads sizes and greps for `export` declarations; it never
 * parses, resolves, or interprets. All failures resolve to an empty list; it
 * never throws into the injection path (observability must not break a run).
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';
import type { RegionFileEntry, RegionScanner } from './structural-floor.js';

/** Skip these directory names outright — never part of a region's source map. */
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'out', '.corellia', '.claude', 'coverage']);

/** Files larger than this are listed by size only; a symbol scan would not pay off. */
const MAX_SYMBOL_SCAN_BYTES = 512 * 1024;

/** Hard cap on files walked, so a huge region cannot stall the scan. */
const MAX_WALK_FILES = 2000;

/** At most this many exported symbol names per file — a pointer, not a dump. */
const MAX_SYMBOLS_PER_FILE = 30;

export function fsRegionScanner(): RegionScanner {
  return {
    scanRegion(repoRoot: string, region: string): RegionFileEntry[] {
      const root = isAbsolute(region) ? region : join(repoRoot, region);
      const entries: RegionFileEntry[] = [];
      walk(root, repoRoot, entries);
      entries.sort((a, b) => a.path.localeCompare(b.path));
      return entries;
    },
  };
}

function walk(dir: string, repoRoot: string, out: RegionFileEntry[]): void {
  if (out.length >= MAX_WALK_FILES) return;

  let dirents: import('node:fs').Dirent[];
  try {
    dirents = readdirSync(dir, { withFileTypes: true });
  } catch {
    // A region that is a single file (not a directory), or is unreadable:
    // try it as a lone file, else give up on this path.
    tryFile(dir, repoRoot, out);
    return;
  }

  for (const dirent of dirents) {
    if (out.length >= MAX_WALK_FILES) return;
    if (dirent.name.startsWith('.') && dirent.name !== '.') continue;
    const full = join(dir, dirent.name);
    if (dirent.isDirectory()) {
      if (SKIP_DIRS.has(dirent.name)) continue;
      walk(full, repoRoot, out);
    } else if (dirent.isFile()) {
      tryFile(full, repoRoot, out);
    }
  }
}

function tryFile(full: string, repoRoot: string, out: RegionFileEntry[]): void {
  let bytes: number;
  try {
    const st = statSync(full);
    if (!st.isFile()) return;
    bytes = st.size;
  } catch {
    return;
  }

  let text = '';
  if (bytes <= MAX_SYMBOL_SCAN_BYTES) {
    try {
      text = readFileSync(full, 'utf8');
    } catch {
      text = '';
    }
  }
  if (text.includes('\0')) text = ''; // Binary — size only, no symbol scan.

  const lines = text.length > 0 ? countLines(text) : 0;
  out.push({
    path: toRepoRelative(full, repoRoot),
    lines,
    bytes,
    symbols: text.length > 0 ? exportedSymbols(text) : [],
  });
}

function countLines(text: string): number {
  let count = 1;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) count++;
  }
  // A trailing newline should not inflate the count by one empty line.
  return text.endsWith('\n') ? count - 1 : count;
}

function toRepoRelative(full: string, repoRoot: string): string {
  const rel = relative(repoRoot, full);
  return rel.split(sep).join('/');
}

/**
 * Regex-grade scan for exported top-level symbol names across common languages
 * (TS/JS `export`, Python `def`/`class`, Go/Rust `func`/`pub fn`). This is a
 * name index, not a parse: it accepts false positives cheaply and never throws.
 */
const EXPORT_PATTERNS: readonly RegExp[] = [
  /^export\s+(?:default\s+)?(?:async\s+)?(?:function|class|const|let|var|interface|type|enum)\s+([A-Za-z_$][\w$]*)/gm,
  /^export\s+\{([^}]*)\}/gm,
  /^(?:async\s+)?def\s+([A-Za-z_][\w]*)/gm,
  /^class\s+([A-Za-z_][\w]*)/gm,
  /^(?:pub\s+)?(?:async\s+)?fn\s+([A-Za-z_][\w]*)/gm,
  /^func\s+(?:\([^)]*\)\s*)?([A-Za-z_][\w]*)/gm,
];

function exportedSymbols(text: string): string[] {
  const names = new Set<string>();
  for (const pattern of EXPORT_PATTERNS) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const captured = match[1];
      if (captured === undefined) continue;
      for (const raw of captured.split(',')) {
        const name = raw.trim().split(/\s+as\s+/)[0]?.trim();
        if (name && /^[A-Za-z_$][\w$]*$/.test(name)) {
          names.add(name);
          if (names.size >= MAX_SYMBOLS_PER_FILE) return [...names];
        }
      }
    }
  }
  return [...names];
}
