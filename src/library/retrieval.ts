/**
 * The typed retrieval API: five read-only functions that give leaves structured
 * access to repo knowledge without re-reading the repo raw per goal.
 *
 * Each function returns `{ text, data }` — `text` is the transcript-friendly
 * rendering a brain can read directly; `data` is the structured form for
 * programmatic consumption.
 *
 * `retrievalTools(deps)` wraps the five functions as injectable ToolImpl objects
 * for registration in the broker's dispatch table.
 *
 * Design notes (consume frozen surfaces, stub siblings):
 * - F-42 (scanImports / impact graph) is consumed via `deps.scan` — injected
 *   at assembly, stubbed in tests with synthetic graphs.
 * - F-41 (projectKnowledge) is consumed via `deps.knowledge` — injected at
 *   assembly, stubbed in tests with synthetic artifacts.
 * - Real wiring is the assembly feature's job.
 */

import { readFile, stat } from 'node:fs/promises';
import { join, posix, relative } from 'node:path';
import type { KnowledgeArtifact } from '../contract/knowledge.js';
import type { Goal } from '../contract/goal.js';

// ---------------------------------------------------------------------------
// Structural types for the import graph (F-42 frozen surface)
// ---------------------------------------------------------------------------

/**
 * The import graph produced by F-42's scanner. `edges` maps each file
 * (repo-relative path) to the set of files it imports.
 */
export interface ImportGraph {
  /** Each key imports the files in its value set. */
  edges: Record<string, string[]>;
  /** The repo SHA the scan was run against. */
  scannedAtSha: string;
}

/**
 * The result of `impact(files)` — which files are impacted and which tests
 * will exercise them.
 */
export interface ImpactResult {
  /** Files in the repo that transitively import any of the input files. */
  impacted: string[];
  /** Files that look like test files among the impacted set. */
  testFiles: string[];
}

// ---------------------------------------------------------------------------
// Deps shape — injected at assembly, stubbed in tests
// ---------------------------------------------------------------------------

/**
 * The injectable dependencies for the retrieval API. None are required at
 * construction — absent deps cause graceful degradation, never throws.
 *
 * Assembly wires:
 *   - `repoRoot`: the absolute path to the target repo
 *   - `scan`: F-42's `scanImports(root)` — produces an ImportGraph
 *   - `knowledge`: F-41's `projectKnowledge()` — produces the artifact list
 */
export interface RetrievalDeps {
  /** Absolute path to the target repo. Required for symbol/stack search. */
  repoRoot: string;
  /**
   * F-42: scan the repo and produce an import graph. Injected at assembly;
   * tests supply a synthetic function returning a fixture graph.
   */
  scan?: (root: string) => Promise<ImportGraph> | ImportGraph;
  /**
   * F-41: return the current knowledge artifacts for the repo. Injected at
   * assembly; tests supply a synthetic function returning fixture artifacts.
   */
  knowledge?: () => Promise<KnowledgeArtifact[]> | KnowledgeArtifact[];
}

// ---------------------------------------------------------------------------
// Return types for transcript + structured form
// ---------------------------------------------------------------------------

export interface FindSymbolResult {
  text: string;
  data: Array<{ path: string; line: number; snippet: string }>;
}

export interface FindExemplarResult {
  text: string;
  data: Array<{ path: string; line?: number; note: string; source: 'artifact' | 'content-search' }>;
}

export interface ConventionsForResult {
  text: string;
  data: {
    found: boolean;
    fresh: boolean;
    generatedAtSha?: string;
    pointers: Array<{ path: string; line?: number; note: string }>;
    summary?: string;
  };
}

export interface StackVersionsResult {
  text: string;
  data: {
    source: 'package.json' | 'lockfile-v1' | 'manifest-list';
    versions: Record<string, string>;
    manifestFiles?: string[];
  };
}

export interface ImpactQueryResult {
  text: string;
  data: ImpactResult & { scannedAtSha?: string };
}

