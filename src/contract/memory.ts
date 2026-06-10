/**
 * The memory read interface the engine injects from. Memory is a read-model
 * projection of the event log, not an independent store of record — the log
 * remembers, the projection serves queries. Children never touch it: the spawner
 * queries this view and injects the results as pointers at the spawn edge.
 */

import type { MemoryPointer } from './goal.js';

/**
 * The read-side projection over the three memory layers (project / type /
 * global). Retrieval is anchored by the artifact and the goal — by topic and the
 * scope it touches — not by who asks, because there are no roles to ask.
 */
export interface MemoryView {
  /**
   * Retrieve the memory pointers relevant to a topic within a scope. Returns
   * pointers, not bodies; provenance labels travel on each pointer so trust state
   * means something at read time.
   */
  query(topic: string, scope: string[]): Promise<MemoryPointer[]>;
}
