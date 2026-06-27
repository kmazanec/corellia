/**
 * `file_issue` — the issue-filing brokered write tool (ADR-034).
 *
 * Available to any goal whose type grants `docs.issues.write`. The tool writes
 * an OKF-conformant issue file at `docs/issues/<slug>.md`, validates frontmatter,
 * refuses to overwrite an existing slug, and appends a catalog row to
 * `docs/issues/index.md`.
 *
 * The tool executes in the engine process — no child spawn, no credential access,
 * no network calls. Blast radius: `docs/issues/` only (ephemeral backlog markdown).
 */

import type { Goal } from '../contract/goal.js';
import type { ToolImpl } from '../contract/tool.js';
import { fileIssue, ISSUE_KIND_VALUES, ISSUE_SEVERITY_VALUES, REQUIRED_ISSUE_FIELDS } from './issue-files.js';

// ---------------------------------------------------------------------------
// file_issue ToolImpl factory
// ---------------------------------------------------------------------------

/**
 * Create the `file_issue` ToolImpl bound to a sandbox root. The tool:
 *   1. Validates the args (required fields, kind/severity enums, slug safety).
 *   2. Refuses if `docs/issues/<slug>.md` already exists (no overwrite).
 *   3. Writes the OKF-conformant issue file.
 *   4. Appends a catalog row to `docs/issues/index.md` in the correct severity
 *      section.
 */
export function fileIssueTool(sandboxRoot: string): ToolImpl {
  return {
    def: {
      name: 'file_issue',
      description:
        'File an OKF-conformant issue at docs/issues/<slug>.md. The tool validates ' +
        'frontmatter fields, refuses to overwrite an existing slug, and appends a ' +
        'catalog row to docs/issues/index.md. Available to goals granted docs.issues.write.',
      parameters: {
        type: 'object',
        properties: {
          slug: { type: 'string', description: 'Kebab-case slug for the issue file (e.g. "fix-auth-bug").' },
          title: { type: 'string', description: 'Human-readable issue title.' },
          description: { type: 'string', description: 'One-line summary of the issue.' },
          tags: { type: 'array', items: { type: 'string' }, description: 'Tags for the issue (non-empty).' },
          kind: { type: 'string', enum: ISSUE_KIND_VALUES, description: 'Issue kind.' },
          severity: { type: 'string', enum: ISSUE_SEVERITY_VALUES, description: 'Issue severity.' },
          problem: { type: 'string', description: 'Problem section body.' },
          evidence: { type: 'string', description: 'Evidence section body.' },
          proposedDirection: { type: 'string', description: 'Proposed direction section body.' },
          acceptanceHint: { type: 'string', description: 'Acceptance hint section body.' },
        },
        required: [...REQUIRED_ISSUE_FIELDS],
      },
    },

    async execute(_goal: Goal, args: Record<string, unknown>): Promise<{ ok: boolean; output: string }> {
      return fileIssue(sandboxRoot, args);
    },
  };
}
