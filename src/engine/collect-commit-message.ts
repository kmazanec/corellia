/**
 * Derive a descriptive, conventional-commit message for a collected tree (D1).
 *
 * The old collect commit read `feat(tree): collect worktree <id>` — not
 * conventional, not descriptive. This derives a subject from the root goal's
 * intent (its `title`) and a body listing the goals that contributed, purely
 * mechanically from data already in the goal and the event log — no LLM call.
 */

import type { Goal } from '../contract/goal.js';
import { basename } from 'node:path';

/** One goal that contributed work to a collected tree. */
export interface ContributingGoal {
  id: string;
  title: string;
  type: string;
}

/** Max subject length (git convention: keep the subject line ≤ ~72 chars). */
const SUBJECT_INTENT_CAP = 72;

/**
 * Build the collect commit's subject and body.
 *
 * Subject: `feat(<scope-hint>): <intent>` where the scope-hint is derived from
 * the root goal's declared scope (its first prefix's leading path segment) or,
 * absent scope, the goal type. The intent is the root goal's title, trimmed to a
 * single line and capped.
 *
 * Body: one line per contributing goal (`- <id> <title>`), the root first, so a
 * reviewer sees at a glance which goals folded into this collection.
 */
export function deriveCollectCommitMessage(
  rootGoal: Goal,
  contributing: ContributingGoal[],
): { subject: string; body: string } {
  const scopeHint = deriveScopeHint(rootGoal);
  const intent = truncateIntent(rootGoal.title);
  const subject = `feat(${scopeHint}): ${intent}`;

  const lines = contributing.map((g) => `- ${g.id} (${g.type}): ${firstLine(g.title)}`);
  const body =
    lines.length > 0
      ? `Goals that contributed to this collection:\n${lines.join('\n')}`
      : 'Goals that contributed to this collection: (none recorded)';

  return { subject, body };
}

/**
 * The commit `<scope>` hint. Prefer the leading path segment of the root goal's
 * first declared scope prefix (e.g. `src/tax/**` → `tax`, `public/` → `public`);
 * fall back to the goal type when no usable scope segment exists.
 */
function deriveScopeHint(rootGoal: Goal): string {
  for (const prefix of rootGoal.scope) {
    const segment = leadingScopeSegment(prefix);
    if (segment !== undefined) return segment;
  }
  return sanitizeHint(rootGoal.type);
}

/**
 * The most specific meaningful path segment of a scope prefix. Skips a bare
 * top-level `src`/`app`/`lib`/`pkg` in favor of the segment below it (that is
 * where the meaning lives), and drops glob/trailing markers.
 */
function leadingScopeSegment(prefix: string): string | undefined {
  const segments = prefix
    .split('/')
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s !== '**' && s !== '*');
  if (segments.length === 0) return undefined;

  const GENERIC_ROOTS = new Set(['src', 'app', 'lib', 'pkg']);
  const pick = segments.length > 1 && GENERIC_ROOTS.has(segments[0]!) ? segments[1]! : segments[0]!;
  const hint = sanitizeHint(basename(pick));
  return hint.length > 0 ? hint : undefined;
}

/** Reduce a raw hint to a conventional-commit scope token (lowercase, dashed). */
function sanitizeHint(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/** Trim the intent to one line and cap it at the subject length. */
function truncateIntent(title: string): string {
  const line = firstLine(title);
  if (line.length <= SUBJECT_INTENT_CAP) return line;
  return line.slice(0, SUBJECT_INTENT_CAP - 1).trimEnd() + '…';
}

function firstLine(text: string): string {
  const line = text.split('\n')[0]?.trim() ?? '';
  return line.length > 0 ? line : '(untitled)';
}
