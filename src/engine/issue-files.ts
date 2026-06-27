import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/** Valid values for the `kind` frontmatter field. */
const VALID_KINDS = ['bug', 'idea', 'future-work'] as const;

/** Valid values for the `severity` frontmatter field. */
const VALID_SEVERITIES = ['high', 'medium', 'low'] as const;

export const REQUIRED_ISSUE_FIELDS = [
  'slug', 'title', 'description', 'tags', 'kind', 'severity',
  'problem', 'evidence', 'proposedDirection', 'acceptanceHint',
] as const;

type IssueKind = typeof VALID_KINDS[number];
type IssueSeverity = typeof VALID_SEVERITIES[number];

export type IssueFileArgs = {
  slug: string;
  title: string;
  description: string;
  tags: string[];
  kind: IssueKind;
  severity: IssueSeverity;
  problem: string;
  evidence: string;
  proposedDirection: string;
  acceptanceHint: string;
};

type ParseResult =
  | { ok: true; value: IssueFileArgs }
  | { ok: false; error: string };

type ToolResult = { ok: boolean; output: string };
type CatalogInsertResult =
  | { ok: true; content: string }
  | { ok: false; error: string };

export const ISSUE_KIND_VALUES = [...VALID_KINDS];
export const ISSUE_SEVERITY_VALUES = [...VALID_SEVERITIES];

export async function fileIssue(sandboxRoot: string, args: Record<string, unknown>): Promise<ToolResult> {
  const parsed = parseIssueFileArgs(args);
  if (!parsed.ok) {
    return { ok: false, output: `file_issue: ${parsed.error}` };
  }

  const issuePath = `docs/issues/${parsed.value.slug}.md`;
  const fullIssuePath = join(sandboxRoot, issuePath);
  if (existsSync(fullIssuePath)) {
    return {
      ok: false,
      output: `file_issue: slug "${parsed.value.slug}" already exists at ${issuePath}`,
    };
  }

  const writeResult = await writeIssueFile(fullIssuePath, issuePath, parsed.value);
  if (!writeResult.ok) {
    return writeResult;
  }

  const catalogResult = await appendCatalogRow(sandboxRoot, parsed.value);
  if (!catalogResult.ok) {
    return catalogResult;
  }

  return { ok: true, output: `file_issue: wrote ${issuePath}` };
}

function parseIssueFileArgs(args: Record<string, unknown>): ParseResult {
  const requiredError = validateRequiredFields(args);
  if (requiredError !== null) {
    return { ok: false, error: requiredError };
  }

  const kind = String(args['kind']);
  if (!isIssueKind(kind)) {
    return { ok: false, error: `"kind" must be one of: ${VALID_KINDS.join(', ')}` };
  }

  const severity = String(args['severity']);
  if (!isIssueSeverity(severity)) {
    return { ok: false, error: `"severity" must be one of: ${VALID_SEVERITIES.join(', ')}` };
  }

  const slug = String(args['slug']);
  if (!/^[a-zA-Z0-9][-a-zA-Z0-9]*$/.test(slug)) {
    return { ok: false, error: '"slug" must be a safe kebab-case identifier (alphanumeric + hyphens, no leading hyphen)' };
  }

  return {
    ok: true,
    value: {
      slug,
      title: String(args['title']),
      description: String(args['description']),
      tags: args['tags'] as string[],
      kind,
      severity,
      problem: String(args['problem']),
      evidence: String(args['evidence']),
      proposedDirection: String(args['proposedDirection']),
      acceptanceHint: String(args['acceptanceHint']),
    },
  };
}

function validateRequiredFields(args: Record<string, unknown>): string | null {
  for (const field of REQUIRED_ISSUE_FIELDS) {
    const value = args[field];
    if (field === 'tags') {
      const tagsError = validateTags(value);
      if (tagsError !== null) {
        return tagsError;
      }
      continue;
    }
    if (typeof value !== 'string' || value.length === 0) {
      return `"${field}" is required and must be a non-empty string`;
    }
  }
  return null;
}

function validateTags(value: unknown): string | null {
  if (!Array.isArray(value) || value.length === 0) {
    return '"tags" must be a non-empty array of strings';
  }
  for (const tag of value) {
    if (typeof tag !== 'string' || tag.length === 0) {
      return 'each tag in "tags" must be a non-empty string';
    }
  }
  return null;
}

