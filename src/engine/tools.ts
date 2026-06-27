/**
 * Core file-system tool implementations bound to a sandbox root. Each tool
 * resolves its path argument relative to the root and refuses absolute paths
 * and directory traversal that would escape it.
 *
 * These are the leaf capabilities the broker mediates — they perform effects
 * and return results; grant and scope enforcement happen above them.
 */

import { normalize, isAbsolute, join, relative, dirname } from 'node:path';
import { readFile, readdir, stat, writeFile as fsWriteFile, mkdir, unlink } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import type { Goal } from '../contract/goal.js';
import type { ToolImpl } from '../contract/tool.js';
// isInScope lives in library/checks.ts (single canonical definition).
// Imported here for local use and re-exported so callers that import from
// tools.ts keep working.
import { isInScope } from '../library/checks.js';
export { isInScope };

// ---------------------------------------------------------------------------
// Path safety helpers
// ---------------------------------------------------------------------------

/**
 * Resolve a caller-supplied relative path against the sandbox root. Returns
 * null if the path is absolute, starts with `..` after normalization, or would
 * escape the root — any of which represents an unsafe traversal.
 *
 * Containment is lexical (normalize + relative-path prefix check). Symlink
 * escape is accepted under ADR-016's operator-trusts-own-repos model: in v1 the
 * operator controls the sandbox root and its contents, so realpath hardening
 * would add complexity for no security gain at this trust boundary. (ADR-016)
 */
export function resolveSandboxPath(root: string, rawPath: string): string | null {
  if (isAbsolute(rawPath)) return null;
  const normalized = normalize(rawPath);
  if (normalized.startsWith('..')) return null;
  const full = join(root, normalized);
  // Double-check the resolved path is still inside the root.
  const rel = relative(root, full);
  if (rel.startsWith('..') || isAbsolute(rel)) return null;
  return full;
}

// ---------------------------------------------------------------------------
// read_file line-range + large-file bounding
// ---------------------------------------------------------------------------

/**
 * A whole-file read of a file longer than this many lines is auto-bounded to the
 * first chunk, with a notice telling the model to page the rest via offset/limit.
 * Stops one giant file (corellia's engine.ts is thousands of lines) from filling
 * the working-memory cap on a single read (run live-self-bcc825bb context-thrash).
 */
export const READ_FILE_AUTO_BOUND_LINES = 400;

type LineRange = { ok: true; offset: number; limit: number | undefined } | { ok: false; detail: string };

/** Validate optional offset/limit args. Both must be positive integers when present. */
function parseLineRange(args: Record<string, unknown>): LineRange {
  let offset = 1;
  let limit: number | undefined;
  if (args['offset'] !== undefined) {
    const o = args['offset'];
    if (typeof o !== 'number' || !Number.isInteger(o) || o < 1) {
      return { ok: false, detail: 'offset must be a positive integer (1-based line number)' };
    }
    offset = o;
  }
  if (args['limit'] !== undefined) {
    const l = args['limit'];
    if (typeof l !== 'number' || !Number.isInteger(l) || l < 1) {
      return { ok: false, detail: 'limit must be a positive integer (max lines to return)' };
    }
    limit = l;
  }
  return { ok: true, offset, limit };
}

/**
 * Return the requested slice of a file's content.
 * - An explicit range (offset/limit) returns exactly that line window verbatim.
 * - With NO range, a file at or under {@link READ_FILE_AUTO_BOUND_LINES} returns
 *   whole; a longer file returns the first chunk plus a notice to page the rest.
 * Content is returned verbatim (not line-numbered) so a leaf that copies a region
 * into write_file is never corrupted by prefixes; the notice rides on a separate
 * trailing line and names the line bounds so the model can page or narrow.
 */
