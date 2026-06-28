import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Artifact } from '../../contract/report.js';
import { isInScope } from '../tools.js';

/**
 * Worktree salvage for make goals.
 *
 * A make leaf can write real files to the worktree and then, at emit time, return
 * a prose message (a summary, a plan) instead of echoing those files as fenced
 * blocks. The returned `text` artifact is non-empty, so `artifactPresent` passes
 * it — but the judge rejects prose, and the leaf's actual work is thrown away.
 *
 * This recovers that work: when a make goal's returned artifact is text but the
 * worktree holds in-scope changes, rebuild the artifact from the changed files so
 * the deliverable is what was actually written, not what was described. The leaf's
 * files then flow through the normal gates (scope, judge) instead of being lost.
 *
 * Best-effort and side-effect-free: any git/read error yields no salvage, and the
 * caller keeps the original artifact.
 */

export function salvageWorktreeArtifact(
  root: string,
  scope: string[],
): Artifact | undefined {
  const changed = changedInScopePaths(root, scope);
  if (changed.length === 0) return undefined;

  const files: { path: string; content: string }[] = [];
  for (const path of changed) {
    try {
      files.push({ path, content: readFileSync(join(root, path), 'utf-8') });
    } catch {
      // A path that diff named but cannot be read (deleted, races) is skipped;
      // a deletion is not a salvageable file artifact.
    }
  }

  return files.length > 0 ? { kind: 'files', files } : undefined;
}

function changedInScopePaths(root: string, scope: string[]): string[] {
  const gitLines = (args: string[]): string[] => {
    try {
      return execFileSync('git', ['-C', root, ...args], { stdio: 'pipe', encoding: 'utf-8' })
        .trim()
        .split('\n')
        .filter(Boolean);
    } catch {
      return [];
    }
  };
  const paths = [
    ...gitLines(['diff', '--name-only', 'HEAD']),
    ...gitLines(['ls-files', '--others', '--exclude-standard']),
  ];
  const unique = [...new Set(paths)];
  if (scope.length === 0) return unique;
  return unique.filter((p) => isInScope(p, scope));
}