// ---------------------------------------------------------------------------
// Bounded count and deterministic ordering
// ---------------------------------------------------------------------------

/** Maximum number of symbol matches returned by find_symbol. */
const FIND_SYMBOL_MAX = 50;

/** Maximum number of exemplar matches returned by find_exemplar. */
const FIND_EXEMPLAR_MAX = 20;

// ---------------------------------------------------------------------------
// Helper: walk directory tree collecting source files
// ---------------------------------------------------------------------------

async function collectFiles(dirPath: string, out: string[], repoRoot: string): Promise<void> {
  let entries;
  try {
    const { readdir } = await import('node:fs/promises');
    entries = await readdir(dirPath, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const fullPath = join(dirPath, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && !entry.name.startsWith('.')) {
        await collectFiles(fullPath, out, repoRoot);
      }
    } else if (entry.isFile()) {
      const relPath = relative(repoRoot, fullPath);
      out.push(relPath);
    }
  }
}

// ---------------------------------------------------------------------------
// Helper: test file detection
// ---------------------------------------------------------------------------

function isTestFile(path: string): boolean {
  return (
    path.includes('.test.') ||
    path.includes('.spec.') ||
    path.includes('__tests__') ||
    /\/tests\//.test(path)
  );
}

// ---------------------------------------------------------------------------
// AC-1: find_symbol — definition-site candidates by name
// ---------------------------------------------------------------------------

/**
 * Search the repo for definition sites of `name`. Returns up to
 * `FIND_SYMBOL_MAX` matches in deterministic (path-then-line) order with
 * `path:line:` prefix, bounded so transcripts stay tractable.
 *
 * Matches lines where `name` appears after a definition keyword:
 * `function`, `class`, `const`, `interface`, `type`, `def`, `func` — the
 * common definition forms across TypeScript/JavaScript and Python/Go.
 */
export async function findSymbol(name: string, deps: RetrievalDeps): Promise<FindSymbolResult> {
  if (!name || !name.trim()) {
    return { text: 'find_symbol: name must be a non-empty string', data: [] };
  }

  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Match definition keyword followed by optional whitespace and the name.
  const defPattern = new RegExp(
    `(?:^|\\s)(?:export\\s+)?(?:export\\s+default\\s+)?(?:async\\s+)?(?:function|class|const|interface|type|def|func)\\s+${escaped}(?:\\s|\\(|<|:)`,
  );

  const files: string[] = [];
  try {
    const rootStat = await stat(deps.repoRoot);
    if (!rootStat.isDirectory()) {
      return { text: `find_symbol: repoRoot "${deps.repoRoot}" is not a directory`, data: [] };
    }
  } catch {
    return { text: `find_symbol: repoRoot "${deps.repoRoot}" not accessible`, data: [] };
  }

  await collectFiles(deps.repoRoot, files, deps.repoRoot);
  files.sort();

  const results: Array<{ path: string; line: number; snippet: string }> = [];

  for (const relPath of files) {
    if (results.length >= FIND_SYMBOL_MAX) break;
    const fullPath = join(deps.repoRoot, relPath);
    let content: string;
    try {
      content = await readFile(fullPath, 'utf-8');
    } catch {
      continue;
    }
    const lines = content.split('\n');
    for (let i = 0; i < lines.length && results.length < FIND_SYMBOL_MAX; i++) {
      const line = lines[i] ?? '';
      if (defPattern.test(line)) {
        results.push({ path: relPath, line: i + 1, snippet: line.trim() });
      }
    }
  }

  if (results.length === 0) {
    return { text: `find_symbol: no definition found for "${name}"`, data: [] };
  }

  const textLines = results.map((r) => `${r.path}:${r.line}: ${r.snippet}`);
  if (results.length === FIND_SYMBOL_MAX) {
    textLines.push(`(results capped at ${FIND_SYMBOL_MAX})`);
  }

  return { text: textLines.join('\n'), data: results };
}

