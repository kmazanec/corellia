/**
 * The OKF issue backlog as data: the lifecycle vocabulary, the catalog row
 * shape, and the consistency rules that keep `docs/issues/` honest.
 *
 * An issue is ephemeral. Its lifecycle is a closed set of statuses; the terminal
 * state is not a status but deletion (the work became code + an iteration/ADR,
 * recorded as a line in `docs/log.md`):
 *
 *   open ──► partially-fixed ──► fixed-pending-live-proof ──► (deleted)
 *
 * Any non-open issue carries a `## Resolution` section naming what landed and
 * what remains. The catalog (`docs/issues/index.md`) carries one row per issue,
 * under its severity heading, with the same kind and status as the file.
 *
 * Both writers of the backlog — the factory's brokered tools (`file_issue`,
 * `update_issue`, provenance deletion on delivery) and a hand-building agent —
 * are held to these rules by `checkIssueBacklog`, which the docs lint runs in the
 * repo's own gate. The lint is what makes drift a red build instead of a stale
 * backlog.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const ISSUE_KINDS = ['bug', 'idea', 'future-work'] as const;
export const ISSUE_SEVERITIES = ['high', 'medium', 'low'] as const;
export const ISSUE_STATUSES = ['open', 'partially-fixed', 'fixed-pending-live-proof'] as const;

export type IssueKind = typeof ISSUE_KINDS[number];
export type IssueSeverity = typeof ISSUE_SEVERITIES[number];
export type IssueStatus = typeof ISSUE_STATUSES[number];

/** The heading that opens an issue's resolution record. */
export const RESOLUTION_HEADING = '## Resolution';

/** The catalog table header every severity section uses. */
export const CATALOG_TABLE_HEADER = '| Issue | Kind | Status | Tags |';
export const CATALOG_TABLE_SEPARATOR = '|---|---|---|---|';

export function isIssueKind(value: string): value is IssueKind {
  return (ISSUE_KINDS as readonly string[]).includes(value);
}

export function isIssueSeverity(value: string): value is IssueSeverity {
  return (ISSUE_SEVERITIES as readonly string[]).includes(value);
}

export function isIssueStatus(value: string): value is IssueStatus {
  return (ISSUE_STATUSES as readonly string[]).includes(value);
}

export function severityHeading(severity: IssueSeverity): string {
  return `## ${severity.charAt(0).toUpperCase()}${severity.slice(1)} severity`;
}

export type CatalogRowFields = {
  slug: string;
  kind: string;
  status: string;
  tags: readonly string[];
};

export function catalogRow(row: CatalogRowFields): string {
  return `| [${row.slug}](${row.slug}.md) | ${row.kind} | ${row.status} | ${row.tags.join(', ')} |`;
}

// ---------------------------------------------------------------------------
// Reading an issue file
// ---------------------------------------------------------------------------

export type IssueFileFacts = {
  slug: string;
  frontmatter: Map<string, string>;
  hasResolutionSection: boolean;
  hasUnfiledResolutionNote: boolean;
};

/**
 * A bold lead-in on a blockquote line that announces a fix ("> **Fixed …",
 * "> **Implemented …", "> **Diagnosis half fixed-pending-live-proof …"). On an
 * `open` issue it means work landed without the status moving.
 */
const RESOLUTION_NOTE = /^>\s*\*\*[^*]*\b(fixed|implemented|resolved|landed|shipped|built)\b/i;

export function readIssueFacts(slug: string, content: string): IssueFileFacts {
  const lines = content.split('\n');
  return {
    slug,
    frontmatter: parseFrontmatter(lines),
    hasResolutionSection: lines.some((l) => l.startsWith(RESOLUTION_HEADING)),
    hasUnfiledResolutionNote: lines.some((l) => RESOLUTION_NOTE.test(l)),
  };
}

export function parseFrontmatter(lines: readonly string[]): Map<string, string> {
  const fm = new Map<string, string>();
  if (lines[0]?.trim() !== '---') return fm;
  const end = lines.slice(1).findIndex((l) => l.trim() === '---');
  if (end === -1) return fm;
  for (const line of lines.slice(1, end + 1)) {
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    if (key) fm.set(key, line.slice(colon + 1).trim());
  }
  return fm;
}

// ---------------------------------------------------------------------------
// Reading the catalog
// ---------------------------------------------------------------------------

export type CatalogEntry = {
  slug: string;
  section: string | null;
  kind: string;
  status: string;
  line: number;
};

const CATALOG_ROW = /^\|\s*\[([^\]]+)\]\(([^)]+)\.md\)\s*\|([^|]*)\|([^|]*)\|/;

export function parseCatalog(content: string): CatalogEntry[] {
  const entries: CatalogEntry[] = [];
  let section: string | null = null;
  content.split('\n').forEach((line, i) => {
    if (line.startsWith('## ')) section = line.trim();
    const m = CATALOG_ROW.exec(line);
    if (m === null) return;
    entries.push({
      slug: m[2] ?? '',
      section,
      kind: (m[3] ?? '').trim(),
      status: (m[4] ?? '').trim(),
      line: i + 1,
    });
  });
  return entries;
}