export function sliceForRead(content: string, offset: number, limit: number | undefined): string {
  const lines = content.split('\n');
  // A trailing newline yields a final empty segment that is not a real line.
  const lineCount = content.endsWith('\n') ? lines.length - 1 : lines.length;

  const explicitRange = offset > 1 || limit !== undefined;
  let start = offset; // 1-based
  let end: number; // inclusive, 1-based
  let notice = '';

  if (explicitRange) {
    if (start > lineCount) {
      return `[read_file: offset ${start} is past end of file (${lineCount} lines).]`;
    }
    end = limit !== undefined ? Math.min(lineCount, start + limit - 1) : lineCount;
    notice = `\n[read_file: lines ${start}-${end} of ${lineCount}.]`;
  } else if (lineCount > READ_FILE_AUTO_BOUND_LINES) {
    start = 1;
    end = READ_FILE_AUTO_BOUND_LINES;
    notice =
      `\n[read_file: file is ${lineCount} lines; showing 1-${end}. ` +
      `Call read_file again with offset=${end + 1} (and an optional limit) for the rest, ` +
      `or read only the range you need.]`;
  } else {
    // Small whole-file read — return content exactly as before (no notice), so the
    // common case is byte-identical to the pre-change behavior.
    return content;
  }

  return lines.slice(start - 1, end).join('\n') + notice;
}

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
  deleteFile: ToolImpl;
  listDir: ToolImpl;
  search: ToolImpl;
  headSha: ToolImpl;
} {
  // ── read_file ─────────────────────────────────────────────────────────────

  const readFileImpl: ToolImpl = {
    def: {
      name: 'read_file',
      description:
        'Read a file inside the sandbox root. The path must be relative and must not escape the root. ' +
        'Optionally read a LINE RANGE via offset (1-based first line) and limit (max lines) — prefer a ' +
        'range when you only need part of a large file, so you do not pull a whole huge file into context. ' +
        `A whole-file read of a file longer than ${READ_FILE_AUTO_BOUND_LINES} lines is automatically ` +
        'truncated to the first chunk with a notice; call again with offset/limit for the rest.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative path to the file, e.g. src/index.ts' },
          offset: {
            type: 'number',
            description: '1-based line number to start reading from (optional; default 1).',
          },
          limit: {
            type: 'number',
            description: 'Maximum number of lines to return from offset (optional).',
          },
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

      // Parse optional line-range args. A non-integer / out-of-range value is a
      // soft error (the model can retry) rather than a silent whole-file read.
      const rangeResult = parseLineRange(args);
      if (!rangeResult.ok) return { ok: false, output: `read_file: ${rangeResult.detail}` };
      const { offset, limit } = rangeResult;

      try {
        const content = await readFile(full, 'utf-8');
        return { ok: true, output: sliceForRead(content, offset, limit) };
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
        // Ensure parent directory exists.
        await mkdir(dirname(full), { recursive: true });
        await fsWriteFile(full, content, 'utf-8');
        return { ok: true, output: `wrote ${rawPath}` };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false, output: `write_file: ${message}` };
      }
    },
  };

  // ── delete_file ───────────────────────────────────────────────────────────
  // The write-side counterpart to write_file: it REMOVES a file. Same path
  // safety (relative, in-sandbox, in-scope) and the same fs.write grant, because
  // deleting is a mutation of the product/repo. Refuses directories — it removes
  // exactly one file (the OKF close-out case: a now-implemented ephemeral issue).
  // The broker re-checks sandbox containment and goal scope before dispatch, the
  // same belt-and-braces it applies to write_file.

  const deleteFileImpl: ToolImpl = {
    def: {
      name: 'delete_file',
      description: 'Delete a single file inside the sandbox root, within the goal\'s declared scope. The path must be relative, in-scope, and name a file (not a directory). Use to remove an implemented ephemeral issue file as part of OKF close-out.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative path to the file to delete' },
        },
        required: ['path'],
      },
    },

    async execute(goal: Goal, args: Record<string, unknown>): Promise<{ ok: boolean; output: string }> {
      const rawPath = args['path'];
      if (typeof rawPath !== 'string' || rawPath.length === 0) {
        return { ok: false, output: 'delete_file: path must be a non-empty string' };
      }

      // Refuse absolute paths and traversal before scope check.
      const full = resolveSandboxPath(root, rawPath);
      if (full === null) {
        return { ok: false, output: `delete_file: path "${rawPath}" is outside the sandbox root` };
      }

      // Scope check: the path must start with at least one of the goal's scope prefixes.
      if (!isInScope(rawPath, goal.scope)) {
        return {
          ok: false,
          output: `delete_file: path "${rawPath}" is outside the goal's declared scope`,
        };
      }

      try {
        const info = await stat(full);
        if (info.isDirectory()) {
          return { ok: false, output: `delete_file: "${rawPath}" is a directory; delete_file removes a single file only` };
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false, output: `delete_file: ${message}` };
      }

      try {
        await unlink(full);
        return { ok: true, output: `deleted ${rawPath}` };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false, output: `delete_file: ${message}` };
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

  // ── head_sha ───────────────────────────────────────────────────────────────
  // The sanctioned way to obtain the sandbox's current HEAD SHA. Comprehension
  // artifacts REQUIRE `generatedAtSha` = current HEAD, but a worktree's `.git` is
  // a file-indirection and the real gitdir is outside the sandbox, so direct
  // `.git/HEAD` reads fail and `git rev-parse` is not a declared script — the
  // brain used to thrash to token death trying (AC-2 run #6 trace). This tool
  // runs `git rev-parse HEAD` with cwd at the sandbox root (git resolves the
  // worktree indirection itself) and returns the SHA. Read-only: gated by
  // `fs.read`, which every comprehension goal already holds.
  const headShaImpl: ToolImpl = {
    def: {
      name: 'head_sha',
      description:
        'Return the current git HEAD SHA of the sandbox. Use its output verbatim ' +
        'for an artifact\'s generatedAtSha — do NOT run git yourself or read .git.',
      parameters: { type: 'object', properties: {} },
    },

    async execute(_goal: Goal, _args: Record<string, unknown>): Promise<{ ok: boolean; output: string }> {
      try {
        const sha = execFileSync('git', ['rev-parse', 'HEAD'], {
          cwd: root,
          encoding: 'utf-8',
          stdio: ['ignore', 'pipe', 'ignore'],
        }).trim();
        return { ok: true, output: sha };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false, output: `head_sha: ${message}` };
      }
    },
  };

  return {
    readFile: readFileImpl,
    writeFile: writeFileImpl,
    deleteFile: deleteFileImpl,
    listDir: listDirImpl,
    search: searchImpl,
    headSha: headShaImpl,
  };
}