// ---------------------------------------------------------------------------
// AC-2: find_exemplar — conventions-artifact pointer search
// ---------------------------------------------------------------------------

/**
 * Find exemplars matching `pattern` from the conventions knowledge artifact.
 * Returns pointer(s) from the artifact whose path or note matches the pattern.
 * Falls back to a content search across the repo when no artifact is present
 * or no pointers match.
 *
 * When no conventions artifact exists: reports honestly ("no conventions
 * artifact") and falls back to content search — never invents an answer.
 */
export async function findExemplar(pattern: string, deps: RetrievalDeps): Promise<FindExemplarResult> {
  if (!pattern || !pattern.trim()) {
    return { text: 'find_exemplar: pattern must be a non-empty string', data: [] };
  }

  let patternRegex: RegExp;
  try {
    patternRegex = new RegExp(pattern, 'i');
  } catch {
    patternRegex = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  }

  // Try conventions artifact first.
  const artifacts = deps.knowledge ? await deps.knowledge() : [];
  const convArtifact = artifacts.find((a) => a.category === 'conventions');

  const fromArtifact: FindExemplarResult['data'] = [];
  let artifactStatus = '';

  if (!convArtifact) {
    artifactStatus = 'no conventions artifact found; falling back to content search';
  } else {
    // Search artifact pointers.
    for (const ptr of convArtifact.pointers) {
      if (
        patternRegex.test(ptr.path) ||
        patternRegex.test(ptr.note)
      ) {
        const entry: FindExemplarResult['data'][number] = {
          path: ptr.path,
          note: ptr.note,
          source: 'artifact',
        };
        if (ptr.line !== undefined) entry.line = ptr.line;
        fromArtifact.push(entry);
      }
    }
    if (fromArtifact.length > 0) {
      const lines = fromArtifact.slice(0, FIND_EXEMPLAR_MAX).map((e) =>
        e.line !== undefined ? `${e.path}:${e.line}: ${e.note}` : `${e.path}: ${e.note}`,
      );
      return { text: lines.join('\n'), data: fromArtifact.slice(0, FIND_EXEMPLAR_MAX) };
    }
    artifactStatus = `conventions artifact present but no pointers matched "${pattern}"; falling back to content search`;
  }

  // Content-search fallback.
  const files: string[] = [];
  try {
    await collectFiles(deps.repoRoot, files, deps.repoRoot);
  } catch {
    const noMatchText = artifactStatus
      ? `[${artifactStatus}]\nfind_exemplar: no matches found`
      : `find_exemplar: no matches found`;
    return { text: noMatchText, data: [] };
  }
  files.sort();

  const fromContent: FindExemplarResult['data'] = [];
  for (const relPath of files) {
    if (fromContent.length >= FIND_EXEMPLAR_MAX) break;
    const fullPath = join(deps.repoRoot, relPath);
    let content: string;
    try {
      content = await readFile(fullPath, 'utf-8');
    } catch {
      continue;
    }
    if (patternRegex.test(content)) {
      fromContent.push({ path: relPath, note: 'content-search match', source: 'content-search' });
    }
  }

  const header = `[${artifactStatus}]`;
  if (fromContent.length === 0) {
    return { text: `${header}\nfind_exemplar: no matches found for "${pattern}"`, data: [] };
  }

  const lines = fromContent.map((e) => `${e.path}: ${e.note}`);
  return { text: `${header}\n${lines.join('\n')}`, data: fromContent };
}

// ---------------------------------------------------------------------------
// AC-3: conventions_for — artifact pointers + rules for a surface
// ---------------------------------------------------------------------------

/**
 * Return the conventions-artifact pointers and rules for a named `surface`
 * (e.g. `auth`, `api`, `ui`, `tests`). The surface is matched against pointer
 * paths and notes.
 *
 * When the artifact is absent or stale, says so explicitly — never silently
 * uses stale facts.
 */
