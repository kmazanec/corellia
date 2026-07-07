/**
 * The frozen acceptance-criteria done-condition (ADR-032): an ordered checklist
 * minted once at round 0 by `author-acceptance-criteria`, re-RUN (not re-judged)
 * every round by the milestone loop (ADR-031). Each criterion names a
 * repo-runnable predicate — a script command or a file/anchor assertion — never
 * a prose rubric line (the deterministic floor, enforced by `criteriaWellFormed`
 * in checks.ts).
 *
 * This module owns the shared parse + the `DeterministicCheck` mapping so both
 * the well-formedness gate (author-time) and the loop's per-round `passingCount`
 * (run-time) read the same shape.
 */

import type { DeterministicCheck } from '../contract/goal-type.js';
import type { Artifact } from '../contract/report.js';
import { extractArtifactPayload } from './knowledge-checks.js';
import { runScriptCheck, sandboxFileContains, isInScope, captureSucceeded } from './checks.js';

/**
 * A repo-runnable predicate: a named script, a file (optionally anchor) assertion,
 * or a named runtime/visual capture (ADR-042). A `{ capture }` names a capture
 * declared up front; the criterion cannot pass unless that capture actually runs
 * and produces output (the deterministic floor), and the name must be in the
 * declared set (validated by `criteriaWellFormed` against `ctx.declaredCaptures`).
 */
export type AcceptanceCheck =
  | { script: string }
  | { file: string; anchor?: string }
  | { capture: string };

/** One acceptance criterion: a stable id, a human claim, and a runnable check. */
export interface AcceptanceCriterion {
  id: string;
  claim: string;
  check: AcceptanceCheck;
}

/**
 * Parse the acceptance-criteria artifact into its ordered criteria list, or a
 * failure detail. Tolerates the same packagings the other artifact parsers do
 * (plain text, fenced block, single-file). Returns the criteria untouched —
 * well-formedness (runnable checks, unique ids) is `criteriaWellFormed`'s job.
 */
export function parseAcceptanceCriteria(
  artifact: Artifact | null,
): { ok: true; criteria: AcceptanceCriterion[] } | { ok: false; detail: string } {
  if (artifact === null) {
    return { ok: false, detail: 'criteria artifact missing or not structured' };
  }
  const text = extractArtifactPayload(artifact);
  if (text === null) {
    return { ok: false, detail: `criteria artifact has no single textual payload (kind "${artifact.kind}")` };
  }
  if (text.length === 0) {
    return { ok: false, detail: 'criteria artifact text is empty' };
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, detail: `criteria artifact is not valid JSON: ${msg}` };
  }
  if (typeof value !== 'object' || value === null) {
    return { ok: false, detail: 'criteria artifact is not an object' };
  }
  const criteria = (value as Record<string, unknown>)['criteria'];
  if (!Array.isArray(criteria)) {
    return { ok: false, detail: 'criteria artifact has no `criteria` array' };
  }
  return { ok: true, criteria: criteria as AcceptanceCriterion[] };
}

/** Whether a parsed value is a well-formed runnable {@link AcceptanceCheck}. */
function isRunnableCheck(check: unknown): check is AcceptanceCheck {
  if (typeof check !== 'object' || check === null) return false;
  const c = check as Record<string, unknown>;
  if (typeof c['script'] === 'string' && c['script'].length > 0) {
    // a script-only check: no stray file key
    return c['file'] === undefined && c['anchor'] === undefined;
  }
  if (typeof c['file'] === 'string' && c['file'].length > 0) {
    // a file assertion; anchor optional but if present must be a non-empty string
    if (c['anchor'] !== undefined && (typeof c['anchor'] !== 'string' || c['anchor'].length === 0)) {
      return false;
    }
    return c['script'] === undefined && c['capture'] === undefined;
  }
  if (typeof c['capture'] === 'string' && c['capture'].length > 0) {
    // a capture check names a declared capture; no stray script/file keys.
    return c['script'] === undefined && c['file'] === undefined && c['anchor'] === undefined;
  }
  return false;
}

/**
 * The deterministic floor (ADR-032 §2). Parses the criteria artifact and FAILS
 * it unless every criterion names a sandbox-runnable predicate. Rejects an empty
 * list, a duplicated/blank id, and — critically — any criterion whose only
 * "check" is a prose rubric line a judge would have to read. This guarantees the
 * loop always has a script-backed, judge-independent boolean per criterion to
 * compute `passingCount` and the DONE check over.
 */
