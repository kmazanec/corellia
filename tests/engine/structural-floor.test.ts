import { describe, expect, it } from 'vitest';
import {
  structuralFloorMemories,
  MAX_FLOOR_FILES,
  type RegionFileEntry,
  type RegionScanner,
} from '../../src/engine/structural-floor.js';

/** A scanner that returns fixed entries per region, recording the regions asked for. */
function stubScanner(byRegion: Record<string, RegionFileEntry[]>): RegionScanner {
  return {
    scanRegion(_repoRoot, region) {
      return byRegion[region] ?? [];
    },
  };
}

const entry = (path: string, over: Partial<RegionFileEntry> = {}): RegionFileEntry => ({
  path,
  lines: over.lines ?? 10,
  bytes: over.bytes ?? 100,
  symbols: over.symbols ?? [],
});

describe('structuralFloorMemories', () => {
  it('synthesizes a provisional orientation memory plus one memory per floored region', () => {
    const scanner = stubScanner({
      'src/engine': [entry('src/engine/a.ts', { symbols: ['runA'] }), entry('src/engine/b.ts')],
    });

    const memories = structuralFloorMemories({ regions: ['src/engine'], scanner, repoRoot: '/repo' });

    expect(memories).toHaveLength(2);
    const [orientation, region] = memories;
    expect(orientation!.id).toBe('structural-floor:orientation');
    expect(orientation!.provenance).toBe('provisional');
    expect(orientation!.content).toContain('STRUCTURAL FLOOR');
    expect(orientation!.content).toContain('src/engine');

    expect(region!.id).toBe('structural-floor:src/engine');
    expect(region!.provenance).toBe('provisional');
    expect(region!.content).toContain('src/engine/a.ts (10 lines, 100 B) — exports: runA');
    expect(region!.content).toContain('src/engine/b.ts (10 lines, 100 B)');
  });

  it('labels the floor so it never reads as trusted comprehension', () => {
    const scanner = stubScanner({ r: [entry('r/x.ts')] });
    const memories = structuralFloorMemories({ regions: ['r'], scanner, repoRoot: '/repo' });
    expect(memories.every((m) => m.provenance === 'provisional')).toBe(true);
    expect(memories[0]!.content.toLowerCase()).toContain('read the cited files before trusting');
  });

  it('caps the file list and states the truncation explicitly — no silent cap', () => {
    const many = Array.from({ length: MAX_FLOOR_FILES + 25 }, (_, i) => entry(`r/f${i}.ts`));
    const scanner = stubScanner({ r: many });

    const memories = structuralFloorMemories({ regions: ['r'], scanner, repoRoot: '/repo' });
    const region = memories.find((m) => m.id === 'structural-floor:r')!;

    // Header still reports the true total; body shows only the cap; the note is explicit.
    expect(region.content).toContain(`${MAX_FLOOR_FILES + 25} files`);
    expect(region.content).toContain(`25 more files not shown (capped at ${MAX_FLOOR_FILES})`);
    const shownLines = region.content.split('\n').filter((l) => l.trim().startsWith('r/f')).length;
    expect(shownLines).toBe(MAX_FLOOR_FILES);
  });

  it('returns nothing when there are no regions or the scan is empty', () => {
    expect(structuralFloorMemories({ regions: [], scanner: stubScanner({}), repoRoot: '/repo' })).toEqual([]);
    expect(
      structuralFloorMemories({ regions: ['empty'], scanner: stubScanner({ empty: [] }), repoRoot: '/repo' }),
    ).toEqual([]);
    expect(
      structuralFloorMemories({ regions: ['r'], scanner: stubScanner({ r: [entry('r/x')] }), repoRoot: '' }),
    ).toEqual([]);
  });

  it('dedupes repeated regions and skips a scanner that throws', () => {
    const scanner: RegionScanner = {
      scanRegion(_r, region) {
        if (region === 'boom') throw new Error('scan failed');
        return [entry(`${region}/x.ts`)];
      },
    };
    const memories = structuralFloorMemories({
      regions: ['a', 'a', 'boom'],
      scanner,
      repoRoot: '/repo',
    });
    // 'a' floored once, 'boom' skipped (threw) → orientation + one region memory.
    expect(memories.map((m) => m.id)).toEqual(['structural-floor:orientation', 'structural-floor:a']);
  });
});