export async function conventionsFor(surface: string, deps: RetrievalDeps): Promise<ConventionsForResult> {
  if (!surface || !surface.trim()) {
    return {
      text: 'conventions_for: surface must be a non-empty string',
      data: { found: false, fresh: false, pointers: [] },
    };
  }

  const artifacts = deps.knowledge ? await deps.knowledge() : [];
  const convArtifact = artifacts.find((a) => a.category === 'conventions');

  if (!convArtifact) {
    return {
      text: `conventions_for "${surface}": no conventions artifact found — comprehension has not run for this repo`,
      data: { found: false, fresh: false, pointers: [] },
    };
  }

  // Filter pointers relevant to the surface.
  const surfaceRegex = new RegExp(surface.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  const relevant = convArtifact.pointers.filter(
    (p) => surfaceRegex.test(p.path) || surfaceRegex.test(p.note),
  );

  const data: ConventionsForResult['data'] = {
    found: true,
    fresh: convArtifact.status === 'trusted',
    generatedAtSha: convArtifact.generatedAtSha,
    pointers: relevant.map((p) => {
      const ptr: { path: string; line?: number; note: string } = { path: p.path, note: p.note };
      if (p.line !== undefined) ptr.line = p.line;
      return ptr;
    }),
    summary: convArtifact.summary,
  };

  const freshness = convArtifact.status === 'trusted'
    ? `trusted at ${convArtifact.generatedAtSha}`
    : `provisional at ${convArtifact.generatedAtSha} — verify before relying on it`;

  if (relevant.length === 0) {
    return {
      text: `conventions_for "${surface}": conventions artifact present (${freshness}) but no pointers matched surface "${surface}"`,
      data,
    };
  }

  const lines = [
    `conventions_for "${surface}" [${freshness}]:`,
    ...relevant.map((p) =>
      p.line !== undefined ? `  ${p.path}:${p.line}: ${p.note}` : `  ${p.path}: ${p.note}`,
    ),
    `summary: ${convArtifact.summary}`,
  ];

  return { text: lines.join('\n'), data };
}

// ---------------------------------------------------------------------------
// AC-4: stack_versions — package.json + lockfile-v1 parse
// ---------------------------------------------------------------------------

/**
 * Parse the repo's package.json (all direct + dev dependencies) and, when
 * present, the npm lockfile v1 (package-lock.json with `lockfileVersion: 1`)
 * for resolved versions.
 *
 * Falls back to listing manifest-like files in the repo root when neither a
 * package.json nor a known lockfile is present — generic graceful degradation
 * for non-JS repos.
 */
export async function stackVersions(deps: RetrievalDeps): Promise<StackVersionsResult> {
  const root = deps.repoRoot;

  // Try package.json.
  let pkgJson: Record<string, unknown> | null = null;
  try {
    const pkgPath = join(root, 'package.json');
    const raw = await readFile(pkgPath, 'utf-8');
    pkgJson = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    // Not a Node.js repo or unreadable — fall through.
  }

  if (pkgJson !== null) {
    // Try lockfile v1 for resolved versions.
    let lockVersions: Record<string, string> | null = null;
    try {
      const lockPath = join(root, 'package-lock.json');
      const raw = await readFile(lockPath, 'utf-8');
      const lock = JSON.parse(raw) as Record<string, unknown>;
      if (lock['lockfileVersion'] === 1 && typeof lock['dependencies'] === 'object' && lock['dependencies'] !== null) {
        const lockDeps = lock['dependencies'] as Record<string, Record<string, unknown>>;
        lockVersions = {};
        for (const [name, info] of Object.entries(lockDeps)) {
          if (typeof info['version'] === 'string') {
            lockVersions[name] = info['version'];
          }
        }
      }
    } catch {
      // No lockfile or wrong version — use package.json versions.
    }

    if (lockVersions !== null) {
      const lines = Object.entries(lockVersions)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([n, v]) => `${n}: ${v}`);
      return {
        text: `stack_versions (lockfile-v1):\n${lines.join('\n')}`,
        data: { source: 'lockfile-v1', versions: lockVersions },
      };
    }

    // Use package.json declared versions.
    const declared: Record<string, string> = {};
    for (const depField of ['dependencies', 'devDependencies', 'peerDependencies'] as const) {
      const field = pkgJson[depField];
      if (typeof field === 'object' && field !== null) {
        for (const [name, version] of Object.entries(field as Record<string, unknown>)) {
          if (typeof version === 'string') {
            declared[name] = version;
          }
        }
      }
    }

    const lines = Object.entries(declared)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([n, v]) => `${n}: ${v}`);
    return {
      text: `stack_versions (package.json):\n${lines.join('\n')}`,
      data: { source: 'package.json', versions: declared },
    };
  }

  // Generic fallback: list manifest files at root.
  const manifestPatterns = /^(package\.json|Cargo\.toml|go\.mod|requirements\.txt|pyproject\.toml|Gemfile|pom\.xml|build\.gradle)$/;
  let rootFiles: string[] = [];
  try {
    const { readdir } = await import('node:fs/promises');
    const entries = await readdir(root, { withFileTypes: true });
    rootFiles = entries
      .filter((e) => e.isFile() && manifestPatterns.test(e.name))
      .map((e) => e.name)
      .sort();
  } catch {
    rootFiles = [];
  }

  if (rootFiles.length === 0) {
    return {
      text: 'stack_versions: no known manifest file found at repo root',
      data: { source: 'manifest-list', versions: {}, manifestFiles: [] },
    };
  }

  return {
    text: `stack_versions: found manifest file(s) at repo root: ${rootFiles.join(', ')}`,
    data: { source: 'manifest-list', versions: {}, manifestFiles: rootFiles },
  };
}

