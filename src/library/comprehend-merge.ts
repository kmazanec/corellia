/**
 * Structured integration merge for the comprehend family (ADR-029).
 *
 * When a `map-repo` or `deep-dive-region` goal SPLITS, its children are
 * sub-region comprehensions whose artifacts are structured JSON
 * (`KnowledgeArtifact` / `RegionFacts`), gated by `mapRepoCheck` / `diveAnchorCheck`.
 * The engine's default integrate path `\n`-joins child `text` artifacts — for
 * these families that concatenates JSON blobs into a single invalid-JSON string
 * that fails the parent's deterministic gate. This module replaces that join with
 * a structured merge that yields ONE valid artifact passing the same gate a leaf
 * artifact passes.
 *
 * The merge is a pure function over the child artifacts plus the parent's HEAD
 * SHA: no I/O, no event-store knowledge. The engine wires it in at the
 * comprehension parent's integrate edge and then runs the merged artifact through
 * the existing leaf gate + persist hook, so the `knowledge-written` /
 * `knowledge-facts-written` event a split parent lands is byte-for-byte the kind
 * a leaf lands.
 */

import type {
  KnowledgeArtifact,
  KnowledgePointer,
  RegionFacts,
  DiveFact,
} from '../contract/knowledge.js';
import type { Artifact } from '../contract/report.js';
import { extractArtifactPayload } from './knowledge-checks.js';

/** Confidence levels ordered from least to most confident (for the min). */
const CONFIDENCE_ORDER: Array<'low' | 'medium' | 'high'> = ['low', 'medium', 'high'];

/**
 * Fall-back SHA when no knowledge wiring is present to supply the parent's HEAD:
 * the first child artifact's own `generatedAtSha`. Children of a comprehension
 * split are mapped/dived against the same parent SHA in practice, so any child's
 * SHA stands in for the parent's. Returns '' when no child carries one (the
 * merged artifact still gates, the SHA is just a string the gate does not read).
 */
export function childShaFallback(
  childArtifacts: Array<Artifact | null>,
  type: 'map-repo' | 'deep-dive-region',
): string {
  for (const a of childArtifacts) {
    if (a === null) continue;
    const obj = parseChildJson(a);
    if (obj === null) continue;
    const ok = type === 'map-repo' ? asKnowledgeArtifact(obj) : asRegionFacts(obj);
    if (ok !== null && typeof ok.generatedAtSha === 'string' && ok.generatedAtSha.length > 0) {
      return ok.generatedAtSha;
    }
  }
  return '';
}

/**
 * Parse a child artifact's textual payload as JSON, tolerating the two
 * packagings producers actually emit (plain text or a single fenced block, via
 * {@link extractArtifactPayload}). Returns null on any failure — the caller skips
 * an unparseable child rather than crashing the merge.
 */
function parseChildJson(artifact: Artifact): Record<string, unknown> | null {
  const payload = extractArtifactPayload(artifact);
  if (payload === null || payload.length === 0) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  return parsed as Record<string, unknown>;
}

/** Narrow a parsed object to a KnowledgeArtifact by its required fields. */
function asKnowledgeArtifact(obj: Record<string, unknown>): KnowledgeArtifact | null {
  if (
    typeof obj['repoRoot'] === 'string' &&
    typeof obj['category'] === 'string' &&
    typeof obj['summary'] === 'string' &&
    Array.isArray(obj['pointers'])
  ) {
    return obj as unknown as KnowledgeArtifact;
  }
  return null;
}

/** Narrow a parsed object to a RegionFacts by its required fields. */
function asRegionFacts(obj: Record<string, unknown>): RegionFacts | null {
  if (
    typeof obj['repoRoot'] === 'string' &&
    typeof obj['region'] === 'string' &&
    Array.isArray(obj['facts'])
  ) {
    return obj as unknown as RegionFacts;
  }
  return null;
}

