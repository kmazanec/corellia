/**
 * Import-edge scanner and impact() for repo-relative dependency graphs.
 *
 * Heuristic text-pattern approach (ADR-020): deterministic, verifiable-on-read,
 * over-inclusive (false-positives in comments/strings accepted; plain static
 * imports must never false-negative). Zero external dependencies — node:fs and
 * node:path only.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, relative, extname, dirname, resolve as resolvePath } from 'node:path';

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * A directed edge from one repo-relative file to another it imports.
 * Both `from` and `to` are repo-relative POSIX paths (forward slashes, no
 * leading slash).
 */
export interface ImportEdge {
  from: string;
  to: string;
}

/**
 * The result of a full repo scan: the set of resolved import edges and the
 * git SHA the scan was performed against (for verify-on-read freshness checks).
 */
export interface ImportGraph {
  edges: ImportEdge[];
  scannedAtSha: string;
}

/**
 * The result of an impact query: the files directly or transitively importing
 * any of the queried files, plus the test files associated with those files.
 */
export interface ImpactResult {
  files: string[];
  testFiles: string[];
}

/**
 * Options for scanImports. All fields optional.
 */
export interface ScanOptions {
  /** Override the scannedAtSha value (for reproducible tests or non-git contexts). */
  sha?: string;
  /** Max file size in bytes to scan; files above this are skipped. Default: 512 KiB. */
  maxFileBytes?: number;
}

// ── Per-language import pattern table (auditable) ─────────────────────────────

/**
 * Named regex table for import/require extraction per language family.
 * Each entry produces one capture group: the raw specifier string.
 *
 * Design constraints (ADR-020):
 *   - ES/TS: must catch all static import forms; dynamic imports; require().
 *   - Python/Go/Ruby: generic best-effort patterns, conservative-over-inclusive.
 *   - False positives (comments, strings) are accepted; false negatives are not.
 */
const IMPORT_PATTERNS: Record<string, RegExp[]> = {
  // ES modules + TypeScript: import … from '…'; export … from '…'
  esm_static: [
    /\bimport\s+(?:type\s+)?(?:[^'"]+\s+from\s+)?['"]([^'"]+)['"]/g,
    /\bexport\s+(?:type\s+)?(?:[^'"]*\s+)?from\s+['"]([^'"]+)['"]/g,
  ],
  // CommonJS require('…') and require("…")
  commonjs: [
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ],
  // Dynamic import('…')
  dynamic_import: [
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ],
  // Python: import x.y, from x.y import z (relative: from . import, from ..x import)
  python: [
    /^\s*import\s+([\w.]+)/gm,
    /^\s*from\s+(\.{0,3}[\w./]*)\s+import\b/gm,
  ],
  // Go: import "path/to/pkg" or import ( "path/to/pkg" )
  go: [
    /"(\.\.?\/[^"]+)"/g,
  ],
  // Ruby: require_relative '…', require '…' (relative paths only)
  ruby: [
    /\brequire_relative\s+['"]([^'"]+)['"]/g,
    /\brequire\s+['"](\.[^'"]+)['"]/g,
  ],
};

// ── File classification helpers ───────────────────────────────────────────────

const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.svg', '.webp',
  '.pdf', '.zip', '.tar', '.gz', '.bz2', '.7z', '.rar',
  '.mp3', '.mp4', '.wav', '.ogg', '.avi', '.mov', '.webm',
  '.woff', '.woff2', '.ttf', '.eot', '.otf',
  '.pyc', '.class', '.o', '.so', '.dll', '.exe', '.bin',
  '.lock', // package-lock.json is text but no imports
]);

const TEXT_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.go', '.rb',
  '.json', '.jsonc', '.yaml', '.yml', '.toml',
  '.html', '.css', '.scss', '.sass', '.less',
  '.sh', '.bash', '.zsh',
  '.md', '.txt', '.env',
  '.graphql', '.gql',
  '.sql',
]);

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.cache', '.next', '.nuxt']);

const DEFAULT_MAX_FILE_BYTES = 512 * 1024; // 512 KiB

