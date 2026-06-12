/**
 * The process-clean grep set: the single source of truth for the patterns that
 * must never appear in a tree's diff before it reaches the remote. Shared with
 * any judge harness that re-runs the same check (AC-20 / ADR-025).
 *
 * Three categories:
 *   goal-ids        — raw UUID-shaped goal identifiers that would expose the
 *                     factory's internal addressing to the product repo.
 *   plan-refs       — references to iteration plans, build artefacts, and
 *                     factory-internal file paths.
 *   process-language — factory vocabulary that signals the author is the model
 *                     rather than a human developer.
 *
 * The grep set is exported as a `readonly string[]` so it is importable by both
 * `pushBranchTool` (the gate runs here before push) and any judge harness that
 * performs the same hygiene check (single-source, no duplication).
 *
 * Each entry is treated as a literal substring (case-insensitive) by the gate;
 * it is NOT a regex — only `String.prototype.includes` is used so there are no
 * regex-escape pitfalls.
 */

/**
 * Patterns whose presence in a diff line signals factory-internal content that
 * must not reach the remote. The gate runs `line.toLowerCase().includes(pat)`
 * for each pattern in this list.
 */
export const PROCESS_CLEAN_PATTERNS: readonly string[] = [
  // --- goal-id prefixes ---
  // Goal ids are formatted as `<type>/<uuid>` or `<slug>-<8hex>` (sanitizeTreeId).
  // The branch name itself (`tree/<treeId>`) must not bleed into diff content.
  'tree/',

  // --- plan & factory-internal file refs ---
  'build-plan',
  'docs/iterations',
  'docs/adrs',
  '.claude/worktrees',
  'build/06-',
  'feat(tree):',        // collectTree's auto-commit message prefix

  // --- factory process language ---
  // Vocabulary that an LLM author is likely to emit but a human dev would not.
  'goalid',
  'treeid',
  'factoryevent',
  'toolimpl',
  'toolbroker',
  'grant_tool_map',
  'improve-factory',
  'propose-pattern',
  'corellia',           // the factory repo's own name
];

/**
 * Scan a unified diff string (as produced by `git diff`) for any line that
 * contains a process-clean pattern. Only added/context lines are scanned;
 * removed lines (prefixed with `-`) are ignored since they are leaving the tree.
 *
 * Returns `{ ok: true }` when the diff is clean, or
 * `{ ok: false, offenses }` where each offense is `"<file>:<line>: <text>"`.
 *
 * `file` is extracted from the `+++ b/<file>` header lines; `line` is the
 * 1-based line number within the diff output (not the source file's line
 * number — it uniquely locates the finding within the diff for fast human
 * review).
 */
export function scanDiffForProcessLanguage(diff: string): { ok: true } | { ok: false; offenses: string[] } {
  const lines = diff.split('\n');
  const offenses: string[] = [];
  let currentFile = '<unknown>';

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] ?? '';
    const lineNo = i + 1;

    // Track the current file from the +++ header line (unified diff format).
    if (raw.startsWith('+++ b/')) {
      currentFile = raw.slice('+++ b/'.length).trim();
      continue;
    }
    if (raw.startsWith('+++ ')) {
      // Handles `+++ /dev/null` and similar edge cases.
      currentFile = raw.slice(4).trim();
      continue;
    }

    // Only scan added lines ('+') and context lines (space-prefixed or bare).
    // Removed lines ('-') are leaving the tree — not our concern.
    if (raw.startsWith('-') && !raw.startsWith('---')) continue;

    // Strip the diff prefix character ('+', ' ', or none for header lines) for pattern matching.
    const content = raw.startsWith('+') ? raw.slice(1) : raw;
    const lower = content.toLowerCase();

    for (const pat of PROCESS_CLEAN_PATTERNS) {
      if (lower.includes(pat.toLowerCase())) {
        offenses.push(`${currentFile}:${lineNo}: ${raw.trimEnd()}`);
        break; // One offense per line — don't double-count multiple pattern hits.
      }
    }
  }

  if (offenses.length === 0) return { ok: true };
  return { ok: false, offenses };
}
