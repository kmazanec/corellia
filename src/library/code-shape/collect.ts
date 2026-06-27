import { existsSync, readdirSync, statSync } from 'node:fs';
import { extname, join, normalize, sep } from 'node:path';

const CODE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mts',
  '.cts',
  '.mjs',
  '.cjs',
]);

const SHAPE_IGNORE = new Set([
  '.git',
  'node_modules',
  '.venv',
  'venv',
  '__pycache__',
  'dist',
  'build',
  'out',
  '.corellia',
  '.claude',
  'coverage',
  '.next',
  'target',
  '.cache',
]);

export interface CollectedCodeFiles {
  files: string[];
  truncated: boolean;
}

export function collectCodeFiles(
  root: string,
  scope: readonly string[],
  maxFiles: number,
): CollectedCodeFiles {
  const files: string[] = [];
  const seen = new Set<string>();
  let truncated = false;
  const starts = scope.length > 0 ? scope : ['.'];

  for (const start of starts) {
    walk(start === '.' ? root : join(root, start), start === '.' ? '' : start);
    if (files.length >= maxFiles) break;
  }

  return { files: files.sort(), truncated };

  function walk(abs: string, rel: string): void {
    if (files.length >= maxFiles) {
      truncated = true;
      return;
    }
    if (!existsSync(abs)) return;

    let stat;
    try {
      stat = statSync(abs);
    } catch {
      return;
    }

    if (stat.isFile()) {
      if (isCodeFile(abs)) addFile(rel);
      return;
    }

    if (!stat.isDirectory()) return;

    let entries;
    try {
      entries = readdirSync(abs, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (SHAPE_IGNORE.has(entry.name)) continue;
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      const childAbs = join(abs, entry.name);
      if (entry.isDirectory()) {
        walk(childAbs, childRel);
      } else if (entry.isFile() && isCodeFile(entry.name)) {
        addFile(childRel);
      }
      if (files.length >= maxFiles) {
        truncated = true;
        return;
      }
    }
  }

  function addFile(path: string): void {
    if (seen.has(path) || files.length >= maxFiles) return;
    seen.add(path);
    files.push(path);
  }
}

export function normalizedScope(scope: readonly string[] | undefined): string[] {
  return (scope ?? [])
    .map((part) => normalize(part).replaceAll(sep, '/').replace(/^\/+|\/+$/g, ''))
    .filter((part) => part.length > 0 && part !== '.');
}

export function lineCount(content: string): number {
  if (content.length === 0) return 0;
  return content.split('\n').length;
}

function isCodeFile(path: string): boolean {
  return CODE_EXTENSIONS.has(extname(path));
}
