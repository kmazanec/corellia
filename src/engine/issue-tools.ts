/**
 * `file_issue` and `update_issue` — the brokered backlog tools (ADR-034).
 *
 * `update_issue` moves an issue along its lifecycle (src/library/issue-backlog.ts):
 * partially-fixed / fixed-pending-live-proof record what landed under the
 * issue's `## Resolution` section and mirror the status into the catalog;
 * resolved deletes the issue, removes its catalog row, and logs the resolution.
 *
 * `file_issue`:
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
import { ISSUE_TRANSITIONS, updateIssue } from './issue-updates.js';

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

// ---------------------------------------------------------------------------
// update_issue ToolImpl factory
// ---------------------------------------------------------------------------

/**
 * Create the `update_issue` ToolImpl bound to a sandbox root. A goal that lands
 * work against an issue records it here in the same run, so the backlog never
 * says `open` about shipped work.
 */
export function updateIssueTool(sandboxRoot: string, now: () => number = Date.now): ToolImpl {
  return {
    def: {
      name: 'update_issue',
      description:
        'Move an existing issue in docs/issues/ along its lifecycle after landing work against it. ' +
        '"partially-fixed" (some of it landed) and "fixed-pending-live-proof" (all of it landed, ' +
        'not yet proven in a live run) append your resolution note under the issue\'s "## Resolution" ' +
        'section and update its catalog row. "resolved" (landed and proven) deletes the issue, ' +
        'removes its catalog row, and records the resolution in docs/log.md. ' +
        'Available to goals granted docs.issues.write.',
      parameters: {
        type: 'object',
        properties: {
          slug: { type: 'string', description: 'Slug of the existing issue (docs/issues/<slug>.md).' },
          status: { type: 'string', enum: [...ISSUE_TRANSITIONS], description: 'The lifecycle step reached.' },
          resolution: {
            type: 'string',
            description: 'What landed (files, ADR, iteration) and what, if anything, remains open.',
          },
        },
        required: ['slug', 'status', 'resolution'],
      },
    },

    async execute(_goal: Goal, args: Record<string, unknown>): Promise<{ ok: boolean; output: string }> {
      return updateIssue(sandboxRoot, args, now);
    },
  };
}
