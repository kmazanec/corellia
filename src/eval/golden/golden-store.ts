/**
 * The on-disk home of the golden set: JSON fixtures under
 * `fixtures/golden/<goalType>/<id>.json`, one per pair. A thin file store the
 * curation step writes and the replay harness reads — injectable so tests use
 * an in-memory implementation and never touch the real fixtures tree.
 */

import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { GoldenPair } from './golden-set.js';

/** Where the golden fixtures live relative to a repo root. */
export function goldenRoot(repoRoot: string): string {
  return join(repoRoot, 'fixtures', 'golden');
}

/**
 * The store's read/write surface, injectable for tests. `loadSet` returns every
 * pair for one goal-type; `save` writes one pair (creating the goal-type dir).
 */
export interface GoldenStore {
  loadSet(goalType: string): Promise<GoldenPair[]>;
  save(pair: GoldenPair): Promise<void>;
}

/** A filesystem-backed golden store rooted at `<repoRoot>/fixtures/golden`. */
export function fileGoldenStore(repoRoot: string): GoldenStore {
  const root = goldenRoot(repoRoot);
  return {
    async loadSet(goalType: string): Promise<GoldenPair[]> {
      const dir = join(root, goalType);
      let names: string[];
      try {
        names = await readdir(dir);
      } catch {
        return [];
      }
      const pairs: GoldenPair[] = [];
      for (const name of names.sort()) {
        if (!name.endsWith('.json')) continue;
        const raw = await readFile(join(dir, name), 'utf8');
        pairs.push(JSON.parse(raw) as GoldenPair);
      }
      return pairs;
    },

    async save(pair: GoldenPair): Promise<void> {
      const dir = join(root, pair.goalType);
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, `${pair.id}.json`), JSON.stringify(pair, null, 2) + '\n', 'utf8');
    },
  };
}
