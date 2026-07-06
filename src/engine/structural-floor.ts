/**
 * The structural floor for a build leaf whose primary-region dive produced
 * nothing.
 *
 * A `deep-dive-region` dependency can emit a null artifact (it hallucinated an
 * anchor and exhausted its tiers; the issue
 * dive-anchor-hallucination-blocks-region). The ADR-040 dive→build handoff then
 * injects ZERO memories for that region, so the dependent build leaf starts with
 * no map of the one region it must change, re-surveys it from scratch, and
 * blocks on the ADR-037 degraded-dependency path.
 *
 * This module gives that leaf a floor: a mechanically-derived (no LLM) map of the
 * region — the file list with sizes and, cheaply, the exported top-level symbol
 * names. It is a POINTER MAP, not comprehension: injected as `provisional`
 * memories labeled as a structural floor ("dive failed; raw pointers — read
 * before trusting"), never as trusted facts (DESIGN "Memory": mechanically-derived
 * facts are provisional, and are labeled so).
 */

import type { MemoryPointer } from '../contract/goal.js';

/** One file in a floored region: where it is and how big, plus cheap symbol names. */
export interface RegionFileEntry {
  /** Repo-relative path. */
  path: string;
  /** Line count (newline-delimited); the cheap size signal a reader orients by. */
  lines: number;
  /** Byte size on disk. */
  bytes: number;
  /** Exported top-level symbol names found by a regex-grade scan (may be empty). */
  symbols: string[];
}

/** The filesystem read seam — fs-backed in production, injectable in tests. */
export interface RegionScanner {
  /** List the region's files (repo-relative paths) with sizes and symbols, or [] if unreadable. */
  scanRegion(repoRoot: string, region: string): RegionFileEntry[];
}

/** Never map more than this many files into one floor memory — bound the context. */
export const MAX_FLOOR_FILES = 300;

/**
 * Synthesize structural-floor memories for the regions whose dive produced no
 * usable facts. One memory per floored region, plus a leading orientation memory
 * that names the floor and why it exists. Returns [] when there is nothing to
 * floor or every region scanned empty.
 */
export function structuralFloorMemories(params: {
  regions: readonly string[];
  scanner: RegionScanner;
  repoRoot: string;
}): MemoryPointer[] {
  const flooredRegions = dedupe(params.regions).filter((r) => r.length > 0);
  if (flooredRegions.length === 0 || params.repoRoot.length === 0) return [];

  const regionMemories: MemoryPointer[] = [];
  for (const region of flooredRegions) {
    const entries = safeScan(params.scanner, params.repoRoot, region);
    if (entries.length === 0) continue; // Nothing readable — no floor to offer.
    regionMemories.push(regionFloorMemory(region, entries));
  }

  if (regionMemories.length === 0) return [];
  return [orientationMemory(flooredRegions), ...regionMemories];
}

/** The leading memory: names the floor, its provenance, and how to use it. */
function orientationMemory(regions: readonly string[]): MemoryPointer {
  return {
    id: 'structural-floor:orientation',
    layer: 'project',
    content:
      `STRUCTURAL FLOOR (provisional — the deep-dive for ${regions.length === 1 ? 'this region' : 'these regions'} ` +
      `produced no usable facts, so these are raw structure pointers derived mechanically, not comprehension). ` +
      `Read the cited files before trusting any of it. Regions floored: ${regions.join(', ')}.`,
    provenance: 'provisional',
  };
}

/** One region's floor: its file map (paths + sizes + symbols), capped with an explicit truncation note. */
function regionFloorMemory(region: string, entries: RegionFileEntry[]): MemoryPointer {
  const shown = entries.slice(0, MAX_FLOOR_FILES);
  const truncated = entries.length - shown.length;

  const lines = shown.map((e) => {
    const symbols = e.symbols.length > 0 ? ` — exports: ${e.symbols.join(', ')}` : '';
    return `  ${e.path} (${e.lines} lines, ${e.bytes} B)${symbols}`;
  });

  const header = `structural floor for region ${region}: ${entries.length} file${entries.length === 1 ? '' : 's'}`;
  const note =
    truncated > 0
      ? `\n  … ${truncated} more file${truncated === 1 ? '' : 's'} not shown (capped at ${MAX_FLOOR_FILES}).`
      : '';

  return {
    id: `structural-floor:${region}`,
    layer: 'project',
    content: `${header}\n${lines.join('\n')}${note}`,
    provenance: 'provisional',
  };
}

function safeScan(scanner: RegionScanner, repoRoot: string, region: string): RegionFileEntry[] {
  try {
    return scanner.scanRegion(repoRoot, region);
  } catch {
    return [];
  }
}

function dedupe(values: readonly string[]): string[] {
  return [...new Set(values)];
}
