/**
 * The process-clean grep set: the single source of truth for the patterns that
 * must never appear in a tree's diff before it reaches the remote. Shared with
 * any judge harness that re-runs the same check (AC-20 / ADR-025).
 *
 * Pattern split (target-aware gate):
 *
 *   ALWAYS_DANGEROUS — patterns that must NEVER appear in any diff, regardless
 *     of whether the push target is a foreign product repo or the factory's own
 *     repo. Includes goal-ids (which expose the factory's internal addressing),
 *     run-specific plan refs (build/06- branch prefixes, feat(tree): commits),
 *     and worktree path leakage. These are wrong on every repo.
 *
 *   FOREIGN_REPO_ONLY — factory vocabulary that is legitimately present in the
 *     factory's own source code but must not bleed into a foreign product repo's
 *     diff. On the improve-factory path (goal.type === 'improve-factory'), the
 *     target IS the factory's own repo, so diffs of factory files (skill docs,
 *     type definitions, contract files) will necessarily contain this vocabulary.
 *     Blocking it would prevent the factory from self-improving — the opposite of
 *     the intent. On any other path, these patterns indicate a genuine leak.
 *
 * Use `PROCESS_CLEAN_PATTERNS` (the full set) for foreign-repo pushes.
 * Use `ALWAYS_DANGEROUS_PATTERNS` alone for factory-repo (own-repo) pushes.
 *
 * The gate decision MUST be keyed on whether the actual push target IS the
 * factory's own repo (repoSlug === factoryRepoSlug in PushBranchDeps), NOT on
 * goal.type. An improve-factory goal tree that is bound to a foreign repo slug
 * must still receive the full gate — goal.type is not a safe proxy because it
 * is architectural convention, not a runtime-enforced invariant.
 *
 * Two-tier rationale:
 *   ALWAYS_DANGEROUS — blocks run-specific identifiers (tree/ prefixes, worktree
 *     paths, build/06- branch refs, feat(tree): commit prefixes) that are wrong
 *     on every repo. These are never legitimate in committed code.
 *   FOREIGN_REPO_ONLY — blocks factory vocabulary (corellia, improve-factory,
 *     toolimpl, grant_tool_map, docs/iterations, etc.) that IS legitimate in
 *     the factory's own source files but must never bleed into a foreign product
 *     repo's diff. goalid/treeid are here (not in ALWAYS_DANGEROUS) because they
 *     would match TypeScript type names (GoalId, TreeId) in factory source. On
 *     foreign pushes the full set applies, so goalid/treeid substring matches
 *     are still caught. On factory-own-repo pushes only ALWAYS_DANGEROUS applies,
 *     so factory vocabulary (including goalid/treeid as type names) is permitted.
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
 * Patterns that are always dangerous — wrong on every push target, foreign or
 * factory-own. Blocks goal-id leakage (via the `tree/` branch-name prefix that
 * is the canonical goal-id format), run-specific commit-message prefixes, and
 * worktree path leakage that would expose runtime internals.
 *
 * Note: `goalid` and `treeid` as substring patterns are NOT here because they
 * would match legitimate TypeScript type names (`GoalId`, `TreeId`) in factory
 * source code. Actual goal-id leakage in diffs is caught by the `tree/` prefix
 * (the canonical format of both branch names and sanitized tree identifiers).
 */
export const ALWAYS_DANGEROUS_PATTERNS: readonly string[] = [
  // --- goal-id format ---
  // Goal ids appear in diffs as `tree/<uuid>` (branch names, worktree paths).
  // The `tree/` prefix is the canonical indicator; it catches branch-name
  // references (tree/abc12345) that must never appear in committed code.
  'tree/',

  // --- run-specific plan & worktree refs ---
  // Sandbox worktree paths — runtime internals that must never appear in a diff.
  // Both namespaces are matched: the factory's own `.corellia/`, and `.claude/`
  // for repos managed by that harness.
  '.corellia/worktrees',
  '.claude/worktrees',
  'build/06-',
  'feat(tree):',        // collectTree's auto-commit message prefix
];

/**
 * Patterns that are only dangerous on foreign product repo pushes. On the
 * improve-factory path (pushing to the factory's own repo), these terms are
 * legitimate vocabulary that appears in factory source files and must be allowed.
 * On any other path they signal a factory-internal content leak.
 */
export const FOREIGN_REPO_ONLY_PATTERNS: readonly string[] = [
  // --- plan & factory-internal file refs ---
  'build-plan',
  'docs/iterations',
  'docs/adrs',

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
 * The full pattern set for foreign product repo pushes (ALWAYS_DANGEROUS +
 * FOREIGN_REPO_ONLY). Used when `goal.type !== 'improve-factory'`.
 */
export const PROCESS_CLEAN_PATTERNS: readonly string[] = [
  ...ALWAYS_DANGEROUS_PATTERNS,
  ...FOREIGN_REPO_ONLY_PATTERNS,
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
 *
 * The `patterns` parameter selects which pattern set to enforce:
 *   - Omit (or pass `PROCESS_CLEAN_PATTERNS`) for foreign product repo pushes
 *     (the full gate: always-dangerous + foreign-repo-only patterns).
 *   - Pass `ALWAYS_DANGEROUS_PATTERNS` for improve-factory / factory-own-repo
 *     pushes (narrowed gate: goal-ids + run-refs only; factory vocabulary allowed).
 */
export function scanDiffForProcessLanguage(
  diff: string,
  patterns: readonly string[] = PROCESS_CLEAN_PATTERNS,
): { ok: true } | { ok: false; offenses: string[] } {
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

    for (const pat of patterns) {
      if (lower.includes(pat.toLowerCase())) {
        offenses.push(`${currentFile}:${lineNo}: ${raw.trimEnd()}`);
        break; // One offense per line — don't double-count multiple pattern hits.
      }
    }
  }

  if (offenses.length === 0) return { ok: true };
  return { ok: false, offenses };
}