/** Dedup-preserving union of pointers keyed by path+line+note. */
function unionPointers(children: KnowledgeArtifact[]): KnowledgePointer[] {
  const seen = new Set<string>();
  const out: KnowledgePointer[] = [];
  for (const child of children) {
    for (const p of child.pointers) {
      const key = `${p.path}::${p.line ?? ''}::${p.note}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(p);
    }
  }
  return out;
}

/** The conservative (minimum) confidence across children. */
function minConfidence(children: KnowledgeArtifact[]): 'low' | 'medium' | 'high' {
  let min = CONFIDENCE_ORDER.length - 1;
  for (const child of children) {
    const idx = CONFIDENCE_ORDER.indexOf(child.confidence);
    if (idx >= 0 && idx < min) min = idx;
  }
  return CONFIDENCE_ORDER[min] ?? 'low';
}

/** Dedup-preserving union of facts keyed by claim + anchor set. */
function unionFacts(children: RegionFacts[]): DiveFact[] {
  const seen = new Set<string>();
  const out: DiveFact[] = [];
  for (const child of children) {
    for (const f of child.facts) {
      const anchorKey = f.anchors.map((a) => `${a.path}:${a.line}`).sort().join('|');
      const key = `${f.claim}::${anchorKey}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(f);
    }
  }
  return out;
}

/**
 * Merge a comprehension parent's child artifacts into ONE structured artifact.
 *
 * - `type: 'map-repo'`: parse each child as a `KnowledgeArtifact` and merge into
 *   one — union of pointers, summaries concatenated, `status: 'provisional'`,
 *   `generatedAtSha = headSha` (the parent's HEAD), `confidence` = conservative
 *   min across children. `repoRoot`/`category` taken from the first valid child.
 * - `type: 'deep-dive-region'`: parse each child as a `RegionFacts` and merge
 *   into one — union of anchored facts (every anchor preserved),
 *   `generatedAtSha = headSha`. `repoRoot`/`region` from the first valid child.
 *
 * Unparseable / wrong-shape children are skipped, never fatal. When NO child
 * yields a valid artifact of the expected shape, returns null so the engine falls
 * back to its empty-integrate handling.
 *
 * The merged artifact is emitted as a `kind: 'text'` artifact carrying the merged
 * JSON, exactly as a leaf emits — so the same deterministic gate and persist hook
 * accept it unchanged.
 */
export function mergeComprehensionArtifacts(
  type: 'map-repo' | 'deep-dive-region',
  childArtifacts: Array<Artifact | null>,
  headSha: string,
): Artifact | null {
  if (type === 'map-repo') {
    const children: KnowledgeArtifact[] = [];
    for (const a of childArtifacts) {
      if (a === null) continue;
      const obj = parseChildJson(a);
      if (obj === null) continue;
      const ka = asKnowledgeArtifact(obj);
      if (ka !== null) children.push(ka);
    }
    if (children.length === 0) return null;

    const first = children[0]!;
    const merged: KnowledgeArtifact = {
      repoRoot: first.repoRoot,
      category: first.category,
      generatedAtSha: headSha,
      confidence: minConfidence(children),
      status: 'provisional',
      pointers: unionPointers(children),
      summary: children
        .map((c) => c.summary)
        .filter((s) => s.trim().length > 0)
        .join(' '),
    };
    return { kind: 'text', text: JSON.stringify(merged) };
  }

  // deep-dive-region
  const children: RegionFacts[] = [];
  for (const a of childArtifacts) {
    if (a === null) continue;
    const obj = parseChildJson(a);
    if (obj === null) continue;
    const rf = asRegionFacts(obj);
    if (rf !== null) children.push(rf);
  }
  if (children.length === 0) return null;

  const first = children[0]!;
  const merged: RegionFacts = {
    repoRoot: first.repoRoot,
    region: first.region,
    generatedAtSha: headSha,
    facts: unionFacts(children),
  };
  return { kind: 'text', text: JSON.stringify(merged) };
}