export function criteriaWellFormed(): DeterministicCheck {
  return {
    name: 'criteria-well-formed',
    async run(_goal, artifact, ctx) {
      if (artifact === null || artifact.kind !== 'text') {
        return { ok: false, detail: 'criteria artifact missing or not structured' };
      }
      const parsed = parseAcceptanceCriteria(artifact);
      if (!parsed.ok) return { ok: false, detail: parsed.detail };
      const { criteria } = parsed;
      if (criteria.length === 0) {
        return { ok: false, detail: 'criteria checklist is empty' };
      }
      const declaredCaptures = ctx?.declaredCaptures ?? {};
      const seen = new Set<string>();
      for (let i = 0; i < criteria.length; i++) {
        const c = criteria[i] as Record<string, unknown> | undefined;
        if (typeof c !== 'object' || c === null) {
          return { ok: false, detail: `criterion ${i} is not an object` };
        }
        const id = c['id'];
        if (typeof id !== 'string' || id.trim().length === 0) {
          return { ok: false, detail: `criterion ${i} has a blank or missing id` };
        }
        if (seen.has(id)) {
          return { ok: false, detail: `criterion id "${id}" is duplicated` };
        }
        seen.add(id);
        if (typeof c['claim'] !== 'string' || c['claim'].trim().length === 0) {
          return { ok: false, detail: `criterion "${id}" has a blank or missing claim` };
        }
        if (!isRunnableCheck(c['check'])) {
          return {
            ok: false,
            detail: `criterion "${id}" check is not a runnable predicate ({script}, {file, anchor?}, or {capture}) — a prose rubric line is rejected`,
          };
        }
        // A capture check must name a capture declared up front. An undeclared
        // capture name is rejected at author-time, the same way a prose rubric
        // line is — the model may only select among captures the operator declared.
        const check = c['check'] as Record<string, unknown>;
        if (typeof check['capture'] === 'string' && declaredCaptures[check['capture']] === undefined) {
          const declared = Object.keys(declaredCaptures);
          const known = declared.length > 0 ? declared.join(', ') : '(none declared)';
          return {
            ok: false,
            detail: `criterion "${id}" names capture "${check['capture']}" which is not declared — declared captures: ${known}`,
          };
        }
        // A script check must name a DECLARED script, for the same reason: the
        // runner refuses undeclared names, so a criterion minted with raw
        // command text ("npm run test", "vitest run --exclude ...") can never
        // pass at run time (live-tail run 18: 4 of 11 criteria were dead on
        // arrival this way). Reject at author-time, naming the declared set,
        // while the author can still fix it. Skipped when the context does not
        // carry the declared names (artifact-only callers).
        const declaredScripts = ctx?.declaredScriptNames;
        if (
          typeof check['script'] === 'string' &&
          declaredScripts !== undefined &&
          !declaredScripts.includes(check['script'])
        ) {
          const known = declaredScripts.length > 0 ? declaredScripts.join(', ') : '(none declared)';
          return {
            ok: false,
            detail:
              `criterion "${id}" names script "${check['script']}" which is not in the declared set — ` +
              `a {script} check must be exactly one of the declared script NAMES (${known}), ` +
              `never a shell command line`,
          };
        }
      }
      return { ok: true, detail: `all ${criteria.length} criteria name a runnable predicate` };
    },
  };
}

/**
 * Map one acceptance criterion to the existing {@link DeterministicCheck} that
 * runs it: a `{script}` check reuses `runScriptCheck`; a `{file, anchor?}` check
 * uses `sandboxFileContains` (the anchor is the needle; a bare file assertion
 * uses an empty needle, treated as "file exists"), which reads the round's
 * WORKTREE when a sandbox is in context — the same working tree the script
 * checks run against — and falls back to the artifact file list otherwise.
 * This is how the loop computes `passingCount` against the round's worktree
 * (ADR-031 §4.3).
 */
export function criterionToCheck(criterion: AcceptanceCriterion): DeterministicCheck {
  const check = criterion.check;
  if ('script' in check) {
    return runScriptCheck(check.script);
  }
  if ('capture' in check) {
    return captureSucceeded(check.capture);
  }
  return sandboxFileContains(check.file, check.anchor ?? '');
}

/** Re-export so callers building the criteria scope predicate share one definition. */
export { isInScope };
