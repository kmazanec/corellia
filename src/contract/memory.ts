/**
 * The memory read interface the engine injects from. Memory is a read-model
 * projection of the event log, not an independent store of record — the log
 * remembers, the projection serves queries. Children never touch it: the spawner
 * queries this view and injects the results as pointers at the spawn edge.
 */

import type { MemoryPointer } from './goal.js';

/**
 * How a query narrows the retrievable layers to what is relevant to the child.
 * Only the type layer is namespaced (by goal-type); project and global always
 * match on topic alone.
 */
export interface MemoryQueryContext {
  /**
   * The retrieving child's goal-type. When present, `type`-layer memories whose
   * `namespace` equals it are eligible; when absent, the type layer is excluded
   * (project + global only) — so an existing caller that omits it is unchanged.
   */
  goalType?: string;
}

/**
 * The read-side projection over the three memory layers (project / type /
 * global). Retrieval is anchored by the artifact and the goal — by topic and the
 * scope it touches — not by who asks, because there are no roles to ask.
 */
export interface MemoryView {
  /**
   * Retrieve the memory pointers relevant to a topic within a scope. Returns
   * pointers, not bodies; provenance and layer labels travel on each pointer so
   * trust state and layer attribution mean something at read time. `ctx` narrows
   * which layers are eligible (the type layer is filtered by the child's
   * goal-type namespace); an omitted `ctx` retrieves project + global only.
   */
  query(topic: string, scope: string[], ctx?: MemoryQueryContext): Promise<MemoryPointer[]>;
}
