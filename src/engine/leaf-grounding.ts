import { existsSync, readdirSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import type { CheckContext } from '../contract/goal-type.js';

/**
 * What a leaf's declared scope gives it to stand on at authoring time.
 *
 * A region-anchored explore-then-emit leaf calibrates by reading its scope. When
 * every scope entry is absent from the worktree (or an empty directory), there
 * is nothing to read: the deliverable does not exist yet. Such a leaf is
 * GREENFIELD — its only ground truth is the goal spec, and a survey of the host
 * repo cannot find anchors that do not exist (daemon proof runs 4-6: an
 * acceptance-criteria leaf with an empty scope read 50-92 host files to the tree
 * deadline and never emitted).
 */
export type ScopeGrounding =
  | { kind: 'grounded' }
  | { kind: 'greenfield'; absent: string[] };

/** Directory entries that do not make a directory "populated". */
const PLACEHOLDER_ENTRIES: ReadonlySet<string> = new Set(['.gitkeep', '.keep']);

/**
 * Classify a leaf's scope against its sandbox root. Greenfield only when the
 * scope is non-empty and EVERY entry is absent or an empty directory; a scope
 * with any existing content is grounded. Without a sandbox root nothing can be
 * observed, so the leaf is treated as grounded.
 */
export function groundScope(root: string | undefined, scope: readonly string[]): ScopeGrounding {
  if (root === undefined || scope.length === 0) return { kind: 'grounded' };
  const absent: string[] = [];
  for (const entry of scope) {
    const path = resolve(root, entry);
    const rel = relative(root, path);
    if (rel.startsWith('..') || isAbsolute(rel)) return { kind: 'grounded' };
    if (!isAbsentOrEmpty(path)) return { kind: 'grounded' };
    absent.push(entry);
  }
  return { kind: 'greenfield', absent };
}

function isAbsentOrEmpty(path: string): boolean {
  if (!existsSync(path)) return true;
  if (!statSync(path).isDirectory()) return false;
  return readdirSync(path).every((name) => PLACEHOLDER_ENTRIES.has(name));
}

/**
 * The runnable-check vocabulary a tree declares: the script and capture NAMES an
 * acceptance criterion may reference. `criteriaWellFormed` rejects any other
 * name at author time; showing the vocabulary up front means the author never
 * has to discover it by reading (the names live in the tree's configuration,
 * not in any file the leaf can open).
 */
export interface CheckVocabulary {
  scriptNames: readonly string[];
  captureNames: readonly string[];
}

export function checkVocabularyFrom(ctx: CheckContext | undefined): CheckVocabulary | undefined {
  if (ctx === undefined) return undefined;
  return {
    scriptNames: ctx.declaredScriptNames ?? [],
    captureNames: Object.keys(ctx.declaredCaptures ?? {}),
  };
}

/** The context block naming exactly which check shapes and names are available. */
export function checkVocabularyBlock(vocabulary: CheckVocabulary | undefined): string {
  if (vocabulary === undefined) return '';
  const scripts =
    vocabulary.scriptNames.length > 0
      ? `{ script } checks may name ONLY these declared scripts: ${vocabulary.scriptNames.join(', ')}.`
      : `No scripts are declared for this tree — do NOT emit any { script } check.`;
  const captures =
    vocabulary.captureNames.length > 0
      ? `{ capture } checks may name ONLY these declared captures: ${vocabulary.captureNames.join(', ')}.`
      : `No captures are declared for this tree — do NOT emit any { capture } check.`;
  return (
    `\n\nCHECK VOCABULARY (authoritative — this is the complete set; it is configured ` +
    `for the tree, not written in any repo file, so do not read the repo looking for more):\n` +
    `- ${scripts}\n- ${captures}\n` +
    `- { file, anchor? } checks are always available: the path must exist in the ` +
    `worktree (and contain the anchor substring, when given).`
  );
}

/** The context block that re-grounds a greenfield leaf in its spec. */
export function greenfieldScopeBlock(grounding: ScopeGrounding): string {
  if (grounding.kind !== 'greenfield') return '';
  return (
    `\n\nGREENFIELD SCOPE: your declared scope (${grounding.absent.join(', ')}) does not ` +
    `exist in the worktree yet — the deliverable has not been built. There is nothing in ` +
    `the repo to calibrate against: the SPEC above is your only ground truth. Do NOT survey ` +
    `the host repo for anchors, conventions, or examples; they cannot tell you what the new ` +
    `deliverable will contain. Derive the artifact from the spec alone — at most a few reads ` +
    `(e.g. listing the scope's parent directory) — then emit.`
  );
}