/** Returns true if the file should be scanned for imports. */
function shouldScan(absPath: string, maxBytes: number): boolean {
  const ext = extname(absPath).toLowerCase();
  if (BINARY_EXTENSIONS.has(ext)) return false;
  try {
    const st = statSync(absPath);
    if (!st.isFile()) return false;
    if (st.size > maxBytes) return false;
  } catch {
    return false;
  }
  return true;
}

/** Determine which pattern groups to apply based on file extension. */
function patternsForFile(ext: string): RegExp[] {
  const e = ext.toLowerCase();
  if (['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'].includes(e)) {
    return [
      ...IMPORT_PATTERNS['esm_static']!,
      ...IMPORT_PATTERNS['commonjs']!,
      ...IMPORT_PATTERNS['dynamic_import']!,
    ];
  }
  if (e === '.py') return IMPORT_PATTERNS['python']!;
  if (e === '.go') return IMPORT_PATTERNS['go']!;
  if (e === '.rb') return IMPORT_PATTERNS['ruby']!;
  // For other text files: try commonjs + esm patterns as generic fallback
  return [
    ...IMPORT_PATTERNS['esm_static']!,
    ...IMPORT_PATTERNS['commonjs']!,
  ];
}

// ── Extension inference for path resolution ───────────────────────────────────

/**
 * Ordered list of extensions to try when a specifier has no extension or
 * its stated extension does not resolve to an existing file.
 */
const INFER_EXTENSIONS = [
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.go', '.rb',
];

/**
 * Index-file suffixes to try when a candidate path is a directory.
 */
const INDEX_SUFFIXES = [
  '/index.ts', '/index.tsx', '/index.js', '/index.jsx', '/index.mjs',
];

/**
 * Extensions that are commonly used as import specifiers in TypeScript projects
 * but may map to a different source extension on disk (e.g. ./a.js → a.ts).
 */
const STRIPPABLE_EXTENSIONS = new Set(['.js', '.jsx', '.mjs', '.cjs']);

/**
 * Resolve a raw specifier from a source file to a repo-relative path, or
 * null if the specifier is a bare module (not relative or absolute).
 *
 * Resolution strategy:
 *   1. Only relative specifiers (starting with . or /) are resolved.
 *   2. Exact match (the specifier already has an extension that exists).
 *   3. Extension inference (append .ts, .tsx, … in order).
 *   4. Index file inference (append /index.ts, /index.tsx, …).
 */
function resolveSpecifier(
  specifier: string,
  fromFileAbs: string,
  repoRoot: string,
): string | null {
  // Only resolve relative-ish imports
  if (!specifier.startsWith('.') && !specifier.startsWith('/')) {
    return null;
  }

  const fromDir = dirname(fromFileAbs);
  const candidate = specifier.startsWith('/')
    ? join(repoRoot, specifier)
    : resolvePath(fromDir, specifier);

  // Helper: try to find a file at `base` path using extension inference
  function tryWithInference(base: string): string | null {
    // 1. Exact match
    try {
      const st = statSync(base);
      if (st.isFile()) return toRepoRelative(base, repoRoot);
      if (st.isDirectory()) {
        for (const suffix of INDEX_SUFFIXES) {
          const full = base + suffix;
          try {
            if (statSync(full).isFile()) return toRepoRelative(full, repoRoot);
          } catch { /* not found */ }
        }
        return null;
      }
    } catch { /* not found — continue */ }

    // 2. Extension inference (append .ts, .tsx, etc.)
    for (const ext of INFER_EXTENSIONS) {
      const full = base + ext;
      try {
        if (statSync(full).isFile()) return toRepoRelative(full, repoRoot);
      } catch { /* not found */ }
    }

    // 3. Index-file inference (for bare dir-like paths without trailing slash)
    for (const suffix of INDEX_SUFFIXES) {
      const full = base + suffix;
      try {
        if (statSync(full).isFile()) return toRepoRelative(full, repoRoot);
      } catch { /* not found */ }
    }

    return null;
  }

  // First try the candidate as-is
  const direct = tryWithInference(candidate);
  if (direct !== null) return direct;

  // TypeScript projects write `./a.js` in specifiers but the file is `a.ts`.
  // Strip a "virtual" extension and retry with source-file extensions.
  const specExt = extname(candidate);
  if (STRIPPABLE_EXTENSIONS.has(specExt)) {
    const stripped = candidate.slice(0, candidate.length - specExt.length);
    return tryWithInference(stripped);
  }

  return null;
}

