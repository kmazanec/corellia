/**
 * Shape validation for a declared-scripts map (ADR-016) supplied from outside
 * the factory — a commission body or an operator env var.
 *
 * The script runner trusts its map: names are looked up verbatim and a
 * node-file entry is joined onto the worktree root. Anything that arrives over
 * the front door is therefore validated here first — names are plain
 * identifiers, and each entry is one of the three runner forms with a plain,
 * in-bounds operand — so a declared set can never smuggle shell text or an
 * out-of-worktree path into a spawn.
 */

import { isAbsolute, normalize } from 'node:path';
import type { DeclaredScripts } from './script-runner.js';

const SCRIPT_NAME = /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/;
const RUNNER_OPERAND = /^[A-Za-z0-9][A-Za-z0-9_.:/-]*$/;
const ENTRY_PATH = /^[A-Za-z0-9_./-]+$/;

/**
 * Validate an untrusted value as a {@link DeclaredScripts} map. Returns the
 * first problem found, or null when every entry is well-formed.
 */
export function declaredScriptsProblem(value: unknown): string | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return 'declaredScripts must be an object of name → entry point';
  }
  for (const [name, entry] of Object.entries(value as Record<string, unknown>)) {
    if (!SCRIPT_NAME.test(name)) {
      return `declared script name "${name}" must be a plain identifier`;
    }
    if (typeof entry !== 'string') {
      return `declared script "${name}" entry point must be a string`;
    }
    const problem = entryPointProblem(entry);
    if (problem !== null) return `declared script "${name}" ${problem}`;
  }
  return null;
}

function entryPointProblem(entry: string): string | null {
  for (const prefix of ['npm-script:', 'make:']) {
    if (entry.startsWith(prefix)) {
      return RUNNER_OPERAND.test(entry.slice(prefix.length))
        ? null
        : `names an invalid ${prefix.slice(0, -1)} target "${entry}"`;
    }
  }
  if (!ENTRY_PATH.test(entry) || isAbsolute(entry) || normalize(entry).startsWith('..')) {
    return `entry point "${entry}" must be a repo-relative, in-bounds file path`;
  }
  return null;
}

/**
 * Parse an operator-supplied JSON declared-scripts map (e.g. the daemon's
 * `CORELLIA_DECLARED_SCRIPTS`). Absent or empty → an empty set; malformed JSON
 * or an invalid entry throws, so a bad operator config fails at boot rather
 * than as a mysterious refusal mid-run.
 */
export function parseDeclaredScripts(raw: string | undefined, source: string): DeclaredScripts {
  if (raw === undefined || raw.trim() === '') return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`${source} is not valid JSON`);
  }
  const problem = declaredScriptsProblem(parsed);
  if (problem !== null) throw new Error(`${source}: ${problem}`);
  return parsed as DeclaredScripts;
}