async function writeIssueFile(fullIssuePath: string, issuePath: string, args: IssueFileArgs): Promise<ToolResult> {
  try {
    await mkdir(dirname(fullIssuePath), { recursive: true });
    await writeFile(fullIssuePath, renderIssueFile(args), 'utf-8');
    return { ok: true, output: `file_issue: wrote ${issuePath}` };
  } catch (err: unknown) {
    return { ok: false, output: `file_issue: failed to write ${issuePath}: ${errorMessage(err)}` };
  }
}

function renderIssueFile(args: IssueFileArgs): string {
  return renderFrontmatter(args) + renderBody(args);
}

function renderFrontmatter(args: IssueFileArgs): string {
  return [
    '---',
    'type: issue',
    `title: ${yamlValue(args.title)}`,
    `description: ${yamlValue(args.description)}`,
    `tags: ${yamlTags(args.tags)}`,
    `timestamp: ${new Date().toISOString()}`,
    'status: open',
    `kind: ${args.kind}`,
    `severity: ${args.severity}`,
    '---',
  ].join('\n');
}

function renderBody(args: IssueFileArgs): string {
  return [
    '',
    `# ${args.title}`,
    '',
    '## Problem',
    args.problem,
    '',
    '## Evidence',
    args.evidence,
    '',
    '## Proposed direction',
    args.proposedDirection,
    '',
    '## Acceptance hint',
    args.acceptanceHint,
    '',
  ].join('\n');
}

async function appendCatalogRow(sandboxRoot: string, args: IssueFileArgs): Promise<ToolResult> {
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

  const insertResult = insertCatalogRow(indexContent, args);
  if (!insertResult.ok) {
    return { ok: false, output: insertResult.error };
  }

  try {
    await writeFile(indexPath, insertResult.content, 'utf-8');
    return { ok: true, output: 'file_issue: updated docs/issues/index.md' };
  } catch (err: unknown) {
    return {
      ok: false,
      output: `file_issue: wrote docs/issues/${args.slug}.md but failed to update index.md: ${errorMessage(err)}`,
    };
  }
}

function insertCatalogRow(indexContent: string, args: IssueFileArgs): CatalogInsertResult {
  const heading = severityHeading(args.severity);
  const headingIdx = indexContent.indexOf(heading);
  if (headingIdx === -1) {
    return { ok: false, error: `file_issue: could not find "${heading}" section in docs/issues/index.md` };
  }

  const afterHeading = indexContent.slice(headingIdx);
  const headerEnd = afterHeading.indexOf('|---');
  if (headerEnd === -1) {
    return { ok: false, error: 'file_issue: malformed index.md — no table header separator after severity heading' };
  }

  const sepEnd = afterHeading.indexOf('\n', headerEnd);
  if (sepEnd === -1) {
    return { ok: false, error: 'file_issue: malformed index.md — table separator not followed by newline' };
  }

  const remaining = afterHeading.slice(sepEnd + 1);
  const nextBlankOrHeading = remaining.search(/\n\s*\n|\n##/);
  const insertIdx = nextBlankOrHeading === -1
    ? indexContent.length
    : headingIdx + sepEnd + 1 + nextBlankOrHeading;

  return {
    ok: true,
    content: renderCatalogInsert(indexContent, insertIdx, catalogRow(args)),
  };
}

function renderCatalogInsert(indexContent: string, insertIdx: number, row: string): string {
  const before = indexContent.slice(0, insertIdx);
  const after = indexContent.slice(insertIdx);
  const needsTrailingBlank = after.trimStart().startsWith('##');
  return before +
    (before.endsWith('\n') ? '' : '\n') +
    row +
    (needsTrailingBlank ? '\n' : '') +
    after;
}

function catalogRow(args: IssueFileArgs): string {
  return `| [${args.slug}](${args.slug}.md) | ${args.kind} | ${args.tags.join(', ')} |`;
}

function severityHeading(severity: IssueSeverity): string {
  const cap = severity.charAt(0).toUpperCase() + severity.slice(1);
  return `## ${cap} severity`;
}

function yamlValue(raw: string): string {
  if (raw.includes('\n')) {
    return `"${raw.replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
  }
  if (/^[!&*?|>%@`"',\[\]{}#]/.test(raw) || /:\s/.test(raw)) {
    return `"${raw.replace(/"/g, '\\"')}"`;
  }
  return raw;
}

function yamlTags(tags: string[]): string {
  return `[${tags.join(', ')}]`;
}

function isIssueKind(value: string): value is IssueKind {
  return (VALID_KINDS as readonly string[]).includes(value);
}

function isIssueSeverity(value: string): value is IssueSeverity {
  return (VALID_SEVERITIES as readonly string[]).includes(value);
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
