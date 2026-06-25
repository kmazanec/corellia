/**
 * A small library of deterministic checks (DeterministicCheck implementations).
 * These run before any judge; their outcome is a function of the goal and
 * artifact alone. No check in this file reads the judge-bar field on a goal
 * (constitution rule 5: deterministic gates are always applied in full).
 */

import { normalize, isAbsolute } from 'node:path';
import { execFileSync } from 'node:child_process';
import type { DeterministicCheck, CheckContext } from '../contract/goal-type.js';
import type { Goal } from '../contract/goal.js';
import type { Artifact } from '../contract/report.js';

// ---------------------------------------------------------------------------
// Scope containment predicate — single definition used by filesWithinScope here
// and re-exported for diffWithinScope in engine/worktree.ts (via engine/tools.ts).
// ---------------------------------------------------------------------------

/**
 * Check whether a relative path falls within at least one of the declared
 * scope prefixes, using normalize + boundary-suffix matching.
 *
 * Empty scope means "no scope declared: allow all".
 */
export function isInScope(rawPath: string, scope: string[]): boolean {
  if (scope.length === 0) return true;
  const normalized = normalize(rawPath);
  return scope.some((prefix) => {
    const ns = normalize(prefix);
    const boundary = ns.endsWith('/') ? ns : ns + '/';
    return normalized === ns || normalized.startsWith(boundary);
  });
}

/**
 * Pass when the artifact is non-null and non-empty — either it has at least
 * one file, or its text body is a non-empty string.
 */
export const artifactPresent: DeterministicCheck = {
  name: 'artifact-present',
  async run(goal: Goal, artifact: Artifact | null, ctx?: CheckContext): Promise<{ ok: boolean; detail: string }> {
    // A leaf can deliver in two ways: by RETURNING an artifact, or by WRITING files
    // to the worktree via tool calls (write_file). For a tool-driven implement leaf
    // the deliverable IS the file writes — its returned text artifact is often
    // empty. So before rejecting an empty/absent artifact, check whether the leaf
    // actually changed the worktree within its scope. (Surfaced by build run
    // live-self-bd479522: the file_issue implement leaf wrote 14 files via tools but
    // emitted empty text, failed artifact-present, blocked, and its sound code was
    // not collected.)
    const wroteToWorktree = ctx?.sandboxRoot !== undefined
      && worktreeChangedWithinScope(ctx.sandboxRoot, goal.scope);

    if (artifact === null) {
      if (wroteToWorktree) {
        return { ok: true, detail: 'No returned artifact, but the leaf wrote files within scope.' };
      }
      return { ok: false, detail: 'No artifact was produced.' };
    }
    if (artifact.kind === 'files') {
      const files = artifact.files ?? [];
      if (files.length === 0) {
        if (wroteToWorktree) {
          return { ok: true, detail: 'Empty files artifact, but the leaf wrote files within scope.' };
        }
        return { ok: false, detail: 'Artifact has kind "files" but no files were provided.' };
      }
      return { ok: true, detail: `Artifact contains ${files.length} file(s).` };
    }
    // kind === 'text'
    const text = artifact.text ?? '';
    if (text.length === 0) {
      if (wroteToWorktree) {
        return { ok: true, detail: 'Empty text artifact, but the leaf wrote files within scope.' };
      }
      return { ok: false, detail: 'Artifact has kind "text" but the text body is empty.' };
    }
    return { ok: true, detail: 'Artifact contains a non-empty text body.' };
  },
};

/**
 * True if the worktree at `root` has any change (tracked or untracked) under one
 * of the `scope` prefixes. A best-effort, side-effect-free signal that a leaf
 * delivered by writing files rather than by returning an artifact. Any git error
 * (no repo, detached state) returns false — the check then falls back to the
 * artifact-shape rule, exactly as before.
 */
function worktreeChangedWithinScope(root: string, scope: string[]): boolean {
  // Each git query runs independently: in a fresh repo with no commits `git diff
  // HEAD` errors (no HEAD), but an untracked tool-written file must still count, so
  // a failure of one query must not suppress the other.
  const gitLines = (args: string[]): string[] => {
    try {
      return execFileSync('git', ['-C', root, ...args], { stdio: 'pipe', encoding: 'utf-8' })
        .trim().split('\n').filter(Boolean);
    } catch {
      return [];
    }
  };
  const paths = [
    ...gitLines(['diff', '--name-only', 'HEAD']),
    ...gitLines(['ls-files', '--others', '--exclude-standard']),
  ];
  if (paths.length === 0) return false;
  // No scope → any change counts. Otherwise require a change under a prefix.
  if (scope.length === 0) return true;
  return paths.some((p) => isInScope(p, scope));
}

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
    const outOfScope = files.filter((f) => {
      // Reject absolute paths outright.
      if (isAbsolute(f.path)) return true;
      // Reject any path that escapes its directory via ..
      if (normalize(f.path).startsWith('..')) return true;
      return !isInScope(f.path, goal.scope);
    });
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
 * Returns a check that runs a repo-declared script by name via the
 * CheckContext's runScript function and gates on the exit status.
 *
 * Absent ctx (or absent ctx.runScript) → always fails with "no exec context".
 * This is a deliberate fail-safe: a missing context is a configuration error,
 * never a silent pass.
 */
export function runScriptCheck(scriptName: string): DeterministicCheck {
  return {
    name: `run-script:${scriptName}`,
    async run(
      _goal: Goal,
      _artifact: Artifact | null,
      ctx?: CheckContext,
    ): Promise<{ ok: boolean; detail: string }> {
      if (ctx?.runScript === undefined) {
        return { ok: false, detail: 'no exec context' };
      }
      const result = await ctx.runScript(scriptName);
      if (!result.ok) {
        const reason = result.timedOut
          ? 'timed out'
          : result.exitStatus === null
            ? 'error'
            : `exit ${result.exitStatus}`;
        return {
          ok: false,
          detail: `Script "${scriptName}" failed (${reason}): ${result.output}`,
        };
      }
      return {
        ok: true,
        detail: `Script "${scriptName}" passed (exit 0).`,
      };
    },
  };
}

/**
 * `criteriaWellFormed` — the deterministic floor under the milestone-loop ship
 * gate (ADR-032 §2.3). It parses the acceptance-criteria artifact and rejects
 * any criterion whose check is not a sandbox-runnable predicate. The
 * implementation lives in `acceptance-criteria.ts` (it shares that module's
 * parser); it is re-exported here, its spec-named home, so callers import the
 * deterministic floor from the checks library alongside the other checks.
 */
export { criteriaWellFormed } from './acceptance-criteria.js';

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