// ---------------------------------------------------------------------------
// AC-5: impact — wraps F-42 over the injected graph
// ---------------------------------------------------------------------------

/**
 * Compute which files are impacted by changes to `files`, using the injected
 * import graph from F-42. Returns impacted files (reverse transitive reach)
 * and the subset that are test files.
 *
 * When `deps.scan` is absent, reports that the import scanner is not wired yet.
 */
export async function impact(files: string[], deps: RetrievalDeps): Promise<ImpactQueryResult> {
  if (!deps.scan) {
    return {
      text: 'impact: import scanner not available (deps.scan not wired)',
      data: { impacted: [], testFiles: [] },
    };
  }

  if (files.length === 0) {
    return {
      text: 'impact: no files provided',
      data: { impacted: [], testFiles: [] },
    };
  }

  let graph: ImportGraph;
  try {
    graph = await deps.scan(deps.repoRoot);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      text: `impact: scan failed — ${msg}`,
      data: { impacted: [], testFiles: [] },
    };
  }

  // Build reverse adjacency: for each file, which files import it.
  const reverseEdges: Record<string, string[]> = {};
  for (const [importer, imported] of Object.entries(graph.edges)) {
    for (const dep of imported) {
      if (!reverseEdges[dep]) reverseEdges[dep] = [];
      reverseEdges[dep]!.push(importer);
    }
  }

  // BFS/DFS reverse reachability from the changed files.
  const inputSet = new Set(files.map((f) => posix.normalize(f)));
  const visited = new Set<string>(inputSet);
  const queue = [...inputSet];

  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const importer of reverseEdges[current] ?? []) {
      const norm = posix.normalize(importer);
      if (!visited.has(norm)) {
        visited.add(norm);
        queue.push(norm);
      }
    }
  }

  // Exclude the input files themselves from "impacted" (report only the dependents).
  const impacted = [...visited]
    .filter((f) => !inputSet.has(f))
    .sort();

  const testFiles = impacted.filter(isTestFile);

  const lines = [
    `impact (scanned at ${graph.scannedAtSha}):`,
    `  changed: ${files.join(', ')}`,
    `  impacted: ${impacted.length > 0 ? impacted.join(', ') : '(none)'}`,
    `  test files: ${testFiles.length > 0 ? testFiles.join(', ') : '(none)'}`,
  ];

  return {
    text: lines.join('\n'),
    data: { impacted, testFiles, scannedAtSha: graph.scannedAtSha },
  };
}

