/**
 * Moving an OKF issue along its lifecycle (src/library/issue-backlog.ts):
 * record a partial or pending-live-proof fix, or resolve the issue by deleting it.
 *
 * Every transition writes the issue file, its catalog row in
 * `docs/issues/index.md`, and — on resolution — a line in `docs/log.md`
 * together, so the backlog the docs lint checks is consistent by construction.
 * The factory reaches this through the brokered `update_issue` tool; delivery of
 * an issue-sourced commission reaches `resolveIssue` directly.
 */

import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { RESOLUTION_HEADING } from '../library/issue-backlog.js';
import { appendLogEntry } from './docs-log.js';

export const ISSUE_TRANSITIONS = ['partially-fixed', 'fixed-pending-live-proof', 'resolved'] as const;
export type IssueTransition = typeof ISSUE_TRANSITIONS[number];

type ToolResult = { ok: boolean; output: string };

export async function updateIssue(
  sandboxRoot: string,
  args: Record<string, unknown>,
  now: () => number = Date.now,
): Promise<ToolResult> {
  const slug = typeof args['slug'] === 'string' ? args['slug'] : '';
  const status = typeof args['status'] === 'string' ? args['status'] : '';
  const resolution = typeof args['resolution'] === 'string' ? args['resolution'].trim() : '';

  if (!/^[a-zA-Z0-9][-a-zA-Z0-9]*$/.test(slug)) {
    return fail('"slug" must be a safe kebab-case identifier naming an existing issue');
  }
  if (!isTransition(status)) {
    return fail(`"status" must be one of: ${ISSUE_TRANSITIONS.join(', ')}`);
  }
  if (resolution.length === 0) {
    return fail('"resolution" is required: say what landed, where, and what (if anything) remains');
  }
  const issuePath = join(sandboxRoot, 'docs', 'issues', `${slug}.md`);
  if (!existsSync(issuePath)) {
    return fail(`no issue at docs/issues/${slug}.md`);
  }

  const date = new Date(now()).toISOString().slice(0, 10);
  try {
    if (status === 'resolved') {
      resolveIssue(sandboxRoot, slug, resolution, date);
      return { ok: true, output: `update_issue: resolved and deleted docs/issues/${slug}.md; logged in docs/log.md` };
    }
    recordFix(sandboxRoot, slug, status, resolution, date);
    return { ok: true, output: `update_issue: docs/issues/${slug}.md is now ${status}` };
  } catch (err: unknown) {
    return fail(err instanceof Error ? err.message : String(err));
  }
}

/**
 * Set a non-terminal status, append a dated entry to the issue's resolution
 * record, and mirror the status into the catalog row.
 */
export function recordFix(
  root: string,
  slug: string,
  status: Exclude<IssueTransition, 'resolved'>,
  resolution: string,
  date: string,
): void {
  const issuePath = join(root, 'docs', 'issues', `${slug}.md`);
  const content = readFileSync(issuePath, 'utf-8');
  const entry = `**${date} — ${status}.** ${resolution}`;
  writeFileSync(issuePath, appendResolution(setFrontmatterField(content, 'status', status), entry), 'utf-8');
  setCatalogStatus(root, slug, status);
}

/**
 * The terminal transition: the work became code (+ an iteration or ADR), so the
 * issue is deleted, its catalog row removed, and the resolution logged.
 */
export function resolveIssue(root: string, slug: string, resolution: string, date: string): void {
  const issuePath = join(root, 'docs', 'issues', `${slug}.md`);
  if (existsSync(issuePath)) unlinkSync(issuePath);
  removeCatalogRow(root, slug);
  appendLogEntry(root, date, `- **Resolved issue \`${slug}\`** — ${resolution}`);
}

// ---------------------------------------------------------------------------
// Catalog rows
// ---------------------------------------------------------------------------

export function removeCatalogRow(root: string, slug: string): void {
  editCatalog(root, (lines) => lines.filter((line) => !rowPattern(slug).test(line)));
}

function setCatalogStatus(root: string, slug: string, status: string): void {
  editCatalog(root, (lines) =>
    lines.map((line) => {
      if (!rowPattern(slug).test(line)) return line;
      const cells = line.split('|');
      // ['', ' [slug](slug.md) ', ' kind ', ' status ', ' tags ', '']
      if (cells.length >= 6) cells[3] = ` ${status} `;
      return cells.join('|');
    }),
  );
}

function editCatalog(root: string, edit: (lines: string[]) => string[]): void {
  const indexPath = join(root, 'docs', 'issues', 'index.md');
  if (!existsSync(indexPath)) return;
  const before = readFileSync(indexPath, 'utf-8');
  const after = edit(before.split('\n')).join('\n');
  if (after !== before) writeFileSync(indexPath, after, 'utf-8');
}

function rowPattern(slug: string): RegExp {
  const s = slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^\\|\\s*\\[${s}\\]\\(${s}\\.md\\)\\s*\\|`);
}

// ---------------------------------------------------------------------------
// Issue file edits
// ---------------------------------------------------------------------------

function setFrontmatterField(content: string, field: string, value: string): string {
  const lines = content.split('\n');
  const end = lines.slice(1).findIndex((l) => l.trim() === '---') + 1;
  for (let i = 1; i < end; i++) {
    if (lines[i]?.startsWith(`${field}:`)) {
      lines[i] = `${field}: ${value}`;
      return lines.join('\n');
    }
  }
  if (end > 0) lines.splice(end, 0, `${field}: ${value}`);
  return lines.join('\n');
}

/** Append an entry to the end of the `## Resolution` section, creating it at the end of the file if absent. */
function appendResolution(content: string, entry: string): string {
  const lines = content.replace(/\s+$/, '').split('\n');
  const start = lines.findIndex((l) => l.startsWith(RESOLUTION_HEADING));
  if (start === -1) {
    return [...lines, '', RESOLUTION_HEADING, '', entry, ''].join('\n');
  }
  const next = lines.findIndex((l, i) => i > start && /^#{1,2} /.test(l));
  const insertAt = next === -1 ? lines.length : next;
  let tail = insertAt;
  while (tail > start + 1 && (lines[tail - 1] ?? '').trim() === '') tail--;
  lines.splice(tail, insertAt - tail, '', entry, ...(next === -1 ? [] : ['']));
  return lines.join('\n') + '\n';
}

function isTransition(value: string): value is IssueTransition {
  return (ISSUE_TRANSITIONS as readonly string[]).includes(value);
}

function fail(message: string): ToolResult {
  return { ok: false, output: `update_issue: ${message}` };
}