/** Convert an absolute path to a forward-slash repo-relative path. */
function toRepoRelative(absPath: string, repoRoot: string): string {
  return relative(repoRoot, absPath).replace(/\\/g, '/');
}

/**
 * Normalize a specifier before path resolution, accounting for language idioms:
 *
 * - Python relative imports: `.utils` → `./utils`, `..pkg` → `../pkg`
 *   (Python uses leading dots for relative level; single dot = current package)
 * - Ruby require_relative: `helper` (bare, no dot) → `./helper`
 *   (require_relative is always relative to the caller)
 * - All others: pass through.
 */
function normalizeSpecifier(specifier: string, fileExt: string): string {
  const ext = fileExt.toLowerCase();

  if (ext === '.py') {
    // Python: one or more leading dots = relative import
    // .utils → ./utils, ..pkg → ../pkg, ...sub → ../../sub
    const dotMatch = /^(\.+)(.*)$/.exec(specifier);
    if (dotMatch !== null) {
      const dots = dotMatch[1]!;
      const rest = dotMatch[2]!;
      // One dot = current package = ./
      // N dots = N-1 parent dirs above current
      const upCount = dots.length - 1;
      const prefix = upCount === 0 ? './' : '../'.repeat(upCount);
      // Convert dot-separated module path to slash-separated
      const slashRest = rest.replace(/\./g, '/');
      return prefix + slashRest;
    }
  }

  if (ext === '.rb') {
    // Ruby require_relative: bare name (no leading dot) → treat as ./name
    if (!specifier.startsWith('.') && !specifier.startsWith('/')) {
      return './' + specifier;
    }
  }

  return specifier;
}

// ── File tree walker ──────────────────────────────────────────────────────────

/**
 * Recursively collect all scannable files under root, skipping excluded dirs.
 * Returns repo-relative paths, sorted for determinism.
 */
function collectFiles(root: string, maxBytes: number): string[] {
  const results: string[] = [];

  function walk(dir: string): void {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      if (SKIP_DIRS.has(name)) continue;
      const abs = join(dir, name);
      let st;
      try {
        st = statSync(abs);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        walk(abs);
      } else if (st.isFile() && shouldScan(abs, maxBytes)) {
        results.push(toRepoRelative(abs, root));
      }
    }
  }

  walk(root);
  results.sort();
  return results;
}

// ── Git SHA helper ────────────────────────────────────────────────────────────

/**
 * Attempt to read the current git HEAD SHA for the repo at root.
 * Returns null if root is not a git repo or git is unavailable.
 */
