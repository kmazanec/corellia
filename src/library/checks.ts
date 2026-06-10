/**
 * A small library of deterministic checks (DeterministicCheck implementations).
 * These run before any judge and are intent-blind: their outcome is a function
 * of the goal and artifact alone.
 */

import type { DeterministicCheck } from '../contract/goal-type.js';
import type { Goal } from '../contract/goal.js';
import type { Artifact } from '../contract/report.js';

/**
 * Pass when the artifact is non-null and non-empty — either it has at least
 * one file, or its text body is a non-empty string.
 */
export const artifactPresent: DeterministicCheck = {
  name: 'artifact-present',
  async run(_goal: Goal, artifact: Artifact | null): Promise<{ ok: boolean; detail: string }> {
    if (artifact === null) {
      return { ok: false, detail: 'No artifact was produced.' };
    }
    if (artifact.kind === 'files') {
      const files = artifact.files ?? [];
      if (files.length === 0) {
        return { ok: false, detail: 'Artifact has kind "files" but no files were provided.' };
      }
      return { ok: true, detail: `Artifact contains ${files.length} file(s).` };
    }
    // kind === 'text'
    const text = artifact.text ?? '';
    if (text.length === 0) {
      return { ok: false, detail: 'Artifact has kind "text" but the text body is empty.' };
    }
    return { ok: true, detail: 'Artifact contains a non-empty text body.' };
  },
};

/**
 * Pass when every file in the artifact starts with at least one of the goal's
 * scope prefixes. This enforces the diff ⊆ scope invariant deterministically.
 */
export const filesWithinScope: DeterministicCheck = {
  name: 'files-within-scope',
  async run(goal: Goal, artifact: Artifact | null): Promise<{ ok: boolean; detail: string }> {
    if (artifact === null || artifact.kind !== 'files') {
      return { ok: true, detail: 'No files to check against scope.' };
    }
    const files = artifact.files ?? [];
    if (files.length === 0) {
      return { ok: true, detail: 'No files to check against scope.' };
    }
    const outOfScope = files.filter(
      (f) => !goal.scope.some((prefix) => f.path.startsWith(prefix)),
    );
    if (outOfScope.length > 0) {
      const paths = outOfScope.map((f) => f.path).join(', ');
      return {
        ok: false,
        detail: `File(s) outside declared scope: ${paths}`,
      };
    }
    return { ok: true, detail: `All ${files.length} file(s) are within scope.` };
  },
};

/**
 * Returns a check that passes when the named file in the artifact contains the
 * given needle string. If the file is absent the check fails.
 */
export function fileContains(path: string, needle: string): DeterministicCheck {
  return {
    name: `file-contains:${path}:${needle}`,
    async run(_goal: Goal, artifact: Artifact | null): Promise<{ ok: boolean; detail: string }> {
      if (artifact === null || artifact.kind !== 'files') {
        return { ok: false, detail: `Cannot check: artifact is not a file set.` };
      }
      const files = artifact.files ?? [];
      const target = files.find((f) => f.path === path);
      if (target === undefined) {
        return { ok: false, detail: `File "${path}" not found in artifact.` };
      }
      if (target.content.includes(needle)) {
        return { ok: true, detail: `File "${path}" contains "${needle}".` };
      }
      return { ok: false, detail: `File "${path}" does not contain "${needle}".` };
    },
  };
}

/**
 * Patterns that identify factory-process references in code comments.
 * These are skeleton-level approximations; exact comment parsing is not required.
 */
const PROCESS_REFERENCE_PATTERNS: RegExp[] = [
  /F-[0-9]/,
  /build plan/i,
  /per the (?:plan|spec)/i,
];

/**
 * Pass when no file content in the artifact contains factory-process references
 * in what look like code comments. Scans the full content of each file.
 * Timeless artifacts carry no factory bookkeeping inside them.
 */
export const processClean: DeterministicCheck = {
  name: 'process-clean',
  async run(_goal: Goal, artifact: Artifact | null): Promise<{ ok: boolean; detail: string }> {
    if (artifact === null || artifact.kind !== 'files') {
      return { ok: true, detail: 'No files to scan for process references.' };
    }
    const files = artifact.files ?? [];
    for (const file of files) {
      for (const pattern of PROCESS_REFERENCE_PATTERNS) {
        if (pattern.test(file.content)) {
          return {
            ok: false,
            detail: `File "${file.path}" contains a process reference matching ${pattern}.`,
          };
        }
      }
    }
    return { ok: true, detail: `Scanned ${files.length} file(s); no process references found.` };
  },
};
