/**
 * Error-signature → suggested-repair hints.
 *
 * Some failures recur verbatim across runs and have one obvious fix: a vitest
 * test file missing its `import { it } from 'vitest'`, a type used without its
 * import, `__dirname` in an ESM module. Left alone, a leaf re-runs the same file
 * and re-reads the same code, burning attempts on a known class of error.
 *
 * This is a tiny static lookup: scan a failure's text for a known signature and,
 * if matched, return a concrete fix to fold into the retry prompt. It rides the
 * existing prior-rejection feedback path — the hints become extra rejection
 * reasons — rather than opening a parallel channel. Deliberately small and
 * literal: only patterns seen to recur, each with a single unambiguous fix.
 */

interface RepairHint {
  /** Matches the failure text (case-insensitive). */
  readonly pattern: RegExp;
  /** The concrete fix, phrased as an instruction for the retry. */
  readonly fix: string;
}

const HINTS: readonly RepairHint[] = [
  {
    pattern: /\b(it|describe|expect|test|vi|beforeEach|afterEach) is not defined\b/i,
    fix: "A test symbol is undefined — add the missing vitest import at the top of the test file, e.g. `import { describe, it, expect } from 'vitest'`.",
  },
  {
    pattern: /\b__dirname is not defined\b|__dirname.*not defined in ES module/i,
    fix: 'This is an ESM module: `__dirname` does not exist. Derive it with `import.meta.url` (e.g. `dirname(fileURLToPath(import.meta.url))`).',
  },
  {
    pattern: /\brequire is not defined\b/i,
    fix: 'This is an ESM module: `require` is unavailable. Use an `import` statement instead.',
  },
  {
    pattern: /Cannot find name '([A-Za-z_$][\w$]*)'/,
    fix: 'A referenced type or value is not imported. Add the missing `import` for the named symbol.',
  },
  {
    pattern: /top-level (await|'await').*only.*module|await is only valid/i,
    fix: 'Top-level await is not allowed here — move the awaited call inside an `async` function.',
  },
];

/**
 * Return suggested-repair hints for any known error signatures found in the given
 * failure texts (finding titles, error messages). Deduplicated; empty when nothing
 * matches.
 */
export function repairHintsFor(failureTexts: readonly string[]): string[] {
  const hay = failureTexts.join('\n');
  const matched = new Set<string>();
  for (const hint of HINTS) {
    if (hint.pattern.test(hay)) matched.add(hint.fix);
  }
  return [...matched];
}