// ---------------------------------------------------------------------------
// AC-6: retrievalTools(deps) — ToolImpl wrappers for the broker
// ---------------------------------------------------------------------------

/**
 * Build the five read-only ToolImpl objects for broker registration. Each
 * wraps one retrieval function; the broker enforces grants (retrieval.api or
 * fs.read per GRANT_TOOL_MAP). Assembly registers these; tests inject them
 * directly into a Broker with synthetic deps.
 */
export function retrievalTools(deps: RetrievalDeps): {
  findSymbol: import('../contract/tool.js').ToolImpl;
  findExemplar: import('../contract/tool.js').ToolImpl;
  conventionsFor: import('../contract/tool.js').ToolImpl;
  stackVersions: import('../contract/tool.js').ToolImpl;
  impact: import('../contract/tool.js').ToolImpl;
} {
  return {
    findSymbol: {
      def: {
        name: 'find_symbol',
        description:
          'Search the repo for definition sites of a named symbol (function, class, const, interface, type, def, func forms). Returns path:line-prefixed candidates in deterministic order, bounded count.',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'The symbol name to search for.' },
          },
          required: ['name'],
        },
      },
      async execute(_goal: Goal, args: Record<string, unknown>) {
        const name = typeof args['name'] === 'string' ? args['name'] : '';
        const result = await findSymbol(name, deps);
        return { ok: true, output: result.text };
      },
    },

    findExemplar: {
      def: {
        name: 'find_exemplar',
        description:
          'Find exemplars matching a pattern from the conventions knowledge artifact. Falls back to content search when the artifact is absent. Never invents an answer.',
        parameters: {
          type: 'object',
          properties: {
            pattern: { type: 'string', description: 'Pattern to match against exemplar paths, notes, or content.' },
          },
          required: ['pattern'],
        },
      },
      async execute(_goal: Goal, args: Record<string, unknown>) {
        const pattern = typeof args['pattern'] === 'string' ? args['pattern'] : '';
        const result = await findExemplar(pattern, deps);
        return { ok: true, output: result.text };
      },
    },

    conventionsFor: {
      def: {
        name: 'conventions_for',
        description:
          'Return the conventions artifact pointers and rules for a named surface (e.g. "auth", "api", "ui"). States absent or stale artifact explicitly.',
        parameters: {
          type: 'object',
          properties: {
            surface: { type: 'string', description: 'The surface name to look up conventions for.' },
          },
          required: ['surface'],
        },
      },
      async execute(_goal: Goal, args: Record<string, unknown>) {
        const surface = typeof args['surface'] === 'string' ? args['surface'] : '';
        const result = await conventionsFor(surface, deps);
        return { ok: true, output: result.text };
      },
    },

    stackVersions: {
      def: {
        name: 'stack_versions',
        description:
          'Parse the repo manifest/lockfile into name→version text. Uses package.json + lockfile v1; falls back to listing manifest files for non-JS repos.',
        parameters: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
      async execute(_goal: Goal, _args: Record<string, unknown>) {
        const result = await stackVersions(deps);
        return { ok: true, output: result.text };
      },
    },

    impact: {
      def: {
        name: 'impact',
        description:
          'Compute which files are impacted by changes to the given files using the import graph. Returns impacted files and test files in deterministic order.',
        parameters: {
          type: 'object',
          properties: {
            files: {
              type: 'array',
              items: { type: 'string' },
              description: 'Repo-relative paths of the changed files.',
            },
          },
          required: ['files'],
        },
      },
      async execute(_goal: Goal, args: Record<string, unknown>) {
        const files = Array.isArray(args['files']) ? (args['files'] as unknown[]).map(String) : [];
        const result = await impact(files, deps);
        return { ok: true, output: result.text };
      },
    },
  };
}
