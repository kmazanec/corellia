import { describe, expect, it, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fsRegionScanner } from '../../src/engine/region-scanner.js';

const dirs: string[] = [];
function tempRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'corellia-scan-'));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('fsRegionScanner', () => {
  it('lists a region\'s files with line/byte sizes and exported symbols, sorted', () => {
    const repo = tempRepo();
    mkdirSync(join(repo, 'src/engine'), { recursive: true });
    writeFileSync(
      join(repo, 'src/engine/alpha.ts'),
      'export function runAlpha() {}\nexport const K = 1;\n',
    );
    writeFileSync(join(repo, 'src/engine/beta.ts'), 'export class Beta {}\n');

    const entries = fsRegionScanner().scanRegion(repo, 'src/engine');

    expect(entries.map((e) => e.path)).toEqual(['src/engine/alpha.ts', 'src/engine/beta.ts']);
    const alpha = entries[0]!;
    expect(alpha.lines).toBe(2);
    expect(alpha.bytes).toBeGreaterThan(0);
    expect(alpha.symbols).toEqual(expect.arrayContaining(['runAlpha', 'K']));
    expect(entries[1]!.symbols).toEqual(['Beta']);
  });

  it('recurses into subdirectories but skips node_modules and dotdirs', () => {
    const repo = tempRepo();
    mkdirSync(join(repo, 'src/deep/nested'), { recursive: true });
    mkdirSync(join(repo, 'src/node_modules/pkg'), { recursive: true });
    mkdirSync(join(repo, 'src/.hidden'), { recursive: true });
    writeFileSync(join(repo, 'src/deep/nested/keep.ts'), 'export const kept = 1;\n');
    writeFileSync(join(repo, 'src/node_modules/pkg/index.ts'), 'export const skip = 1;\n');
    writeFileSync(join(repo, 'src/.hidden/secret.ts'), 'export const hidden = 1;\n');

    const paths = fsRegionScanner().scanRegion(repo, 'src').map((e) => e.path);

    expect(paths).toContain('src/deep/nested/keep.ts');
    expect(paths).not.toContain('src/node_modules/pkg/index.ts');
    expect(paths.some((p) => p.includes('.hidden'))).toBe(false);
  });

  it('returns [] for a region that does not exist', () => {
    const repo = tempRepo();
    expect(fsRegionScanner().scanRegion(repo, 'nope')).toEqual([]);
  });

  it('handles a region that is a single file, not a directory', () => {
    const repo = tempRepo();
    mkdirSync(join(repo, 'src'), { recursive: true });
    writeFileSync(join(repo, 'src/lone.ts'), 'export function only() {}\n');

    const entries = fsRegionScanner().scanRegion(repo, 'src/lone.ts');
    expect(entries).toHaveLength(1);
    expect(entries[0]!.path).toBe('src/lone.ts');
    expect(entries[0]!.symbols).toEqual(['only']);
  });
});
