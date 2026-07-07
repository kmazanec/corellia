/**
 * The promote-edge layer classifier. Memory has three layers — project / type /
 * global (DESIGN "Memory: layered project × type × global") — and only the type
 * layer compounds across projects. Which layer a promoted lesson lands in is a
 * routing decision made here, from an EXPLICIT generality signal on the lesson,
 * not a judgment the engine renders: the generality eval lives in the
 * `promote-memory` harness, which prepends a `[type]` / `[global]` tag when its
 * eval fires. The engine only reads that tag and routes; it never judges (ADR-049).
 */

import type { MemoryPointer } from '../contract/goal.js';

/** A lesson's target layer plus the content with any routing tag stripped. */
export interface LayerDecision {
  layer: MemoryPointer['layer'];
  /** The lesson text with the leading generality tag removed. */
  content: string;
}

/**
 * Classify a promoted lesson into its memory layer from its leading generality
 * tag. Conservative by construction: `global` requires the explicit `[global]`
 * tag and is never inferred, so an untagged or `[type]`-tagged lesson can never
 * escalate to org-wide. An untagged lesson stays `project` — the pre-ADR-049
 * default — so nothing about project-layer behavior regresses.
 *
 * Recognized tags (case-insensitive, leading, optional surrounding space):
 *   `[type]`   → the compounding type layer, scoped to the producing goal-type.
 *   `[global]` → the ambient global layer (explicit only).
 *   anything else / no tag → the project layer.
 */
export function chooseMemoryLayer(lesson: string): LayerDecision {
  const match = /^\s*\[(type|global)\]\s*/i.exec(lesson);
  if (!match) return { layer: 'project', content: lesson };
  const tag = match[1]!.toLowerCase();
  const content = lesson.slice(match[0].length);
  return { layer: tag === 'global' ? 'global' : 'type', content };
}
