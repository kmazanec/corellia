import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { loadDotEnv } from '../src/env.js';

const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

function envFile(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'corellia-env-'));
  const path = join(dir, '.env');
  writeFileSync(path, content);
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return path;
}

function withVar(name: string): void {
  cleanups.push(() => {
    delete process.env[name];
  });
}

describe('loadDotEnv', () => {
  it('loads simple, quoted, and export-prefixed assignments', () => {
    const path = envFile(
      [
        'CORELLIA_TEST_A=plain',
        'CORELLIA_TEST_B="double quoted"',
        "CORELLIA_TEST_C='single quoted'",
        'export CORELLIA_TEST_D=exported',
        '# CORELLIA_TEST_E=commented-out',
        '',
      ].join('\n'),
    );
    for (const v of ['CORELLIA_TEST_A', 'CORELLIA_TEST_B', 'CORELLIA_TEST_C', 'CORELLIA_TEST_D', 'CORELLIA_TEST_E'])
      withVar(v);

    loadDotEnv(path);

    expect(process.env.CORELLIA_TEST_A).toBe('plain');
    expect(process.env.CORELLIA_TEST_B).toBe('double quoted');
    expect(process.env.CORELLIA_TEST_C).toBe('single quoted');
    expect(process.env.CORELLIA_TEST_D).toBe('exported');
    expect(process.env.CORELLIA_TEST_E).toBeUndefined();
  });

  it('never overrides a variable already present in the environment', () => {
    const path = envFile('CORELLIA_TEST_WINNER=file\n');
    withVar('CORELLIA_TEST_WINNER');
    process.env.CORELLIA_TEST_WINNER = 'real-env';

    loadDotEnv(path);

    expect(process.env.CORELLIA_TEST_WINNER).toBe('real-env');
  });

  it('is a no-op when the file does not exist', () => {
    expect(() => loadDotEnv('/nonexistent/.env')).not.toThrow();
  });
});
