/**
 * Core file-system tool implementations bound to a sandbox root. Each tool
 * resolves its path argument relative to the root and refuses absolute paths
 * and directory traversal that would escape it.
 *
 * These are the leaf capabilities the broker mediates — they perform effects
 * and return results; grant and scope enforcement happen above them.
 */

import { normalize, isAbsolute, join, relative } from 'node:path';
import { readFile, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import type { Goal } from '../contract/goal.js';
import type { ToolImpl } from '../contract/tool.js';

// ---------------------------------------------------------------------------
// Path safety helpers
// ---------------------------------------------------------------------------

/**
 * Resolve a caller-supplied relative path against the sandbox root. Returns
 * null if the path is absolute, starts with `..` after normalization, or would
 * escape the root — any of which represents an unsafe traversal.
 */
function resolveSandboxPath(root: string, rawPath: string): string | null {
  if (isAbsolute(rawPath)) return null;
  const normalized = normalize(rawPath);
  if (normalized.startsWith('..')) return null;
  const full = join(root, normalized);
  // Double-check the resolved path is still inside the root.
  const rel = relative(root, full);
  if (rel.startsWith('..') || isAbsolute(rel)) return null;
  return full;
}

/**
 * Check whether a relative path falls within at least one of the goal's
 * declared scope prefixes, using the same normalize + boundary-suffix match
 * as the `filesWithinScope` deterministic check.
 */
function isInScope(rawPath: string, scope: string[]): boolean {
  if (scope.length === 0) return true; // No scope declared: allow all.
  const normalized = normalize(rawPath);
  return scope.some((prefix) => {
    const ns = normalize(prefix);
    const boundary = ns.endsWith('/') ? ns : ns + '/';
    return normalized === ns || normalized.startsWith(boundary);
  });
}

// ---------------------------------------------------------------------------
// read_file
// ---------------------------------------------------------------------------

export const readFileTool: ToolImpl = {
  def: {
    name: 'read_file',
    description: 'Read the contents of a file inside the sandbox root. The path must be relative and must not escape the root.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative path to the file, e.g. src/index.ts' },
      },
      required: ['path'],
    },
  },

  async execute(_goal: Goal, args: Record<string, unknown>): Promise<{ ok: boolean; output: string }> {
    const rawPath = args['path'];
    if (typeof rawPath !== 'string' || rawPath.length === 0) {
      return { ok: false, output: 'read_file: path argument must be a non-empty string' };
    }
    // Sandbox root is injected via the closure created in createFileTools.
    // This top-level export is the factory; the actual impl closes over root.
    // (This signature is only used by the factory below; it is not exported directly for use without a root.)
    return { ok: false, output: 'read_file: internal error — use createFileTools(root) to get a bound impl' };
  },
};

// ---------------------------------------------------------------------------
// Tool factories bound to a sandbox root
// ---------------------------------------------------------------------------

/**
 * Create the four core file-system ToolImpl objects bound to a specific
 * sandbox root. The root is captured in a closure — the returned impls never
 * accept the root as an argument so a caller cannot escape it.
 */
