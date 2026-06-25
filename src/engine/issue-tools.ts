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

import { existsSync } from 'node:fs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Goal } from '../contract/goal.js';
import type { ToolImpl } from '../contract/tool.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Valid values for the `kind` frontmatter field. */
const VALID_KINDS = new Set(['bug', 'idea', 'future-work']);

/** Valid values for the `severity` frontmatter field. */
const VALID_SEVERITIES = new Set(['high', 'medium', 'low']);

/** The required fields in the file_issue args. */
const REQUIRED_FIELDS = [
  'slug', 'title', 'description', 'tags', 'kind', 'severity',
  'problem', 'evidence', 'proposedDirection', 'acceptanceHint',
] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * YAML-safe string: if the value contains a newline, double-quote it and
 * escape internal double-quotes. Otherwise return it bare (single-line scalars
 * are safe unquoted in YAML as long as they don't start with YAML-special chars).
 */
function yamlValue(raw: string): string {
  if (raw.includes('\n')) {
    return `"${raw.replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
  }
  // Quote strings that start with a YAML special character or contain a colon
  // followed by a space (which YAML interprets as a mapping).
  if (/^[!&*?|>%@`"',\[\]{}#]/.test(raw) || /:\s/.test(raw)) {
    return `"${raw.replace(/"/g, '\\"')}"`;
  }
  return raw;
}

/**
 * Format a tags array for YAML frontmatter. Returns a YAML flow sequence,
 * e.g. `[foo, bar, baz]`.
 */
function yamlTags(tags: string[]): string {
  return `[${tags.join(', ')}]`;
}

/**
 * Render the frontmatter block for an OKF issue.
 */
function renderFrontmatter(args: Record<string, unknown>): string {
  const lines: string[] = ['---'];
  lines.push('type: issue');
  lines.push(`title: ${yamlValue(String(args['title']))}`);
  lines.push(`description: ${yamlValue(String(args['description']))}`);
  lines.push(`tags: ${yamlTags(args['tags'] as string[])}`);
  lines.push(`timestamp: ${new Date().toISOString()}`);
  lines.push('status: open');
  lines.push(`kind: ${String(args['kind'])}`);
  lines.push(`severity: ${String(args['severity'])}`);
  lines.push('---');
  return lines.join('\n');
}

/**
 * Render the body sections of an OKF issue: title heading, Problem, Evidence,
 * Proposed direction, Acceptance hint.
 */
function renderBody(args: Record<string, unknown>): string {
  const title = String(args['title']);
  const problem = String(args['problem']);
  const evidence = String(args['evidence']);
  const proposedDirection = String(args['proposedDirection']);
  const acceptanceHint = String(args['acceptanceHint']);

  return [
    '',
    `# ${title}`,
    '',
    '## Problem',
    problem,
    '',
    '## Evidence',
    evidence,
    '',
    '## Proposed direction',
    proposedDirection,
    '',
    '## Acceptance hint',
    acceptanceHint,
    '',
  ].join('\n');
}

/**
 * Validate the file_issue args. Returns null if valid, or an error string.
 */
function validateArgs(args: Record<string, unknown>): string | null {
  // Check required fields are present and non-empty.
  for (const field of REQUIRED_FIELDS) {
    const value = args[field];
    if (field === 'tags') {
      if (!Array.isArray(value) || (value as unknown[]).length === 0) {
        return `"tags" must be a non-empty array of strings`;
      }
      for (const tag of value as unknown[]) {
        if (typeof tag !== 'string' || tag.length === 0) {
          return `each tag in "tags" must be a non-empty string`;
        }
      }
      continue;
    }
    if (typeof value !== 'string' || value.length === 0) {
      return `"${field}" is required and must be a non-empty string`;
    }
  }

  // Validate kind.
  const kind = String(args['kind']);
  if (!VALID_KINDS.has(kind)) {
    return `"kind" must be one of: ${[...VALID_KINDS].join(', ')}`;
  }

  // Validate severity.
  const severity = String(args['severity']);
  if (!VALID_SEVERITIES.has(severity)) {
    return `"severity" must be one of: ${[...VALID_SEVERITIES].join(', ')}`;
  }

  // Validate slug: safe filename characters, no path traversal.
  const slug = String(args['slug']);
  if (!/^[a-zA-Z0-9][-a-zA-Z0-9]*$/.test(slug)) {
    return `"slug" must be a safe kebab-case identifier (alphanumeric + hyphens, no leading hyphen)`;
  }

  return null;
}

/**
 * The severity heading under which catalog rows for that severity are listed.
 */
function severityHeading(severity: string): string {
  const cap = severity.charAt(0).toUpperCase() + severity.slice(1);
  return `## ${cap} severity`;
}

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
          kind: { type: 'string', enum: ['bug', 'idea', 'future-work'], description: 'Issue kind.' },
          severity: { type: 'string', enum: ['high', 'medium', 'low'], description: 'Issue severity.' },
          problem: { type: 'string', description: 'Problem section body.' },
          evidence: { type: 'string', description: 'Evidence section body.' },
          proposedDirection: { type: 'string', description: 'Proposed direction section body.' },
          acceptanceHint: { type: 'string', description: 'Acceptance hint section body.' },
        },
        required: REQUIRED_FIELDS as unknown as string[],
      },
    },

    async execute(_goal: Goal, args: Record<string, unknown>): Promise<{ ok: boolean; output: string }> {
      // 1. Validate args.
      const validationError = validateArgs(args);
      if (validationError !== null) {
        return { ok: false, output: `file_issue: ${validationError}` };
      }

      const slug = String(args['slug']);
      const severity = String(args['severity']);
      const kind = String(args['kind']);
      const tags = args['tags'] as string[];

      // 2. Refuse if the slug already exists.
      const issuePath = `docs/issues/${slug}.md`;
      const fullIssuePath = join(sandboxRoot, issuePath);
      if (existsSync(fullIssuePath)) {
        return {
          ok: false,
          output: `file_issue: slug "${slug}" already exists at ${issuePath}`,
        };
      }

      // 3. Write the issue file.
      const frontmatter = renderFrontmatter(args);
      const body = renderBody(args);
      const content = frontmatter + body;

      try {
        await mkdir(dirname(fullIssuePath), { recursive: true });
        await writeFile(fullIssuePath, content, 'utf-8');
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { ok: false, output: `file_issue: failed to write ${issuePath}: ${msg}` };
      }

      // 4. Append catalog row to docs/issues/index.md.
      const indexPath = join(sandboxRoot, 'docs', 'issues', 'index.md');
      let indexContent: string;
      try {
        indexContent = await readFile(indexPath, 'utf-8');
      } catch {
        return {
          ok: false,
          output: 'file_issue: docs/issues/index.md does not exist; cannot append catalog row',
        };
      }

      const catalogRow = `| [${slug}](${slug}.md) | ${kind} | ${tags.join(', ')} |`;
      const heading = severityHeading(severity);

      // Find the severity section and insert the row after the table header.
      const headingIdx = indexContent.indexOf(heading);
      if (headingIdx === -1) {
        return {
          ok: false,
          output: `file_issue: could not find "${heading}" section in docs/issues/index.md`,
        };
      }

      // Find the end of the header line (the `|---|---|---|` separator after the heading).
      const afterHeading = indexContent.slice(headingIdx);
      const headerEnd = afterHeading.indexOf('|---');
      if (headerEnd === -1) {
        return {
          ok: false,
          output: 'file_issue: malformed index.md — no table header separator after severity heading',
        };
      }

      // Find the end of the separator line.
      const sepEnd = afterHeading.indexOf('\n', headerEnd);
      if (sepEnd === -1) {
        return {
          ok: false,
          output: 'file_issue: malformed index.md — table separator not followed by newline',
        };
      }

      // Find the next blank line (end of the table section) or next heading.
      const remaining = afterHeading.slice(sepEnd + 1);
      const nextBlankOrHeading = remaining.search(/\n\s*\n|\n##/);

      let insertIdx: number;
      if (nextBlankOrHeading === -1) {
        // No blank line or heading after — append to end of file.
        insertIdx = indexContent.length;
      } else {
        // Insert before the blank line or heading.
        insertIdx = headingIdx + sepEnd + 1 + nextBlankOrHeading;
      }

      // If inserting before a heading, we need to add the blank line separation.
      const before = indexContent.slice(0, insertIdx);
      const after = indexContent.slice(insertIdx);

      // Determine the separator: if the next thing is a heading, add blank line.
      const needsTrailingBlank = after.trimStart().startsWith('##');

      const newIndex = before +
        (before.endsWith('\n') ? '' : '\n') +
        catalogRow +
        (needsTrailingBlank ? '\n' : '') +
        after;

      try {
        await writeFile(indexPath, newIndex, 'utf-8');
      } catch (err: unknown) {
        // The issue file is written; catalog append is best-effort.
        const msg = err instanceof Error ? err.message : String(err);
        return {
          ok: false,
          output: `file_issue: wrote ${issuePath} but failed to update index.md: ${msg}`,
        };
      }

      return { ok: true, output: `file_issue: wrote ${issuePath}` };
    },
  };
}
