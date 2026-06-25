/**
 * OKF docs lint — scans the docs/ tree for OKF-conformant frontmatter and
 * reports violations. Hard-fails (exit 1) on missing required fields; warns
 * on missing recommended fields.
 *
 * Reserved files (exempt from the type requirement):
 *   - docs/index.md
 *   - docs/log.md
 *   - docs/** /index.md  (any catalog index)
 *
 * Required fields (hard-fail):
 *   - type            (all non-reserved docs/** /*.md)
 *   - kind, severity, status  (docs/issues/*.md only)
 *
 * Recommended fields (warn):
 *   - title, description, tags, timestamp
 *
 * Usage:  tsx scripts/lint-docs.ts [docsRoot]
 *         Defaults to "docs" when no argument is given.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';

// ── Types ─────────────────────────────────────────────────────────────────

interface LintViolation {
  file: string;
  field: string;
}

interface LintResult {
  hardViolations: LintViolation[];
  warnings: LintViolation[];
}

// ── Helpers ───────────────────────────────────────────────────────────────

/**
 * Returns true when `relPath` (relative to the docs root) names a reserved
 * OKF file: the root index, the log, or any catalog index deeper in the tree.
 */
function isReserved(relPath: string): boolean {
  if (relPath === 'index.md' || relPath === 'log.md') return true;
  return basename(relPath) === 'index.md';
}

/**
 * Parse the YAML frontmatter block between the first two `---` lines.
 * Returns a Map of key → trimmed value.  Values are preserved as raw strings;
 * the lint only checks for presence, not type-correctness.
 */
function parseFrontmatter(content: string): Map<string, string> {
  const fm = new Map<string, string>();
  const lines = content.split('\n');

  if (lines.length === 0 || lines[0]?.trim() !== '---') return fm;

  const endIdx = lines.slice(1).findIndex((l) => l.trim() === '---');
  if (endIdx === -1) return fm;

  const fmLines = lines.slice(1, endIdx + 1);

  for (const line of fmLines) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();
    if (key) fm.set(key, value);
  }

  return fm;
}

// ── Core lint ─────────────────────────────────────────────────────────────

/**
 * Scan every `*.md` file under `docsRoot`, skipping reserved files.
 * Returns hard violations (must fix) and warnings (should fix).
 */
export function lintDocs(docsRoot: string): LintResult {
  const hardViolations: LintViolation[] = [];
  const warnings: LintViolation[] = [];

  // Collect every .md file relative to docsRoot.
  const mdFiles: string[] = [];
  function walk(dir: string, relDir: string): void {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // missing docs root — nothing to lint
    }
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      const relPath = relDir ? join(relDir, entry.name) : entry.name;
      if (entry.isDirectory()) {
        walk(fullPath, relPath);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        mdFiles.push(relPath);
      }
    }
  }
  walk(docsRoot, '');

  for (const relPath of mdFiles) {
    if (isReserved(relPath)) continue;

    const fullPath = join(docsRoot, relPath);
    let content: string;
    try {
      content = readFileSync(fullPath, 'utf-8');
    } catch {
      hardViolations.push({ file: relPath, field: '(unreadable)' });
      continue;
    }

    const fm = parseFrontmatter(content);

    // ── Hard requirements ──────────────────────────────────────────────

    const type = fm.get('type');
    if (!type || type.length === 0) {
      hardViolations.push({ file: relPath, field: 'type' });
    }

    // Issues carry three additional required fields.
    if (relPath.startsWith('issues/') || relPath.startsWith('issues\\')) {
      for (const field of ['kind', 'severity', 'status']) {
        const val = fm.get(field);
        if (!val || val.length === 0) {
          hardViolations.push({ file: relPath, field });
        }
      }
    }

    // ── Recommended fields ─────────────────────────────────────────────

    for (const field of ['title', 'description', 'tags', 'timestamp']) {
      const val = fm.get(field);
      if (!val || val.length === 0) {
        warnings.push({ file: relPath, field });
      }
    }
  }

  return { hardViolations, warnings };
}

// ── CLI entry point ───────────────────────────────────────────────────────

const scriptPath = process.argv[1];
const isMain =
  scriptPath != null &&
  (scriptPath.endsWith('lint-docs.ts') || scriptPath.endsWith('lint-docs.js'));

if (isMain) {
  const docsRoot = process.argv[2] ?? 'docs';
  const { hardViolations, warnings } = lintDocs(docsRoot);

  for (const w of warnings) {
    console.error(`WARNING: ${w.file} — missing recommended field "${w.field}"`);
  }

  if (hardViolations.length > 0) {
    for (const v of hardViolations) {
      console.error(`ERROR: ${v.file} — missing required field "${v.field}"`);
    }
    console.error(
      `docs lint: FAILED (${hardViolations.length} hard violation(s))`,
    );
    process.exit(1);
  }

  console.log('docs lint: ok');
}