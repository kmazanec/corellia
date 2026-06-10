/**
 * Spec-shape fingerprinting: the key on which split memos are indexed.
 *
 * A shape is a stable, normalized signature of a goal's structural intent —
 * coarse enough that two goals with the same kind of work collide (enabling
 * memo reuse), fine enough that genuinely different work does not. The three
 * axes are:
 *
 *   1. The goal type — the harness already applied.
 *   2. The sorted top-level keys of the spec, when the spec is an object — the
 *      structural skeleton of the input contract, not its values.
 *   3. A coarse title token — the first ~5 meaningful words, sorted, lowercased,
 *      digits and punctuation stripped — so "Implement user auth" and "Implement
 *      auth user" collide, but "Implement user auth" and "Design landing page" do
 *      not. Sorting makes the token order-invariant and therefore stable.
 *
 * The function is pure and deterministic. Same-shaped intents must collide;
 * different work must not. The shape is never a semantic embedding — it is a
 * structural fingerprint.
 */

import type { Goal } from '../contract/goal.js';

/**
 * Return the normalized structural signature for a goal.
 * Used as the key into the pattern store's memo index.
 */
export function specShape(goal: Goal): string {
  const typePart = goal.type;

  // Extract the sorted top-level keys of the spec when it is a plain object.
  // Arrays, primitives, and null each produce a compact token instead of a
  // key list, so the shape still distinguishes them from plain-object specs.
  const specPart = specKeys(goal.spec);

  // A coarse, order-invariant token of the title: lowercase, strip digits and
  // punctuation, keep the first ~5 words, sort them for stability.
  const titlePart = titleToken(goal.title);

  return `${typePart}|${specPart}|${titlePart}`;
}

// ── helpers ──────────────────────────────────────────────────────────────────

function specKeys(spec: unknown): string {
  if (spec === null) return 'null';
  if (Array.isArray(spec)) return 'array';
  if (typeof spec === 'object') {
    const keys = Object.keys(spec as Record<string, unknown>).sort();
    return keys.length === 0 ? '{}' : keys.join(',');
  }
  // Primitive: string | number | boolean — normalize to the type name so
  // "42" and "hello" are in the same structural bucket.
  return typeof spec;
}

function titleToken(title: string): string {
  const words = title
    .toLowerCase()
    .replace(/[\d!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 5)
    .sort();
  return words.length === 0 ? 'empty' : words.join(' ');
}
