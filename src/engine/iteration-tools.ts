/**
 * Post-delivery integration steps for the deliver-intent lifecycle.
 *
 * Fired once on successful delivery at the assembly-emit success boundary
 * (right before collectTree). Both steps are no-ops on blocked/partial delivery.
 *
 * Step 1 — createIterationRecord: creates a date-prefixed iteration record under
 *   docs/iterations/YYYY-MM-DD-HH-slug/index.md with OKF type:iteration frontmatter,
 *   appends a catalog row to docs/iterations/index.md, and appends a one-line
 *   completed-work entry to docs/log.md.
 *
 * Step 2 — deleteProvenanceIssue: when the commissioning goal's spec carries a
 *   provenance annotation "// from docs/issues/<slug>.md", resolves that issue:
 *   deletes the file and removes its row from docs/issues/index.md. An OKF issue
 *   is ephemeral — destroyed when it becomes code, an iteration, and an ADR.
 *
 * Both steps are engine code (not delegated to child goals), fire exactly once
 * per successful delivery, and sit alongside the existing PR-emission integration
 * mechanics.
 */

import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { Goal } from '../contract/goal.js';
import { appendLogEntry } from './docs-log.js';
import { removeCatalogRow } from './issue-updates.js';

// ---------------------------------------------------------------------------
// Date-prefix helpers
// ---------------------------------------------------------------------------

/**
 * Format a timestamp as YYYY-MM-DD-HH — the granularity of the iteration scheme.
 * The hour is the hour at which the delivery completed (the engine's wall clock).
 */
function formatDatePrefix(now: () => number): string {
  const d = new Date(now());
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}-${hh}`;
}

/**
 * Derive a safe kebab-case slug from the goal's title. Lowercases, replaces
 * whitespace and non-alphanumeric runs with a single hyphen, strips leading/
 * trailing hyphens, and caps at 80 characters.
 */
function slugFromTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/[\s]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 80);
}

/**
 * Escape a string for YAML double-quoted scalar. Internal double-quotes are
 * backslash-escaped.
 */
function yamlQuote(raw: string): string {
  return `"${raw.replace(/"/g, '\\"')}"`;
}

/**
 * Format a tags array as a YAML flow sequence.
 */
function yamlTags(tags: string[]): string {
  return `[${tags.join(', ')}]`;
}

// ---------------------------------------------------------------------------
// Step 1 — iteration record
// ---------------------------------------------------------------------------

/**
 * Write the iteration record, append a catalog row to the iterations index, and
 * append a log line to docs/log.md. All writes are sync (engine process, no
 * broker mediation) and idempotent: if the iteration directory already exists
 * the write is skipped (a second delivery of the same intent will not clobber).
 *
 * The iteration slug is derived from the goal's title.
 */
export function createIterationRecord(
  worktreeRoot: string,
  goal: Goal,
  now: () => number,
): void {
  const datePrefix = formatDatePrefix(now);
  const slug = slugFromTitle(goal.title);
  if (slug.length === 0) return; // empty title → no slug → skip

  const dirName = `${datePrefix}-${slug}`;
  const iterDir = join(worktreeRoot, 'docs', 'iterations', dirName);
  const iterFile = join(iterDir, 'index.md');

  // Idempotent: if the iteration directory already exists, skip creation.
  if (existsSync(iterDir)) return;

  mkdirSync(iterDir, { recursive: true });

  const iterTitle = `${goal.title}`;
  const nowIso = new Date(now()).toISOString();

  const frontmatter = [
    '---',
    'type: iteration',
    `title: ${yamlQuote(iterTitle)}`,
    `description: ${yamlQuote(`Delivered: ${goal.title}`)}`,
    `tags: ${yamlTags(['iteration', 'delivered'])}`,
    `timestamp: ${nowIso}`,
    'status: delivered',
    '---',
  ].join('\n');

  const body = [
    '',
    `# ${iterTitle}`,
    '',
    `**Date:** ${datePrefix} · **Status:** Delivered`,
    '',
    `Delivered by the factory from intent \`${goal.id}\`.`,
    '',
  ].join('\n');

  writeFileSync(iterFile, frontmatter + body, 'utf-8');

  // Append a catalog row to docs/iterations/index.md.
  appendIterationIndexRow(worktreeRoot, dirName, iterTitle);

  // Append a one-line log entry to docs/log.md.
  appendLogLine(worktreeRoot, datePrefix, dirName, iterTitle);
}

/**
 * Append a row to docs/iterations/index.md for the new iteration directory.
 * The row is inserted as the last entry in the table (newest last).
 */
function appendIterationIndexRow(
  worktreeRoot: string,
  dirName: string,
  title: string,
): void {
  const indexPath = join(worktreeRoot, 'docs', 'iterations', 'index.md');
  if (!existsSync(indexPath)) return;

  let content = readFileSync(indexPath, 'utf-8');

  // Find the last table row before the closing text. The table is
  // `| [date-dir](date-dir/index.md) | title | status |` — we look for the
  // last `|` line that is a table row (not a separator `|---`).
  const lines = content.split('\n');
  let lastTableRowIdx = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = (lines[i] ?? '').trim();
    if (line.startsWith('|') && !line.match(/^\|[- ]+\|/)) {
      lastTableRowIdx = i;
      break;
    }
  }

  if (lastTableRowIdx === -1) return; // no table rows found

  const newRow = `| [${dirName}](${dirName}/index.md) | ${title} | delivered |`;
  lines.splice(lastTableRowIdx + 1, 0, newRow);
  writeFileSync(indexPath, lines.join('\n'), 'utf-8');
}

/**
 * Append a one-line completed-work entry to docs/log.md under the delivery
 * date, pointing at the iteration record.
 */
function appendLogLine(
  worktreeRoot: string,
  datePrefix: string,
  dirName: string,
  title: string,
): void {
  const logLine = `- **${title}** — delivered ([${dirName}](iterations/${dirName}/index.md)).`;
  appendLogEntry(worktreeRoot, datePrefix.slice(0, 10), logLine);
}

// ---------------------------------------------------------------------------
// Step 2 — provenance-issue deletion
// ---------------------------------------------------------------------------

/**
 * When the goal's spec (stringified) contains a provenance annotation of the form
 * `// from docs/issues/<slug>.md`, resolve that issue: delete it and remove its
 * catalog row from docs/issues/index.md. The delivery's own log line (step 1)
 * records the work. An ephemeral OKF issue is destroyed when it becomes code, an
 * iteration, and an ADR.
 *
 * This is a no-op when the spec does not carry the annotation or the issue is
 * already gone.
 */
export function deleteProvenanceIssue(
  worktreeRoot: string,
  goal: Goal,
): void {
  const slug = extractProvenanceSlug(goal);
  if (slug === null) return;

  const issuePath = join(worktreeRoot, 'docs', 'issues', `${slug}.md`);
  if (existsSync(issuePath)) unlinkSync(issuePath);
  removeCatalogRow(worktreeRoot, slug);
}

/**
 * Extract the issue slug from a provenance annotation in the goal's spec.
 * The annotation is a comment of the form `// from docs/issues/<slug>.md`.
 * Returns null if no such annotation is found.
 */
function extractProvenanceSlug(goal: Goal): string | null {
  // The spec is unknown — stringify it and search for the annotation pattern.
  let specText: string;
  try {
    specText = JSON.stringify(goal.spec) ?? '';
  } catch {
    return null;
  }

  const match = specText.match(/\/\/\s*from\s+docs\/issues\/([a-zA-Z0-9][-a-zA-Z0-9]*)\.md/);
  if (match === null || match[1] === undefined) return null;

  return match[1];
}