export function createFileTools(root: string): {
  readFile: ToolImpl;
  writeFile: ToolImpl;
  listDir: ToolImpl;
  search: ToolImpl;
} {
  // ── read_file ─────────────────────────────────────────────────────────────

  const readFileImpl: ToolImpl = {
    def: {
      name: 'read_file',
      description: 'Read the contents of a file inside the sandbox root. The path must be relative and must not escape the root.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative path to the file, e.g. src/index.ts' },
        },
        required: ['path'],
      },
    },

    async execute(_goal: Goal, args: Record<string, unknown>): Promise<{ ok: boolean; output: string }> {
      const rawPath = args['path'];
      if (typeof rawPath !== 'string' || rawPath.length === 0) {
        return { ok: false, output: 'read_file: path must be a non-empty string' };
      }
      const full = resolveSandboxPath(root, rawPath);
      if (full === null) {
        return { ok: false, output: `read_file: path "${rawPath}" is outside the sandbox root` };
      }
      try {
        const content = await readFile(full, 'utf-8');
        return { ok: true, output: content };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false, output: `read_file: ${message}` };
      }
    },
  };

  // ── write_file ────────────────────────────────────────────────────────────

  const writeFileImpl: ToolImpl = {
    def: {
      name: 'write_file',
      description: 'Write content to a file inside the sandbox root, within the goal\'s declared scope. The path must be relative and within scope.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative path to the file to write' },
          content: { type: 'string', description: 'The content to write' },
        },
        required: ['path', 'content'],
      },
    },

    async execute(goal: Goal, args: Record<string, unknown>): Promise<{ ok: boolean; output: string }> {
      const rawPath = args['path'];
      const content = args['content'];
      if (typeof rawPath !== 'string' || rawPath.length === 0) {
        return { ok: false, output: 'write_file: path must be a non-empty string' };
      }
      if (typeof content !== 'string') {
        return { ok: false, output: 'write_file: content must be a string' };
      }

      // Refuse absolute paths and traversal before scope check.
      const full = resolveSandboxPath(root, rawPath);
      if (full === null) {
        return { ok: false, output: `write_file: path "${rawPath}" is outside the sandbox root` };
      }

      // Scope check: the path must start with at least one of the goal's scope prefixes.
      if (!isInScope(rawPath, goal.scope)) {
        return {
          ok: false,
          output: `write_file: path "${rawPath}" is outside the goal's declared scope`,
        };
      }

      try {
        const { writeFile: fsWriteFile, mkdir } = await import('node:fs/promises');
        // Ensure parent directory exists.
        const { dirname } = await import('node:path');
        await mkdir(dirname(full), { recursive: true });
        await fsWriteFile(full, content, 'utf-8');
        return { ok: true, output: `wrote ${rawPath}` };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false, output: `write_file: ${message}` };
      }
    },
  };

  // ── list_dir ─────────────────────────────────────────────────────────────

  const listDirImpl: ToolImpl = {
    def: {
      name: 'list_dir',
      description: 'List the entries of a directory inside the sandbox root. Returns one entry per line.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative path to the directory, e.g. src/' },
        },
        required: ['path'],
      },
    },

    async execute(_goal: Goal, args: Record<string, unknown>): Promise<{ ok: boolean; output: string }> {
      const rawPath = args['path'];
      if (typeof rawPath !== 'string' || rawPath.length === 0) {
        return { ok: false, output: 'list_dir: path must be a non-empty string' };
      }
      const full = resolveSandboxPath(root, rawPath);
      if (full === null) {
        return { ok: false, output: `list_dir: path "${rawPath}" is outside the sandbox root` };
      }
      try {
        const entries = await readdir(full, { withFileTypes: true });
        const lines = entries.map((e) => (e.isDirectory() ? `${e.name}/` : e.name));
        return { ok: true, output: lines.join('\n') };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false, output: `list_dir: ${message}` };
      }
    },
  };

  // ── search ────────────────────────────────────────────────────────────────

  const searchImpl: ToolImpl = {
    def: {
      name: 'search',
      description: 'Search file contents under the sandbox root for a pattern, returning path:line-prefixed matches suitable for a model transcript.',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'The substring or regex pattern to search for' },
          path: { type: 'string', description: 'Relative directory or file to search within; defaults to the root' },
        },
        required: ['pattern'],
      },
    },

    async execute(_goal: Goal, args: Record<string, unknown>): Promise<{ ok: boolean; output: string }> {
      const pattern = args['pattern'];
      if (typeof pattern !== 'string' || pattern.length === 0) {
        return { ok: false, output: 'search: pattern must be a non-empty string' };
      }

      const rawPath = typeof args['path'] === 'string' && args['path'].length > 0
        ? args['path']
        : '.';

      const searchRoot = rawPath === '.'
        ? root
        : resolveSandboxPath(root, rawPath);

      if (searchRoot === null) {
        return { ok: false, output: `search: path "${rawPath}" is outside the sandbox root` };
      }

      let regex: RegExp;
      try {
        regex = new RegExp(pattern);
      } catch {
        // Treat non-regex pattern as a literal substring search.
        regex = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
      }

      const matches: string[] = [];

      async function scanFile(filePath: string, relPath: string): Promise<void> {
        try {
          const content = await readFile(filePath, 'utf-8');
          const lines = content.split('\n');
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (line !== undefined && regex.test(line)) {
              matches.push(`${relPath}:${i + 1}: ${line}`);
            }
          }
        } catch {
          // Skip unreadable or binary files silently.
        }
      }

      async function scanDir(dirPath: string, relPrefix: string): Promise<void> {
        let entries;
        try {
          entries = await readdir(dirPath, { withFileTypes: true });
        } catch {
          return;
        }
        for (const entry of entries) {
          const entryRel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
          const entryFull = join(dirPath, entry.name);
          if (entry.isDirectory()) {
            await scanDir(entryFull, entryRel);
          } else if (entry.isFile()) {
            await scanFile(entryFull, entryRel);
          }
        }
      }

      try {
        const stats = await stat(searchRoot);
        if (stats.isDirectory()) {
          const relPrefix = rawPath === '.' ? '' : normalize(rawPath);
          await scanDir(searchRoot, relPrefix);
        } else {
          await scanFile(searchRoot, rawPath === '.' ? '' : normalize(rawPath));
        }
      } catch {
        // If the search root itself doesn't exist, return empty.
        return { ok: true, output: '' };
      }

      return { ok: true, output: matches.join('\n') };
    },
  };

  return {
    readFile: readFileImpl,
    writeFile: writeFileImpl,
    listDir: listDirImpl,
    search: searchImpl,
  };
}

/**
 * Whether the path exists in the filesystem (used by tests only — not exported
 * for production use since the broker always validates against the root).
 */
export function pathExists(p: string): boolean {
  return existsSync(p);
}