// ---------------------------------------------------------------------------
// The consistency check
// ---------------------------------------------------------------------------

export type BacklogViolation = { file: string; rule: string; detail: string };

/**
 * Check every issue under `<docsRoot>/issues/` against the lifecycle rules and
 * the catalog. Returns one violation per broken rule; an empty list is a
 * consistent backlog. A docs tree with no issues directory is trivially clean.
 */
export function checkIssueBacklog(docsRoot: string): BacklogViolation[] {
  const issuesDir = join(docsRoot, 'issues');
  if (!existsSync(issuesDir)) return [];

  const issues = readdirSync(issuesDir)
    .filter((name) => name.endsWith('.md') && name !== 'index.md')
    .map((name) => {
      const slug = name.slice(0, -'.md'.length);
      return readIssueFacts(slug, readFileSync(join(issuesDir, name), 'utf-8'));
    });

  const indexPath = join(issuesDir, 'index.md');
  const catalog = existsSync(indexPath) ? parseCatalog(readFileSync(indexPath, 'utf-8')) : null;

  return [
    ...issues.flatMap(lifecycleViolations),
    ...(catalog === null
      ? issues.length > 0
        ? [{ file: 'issues/index.md', rule: 'catalog-missing', detail: 'issues exist but the catalog does not' }]
        : []
      : catalogViolations(issues, catalog)),
  ];
}

function lifecycleViolations(issue: IssueFileFacts): BacklogViolation[] {
  const file = `issues/${issue.slug}.md`;
  const out: BacklogViolation[] = [];
  const kind = issue.frontmatter.get('kind') ?? '';
  const severity = issue.frontmatter.get('severity') ?? '';
  const status = issue.frontmatter.get('status') ?? '';

  if (kind && !isIssueKind(kind)) {
    out.push({ file, rule: 'kind-vocabulary', detail: `kind "${kind}" is not one of ${ISSUE_KINDS.join(', ')}` });
  }
  if (severity && !isIssueSeverity(severity)) {
    out.push({ file, rule: 'severity-vocabulary', detail: `severity "${severity}" is not one of ${ISSUE_SEVERITIES.join(', ')}` });
  }
  if (status && !isIssueStatus(status)) {
    out.push({
      file,
      rule: 'status-vocabulary',
      detail: `status "${status}" is not one of ${ISSUE_STATUSES.join(', ')} (a finished issue is deleted, not marked done)`,
    });
  }
  if (status === 'open' && issue.hasResolutionSection) {
    out.push({ file, rule: 'open-with-resolution', detail: `status is open but the issue has a "${RESOLUTION_HEADING}" section — set status to partially-fixed or fixed-pending-live-proof` });
  }
  if (status === 'open' && issue.hasUnfiledResolutionNote) {
    out.push({ file, rule: 'open-with-fix-note', detail: 'status is open but the body carries a fix note — move it under "## Resolution" and set the status' });
  }
  if (status !== 'open' && isIssueStatus(status) && !issue.hasResolutionSection) {
    out.push({ file, rule: 'resolution-missing', detail: `status is ${status} but there is no "${RESOLUTION_HEADING}" section saying what landed and what remains` });
  }
  return out;
}

function catalogViolations(issues: IssueFileFacts[], catalog: CatalogEntry[]): BacklogViolation[] {
  const out: BacklogViolation[] = [];
  const bySlug = new Map<string, CatalogEntry[]>();
  for (const entry of catalog) {
    bySlug.set(entry.slug, [...(bySlug.get(entry.slug) ?? []), entry]);
  }

  for (const issue of issues) {
    const file = `issues/${issue.slug}.md`;
    const rows = bySlug.get(issue.slug) ?? [];
    if (rows.length === 0) {
      out.push({ file, rule: 'catalog-row-missing', detail: 'no row in issues/index.md' });
      continue;
    }
    if (rows.length > 1) {
      out.push({ file, rule: 'catalog-row-duplicated', detail: `${rows.length} rows in issues/index.md` });
    }
    const row = rows[0]!;
    const severity = issue.frontmatter.get('severity') ?? '';
    if (isIssueSeverity(severity) && row.section !== severityHeading(severity)) {
      out.push({ file, rule: 'catalog-section', detail: `row sits under "${row.section ?? '(none)'}" but severity is ${severity}` });
    }
    const kind = issue.frontmatter.get('kind') ?? '';
    if (row.kind !== kind) {
      out.push({ file, rule: 'catalog-kind', detail: `catalog says kind "${row.kind}", file says "${kind}"` });
    }
    const status = issue.frontmatter.get('status') ?? '';
    if (row.status !== status) {
      out.push({ file, rule: 'catalog-status', detail: `catalog says status "${row.status}", file says "${status}"` });
    }
  }

  const known = new Set(issues.map((i) => i.slug));
  for (const entry of catalog) {
    if (!known.has(entry.slug)) {
      out.push({ file: 'issues/index.md', rule: 'catalog-row-orphaned', detail: `line ${entry.line} lists "${entry.slug}" but issues/${entry.slug}.md does not exist` });
    }
  }
  return out;
}
