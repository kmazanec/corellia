import { existsSync, readFileSync } from 'node:fs';

/**
 * Load environment variables from a `.env` file into `process.env`.
 *
 * Zero-dependency by design. Variables already present in the real
 * environment always win — the file supplies defaults, never overrides —
 * so CI and shell-exported secrets behave identically with or without a
 * `.env` present. Lines are `KEY=value` (optionally `export KEY=value`);
 * single or double quotes around the value are stripped; `#` comment
 * lines are ignored. Inline trailing comments are not supported.
 */
export function loadDotEnv(path = '.env'): void {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    const name = m[1]!;
    let value = m[2]!;
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }
    if (!(name in process.env)) process.env[name] = value;
  }
}
