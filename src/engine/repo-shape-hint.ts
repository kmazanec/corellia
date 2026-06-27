import { readdirSync, statSync } from 'node:fs';
import type { Goal } from '../contract/goal.js';

const SHAPE_IGNORE = new Set([
  '.git', 'node_modules', '.venv', 'venv', '__pycache__', 'dist', 'build',
  'out', '.corellia', '.claude', 'coverage', '.next', 'target', '.cache',
]);

export interface RegionSize {
  dirs: number;
  files: number;
  bytes: number;
}

export function repoShapeHint(goal: Goal, repoRoot: string | undefined): string | undefined {
  if (repoRoot === undefined) return undefined;
  if (goal.type !== 'map-repo' && goal.type !== 'deep-dive-region') return undefined;

  if (goal.scope.length > 0) {
    const { dirs, files, bytes } = countRegion(repoRoot, goal.scope);
    const largeFiles = 40;
    const largeBytes = 450_000;
    if (files < largeFiles && bytes < largeBytes) return undefined;
    const sizeKb = Math.round(bytes / 1024);
    return (
      `region size (scope: ${goal.scope.join(', ')}): ~${files} files (~${sizeKb}KB) ` +
      `across ~${dirs} directories. (Rule of thumb: a region of many dozens of ` +
      `files, OR a few hundred KB of source, is too large to deep-dive faithfully ` +
      `in one node - SPLIT it into sub-region children, one per sub-directory or ` +
      `cohesive area, rather than attempting the whole region in a single dive.)`
    );
  }

  try {
    const entries = readdirSync(repoRoot, { withFileTypes: true });
    let topDirs = 0;
    let topFiles = 0;
    for (const entry of entries) {
      if (SHAPE_IGNORE.has(entry.name)) continue;
      if (entry.isDirectory()) topDirs++;
      else if (entry.isFile()) topFiles++;
    }

    let nestedFiles = 0;
    for (const entry of entries) {
      if (!entry.isDirectory() || SHAPE_IGNORE.has(entry.name)) continue;
      try {
        nestedFiles += readdirSync(`${repoRoot}/${entry.name}`).length;
      } catch {
        // Unreadable subdir: skip. This is a hint, not a contract.
      }
    }

    return (
      `top-level source dirs: ${topDirs}; top-level files: ${topFiles}; ` +
      `approx entries one level deep: ${nestedFiles}. ` +
      `(Rule of thumb: ~8+ top-level source subsystems, or many hundreds of ` +
      `files, is too large to map faithfully in one node - split into one ` +
      `sub-region map-repo per top-level subsystem.)`
    );
  } catch {
    return undefined;
  }
}

/**
 * Coarsely count files and directories under scope prefixes. Bounded so the
 * decide-path hint stays cheap; the result is a size signal, not a contract.
 */
export function countRegion(root: string, scope: string[]): RegionSize {
  let dirs = 0;
  let files = 0;
  let bytes = 0;
  const cap = 500;

  const walk = (abs: string): void => {
    if (files >= cap) return;
    let entries: import('node:fs').Dirent[];
    try {
      entries = readdirSync(abs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (SHAPE_IGNORE.has(entry.name)) continue;
      if (entry.isDirectory()) {
        dirs++;
        walk(`${abs}/${entry.name}`);
      } else if (entry.isFile()) {
        files++;
        try {
          bytes += statSync(`${abs}/${entry.name}`).size;
        } catch {
          // Ignore files that disappear during the cheap scan.
        }
      }
      if (files >= cap) return;
    }
  };

  for (const prefix of scope) {
    const clean = prefix.replace(/\/+$/, '');
    walk(`${root}/${clean}`);
  }
  return { dirs, files, bytes };
}
