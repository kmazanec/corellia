import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { scanDiffForProcessLanguage } from '../../src/engine/process-clean.js';

// The process-clean grep proof: a real unified diff carrying factory-internal
// vocabulary — a leaked goal-id branch ref (tree/…) and a factory-process
// comment — is rejected before it reaches a foreign product repo; the clean
// twin, differing only by those two lines, passes. Drives the real gate exactly
// as the push path does.

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'fixtures', 'process-pollution');

function readDiff(name: string): string {
  return readFileSync(join(fixtureDir, name), 'utf8');
}

describe('process-pollution fixture (process-clean grep)', () => {
  it('PASSES on a product diff with no factory vocabulary', () => {
    const result = scanDiffForProcessLanguage(readDiff('change.clean.diff'));
    expect(result.ok).toBe(true);
  });

  it('FAILS on a diff leaking a goal-id ref and factory-process language', () => {
    const result = scanDiffForProcessLanguage(readDiff('change.polluted.diff'));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected the polluted diff to be rejected');
    const offenses = result.offenses.join('\n');
    expect(offenses).toContain('tree/');
    expect(offenses.toLowerCase()).toContain('improve-factory');
  });
});