function readGitSha(root: string): string | null {
  try {
    const sha = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: root,
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
    })
      .toString()
      .trim();
    return sha.length >= 7 ? sha : null;
  } catch {
    return null;
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Scan all importable files under `root` and extract import edges by heuristic
 * text-pattern matching.
 *
 * - Skips node_modules, .git, binary files, and files above `opts.maxFileBytes`.
 * - Never throws on unreadable or oddly-encoded files.
 * - Returns a deterministically-ordered ImportGraph.
 * - `scannedAtSha` is read from git HEAD when root is a git repo; falls back to
 *   `opts.sha` if provided, or the sentinel `'no-sha'` otherwise.
 */
export function scanImports(root: string, opts: ScanOptions = {}): ImportGraph {
  const maxBytes = opts.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  const files = collectFiles(root, maxBytes);

  const rawEdges: ImportEdge[] = [];

  for (const relPath of files) {
    const absPath = join(root, relPath);
    let content: string;
    try {
      // Read as utf8; latin1 fallback prevents Buffer decoding errors
      content = readFileSync(absPath, 'utf8');
    } catch {
      try {
        content = readFileSync(absPath, 'latin1');
      } catch {
        continue;
      }
    }

    const ext = extname(relPath);
    const patterns = patternsForFile(ext);

    const specifiers = new Set<string>();

    for (const pattern of patterns) {
      // Reset lastIndex since we're reusing regex literals with /g flag
      const re = new RegExp(pattern.source, pattern.flags);
      let match: RegExpExecArray | null;
      while ((match = re.exec(content)) !== null) {
        const spec = match[1];
        if (spec !== undefined && spec.length > 0) {
          specifiers.add(spec);
        }
      }
    }

    for (const spec of specifiers) {
      const normalized = normalizeSpecifier(spec, ext);
      const resolved = resolveSpecifier(normalized, absPath, root);
      if (resolved !== null && resolved !== relPath) {
        rawEdges.push({ from: relPath, to: resolved });
      }
    }
  }

  // Deterministic ordering: sort by (from, to)
  rawEdges.sort((a, b) => {
    const f = a.from.localeCompare(b.from);
    return f !== 0 ? f : a.to.localeCompare(b.to);
  });

  // Deduplicate (same spec might appear in multiple patterns)
  const seen = new Set<string>();
  const edges: ImportEdge[] = [];
  for (const e of rawEdges) {
    const key = `${e.from}\0${e.to}`;
    if (!seen.has(key)) {
      seen.add(key);
      edges.push(e);
    }
  }

  const scannedAtSha = opts.sha ?? readGitSha(root) ?? 'no-sha';

  return { edges, scannedAtSha };
}

// ── Test-file heuristics ──────────────────────────────────────────────────────

/**
 * Returns true if a repo-relative path looks like a test file by naming
 * convention: contains .test. or .spec., or lives under a test directory
 * (tests/, test/, __tests__/, spec/).
 */
function isTestFile(relPath: string): boolean {
  const lower = relPath.toLowerCase();
  if (lower.includes('.test.') || lower.includes('.spec.')) return true;
  const parts = lower.split('/');
  for (const p of parts.slice(0, -1)) {
    if (p === 'tests' || p === 'test' || p === '__tests__' || p === 'spec') return true;
  }
  return false;
}

// ── impact() ─────────────────────────────────────────────────────────────────

/**
 * Given an ImportGraph and a set of changed files, return the transitive
 * reverse-reachability closure (all files that directly or transitively import
 * any of the changed files) plus associated test files.
 *
 * - Cycle-safe: visited set prevents infinite loops.
 * - Test files are identified by: naming convention (f.test.ts, f.spec.ts) OR
 *   being a test-directory file that transitively imports one of the impacted files.
 * - `files` includes the queried files themselves if they appear in the graph;
 *   unknown files (not in the graph as either `from` or `to`) return empty results.
 * - Output is deterministically sorted.
 */
export function impact(graph: ImportGraph, files: string[]): ImpactResult {
  if (files.length === 0) {
    return { files: [], testFiles: [] };
  }

  // Build reverse adjacency: to → set of froms (who imports this file)
  const reverseAdj = new Map<string, Set<string>>();
  for (const edge of graph.edges) {
    let set = reverseAdj.get(edge.to);
    if (set === undefined) {
      set = new Set();
      reverseAdj.set(edge.to, set);
    }
    set.add(edge.from);
  }

  // Collect all files known to the graph
  const allKnown = new Set<string>();
  for (const edge of graph.edges) {
    allKnown.add(edge.from);
    allKnown.add(edge.to);
  }

  // Filter queried files to only those known in the graph
  const seeds = files.filter(f => allKnown.has(f));
  if (seeds.length === 0) {
    return { files: [], testFiles: [] };
  }

  // BFS/DFS reverse reachability (cycle-safe via visited set)
  const visited = new Set<string>(seeds);
  const queue: string[] = [...seeds];

  while (queue.length > 0) {
    const current = queue.pop()!;
    const importers = reverseAdj.get(current);
    if (importers === undefined) continue;
    for (const importer of importers) {
      if (!visited.has(importer)) {
        visited.add(importer);
        queue.push(importer);
      }
    }
  }

  // Partition into test files and non-test files
  const nonTestFiles: string[] = [];
  const testFiles: string[] = [];

  for (const f of visited) {
    if (isTestFile(f)) {
      testFiles.push(f);
    } else {
      nonTestFiles.push(f);
    }
  }

  nonTestFiles.sort();
  testFiles.sort();

  return { files: nonTestFiles, testFiles };
}
