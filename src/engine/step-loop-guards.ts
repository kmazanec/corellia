import type { GoalTypeDef } from '../contract/goal-type.js';

/**
 * The set of tool names whose effects are read-only (fs.read / retrieval grants
 * only). A byte-identical re-invocation of any of these within the same attempt
 * is refused: it cannot produce new information. Write-mutating tools (fs.write,
 * test.run_*, repo.*) are never guarded.
 */
export const READ_ONLY_TOOL_NAMES: ReadonlySet<string> = new Set([
  'read_file',
  'list_dir',
  'search',
  'find_symbol',
  'find_exemplar',
  'conventions_for',
  'stack_versions',
  'impact',
]);

/** Grants that let a leaf mutate the product/repo. */
const PRODUCT_WRITE_GRANTS: ReadonlySet<string> = new Set(['fs.write', 'docs.issues.write']);

/**
 * An explore-then-emit leaf (ADR-039): outputSchema plus no product-write grant.
 * This shape legitimately reads to gather context, then emits one structured
 * artifact, and never has cause to read-write-reread.
 */
export function isExploreThenEmitLeaf(typeDef: GoalTypeDef): boolean {
  return (
    typeDef.outputSchema !== undefined &&
    !typeDef.grants.some((g) => PRODUCT_WRITE_GRANTS.has(g))
  );
}

/**
 * Build the deduplication key for one tool call.
 * Format: `<name>\0<stable-json-args>`; the NUL separator cannot appear in JSON.
 */
export function dupKey(name: string, args: Record<string, unknown>): string {
  return `${name}\0${stableJsonStringify(args)}`;
}

/**
 * Cache of prior read-only tool outputs, keyed by dupKey. A refused duplicate
 * read hands the cached output back inline (prefixed) so the leaf proceeds
 * instead of reasoning around a bare refusal. The cache is released in lockstep
 * with the dedup guard: an evicted or write-invalidated entry drops both, so a
 * re-read is allowed and no stale content is served.
 */
export type ReadOutputCache = Map<string, string>;

/**
 * Release the duplicate-read guard for a call whose result was evicted from the
 * transcript. The read is no longer in context, so the model may re-read it.
 */
export function releaseGuardForCallId(
  seenCalls: Set<string>,
  callKeyByCallId: Map<string, string>,
  callId: string,
  readOutputCache?: ReadOutputCache,
): void {
  const key = callKeyByCallId.get(callId);
  if (key !== undefined) {
    seenCalls.delete(key);
    readOutputCache?.delete(key);
  }
}

/**
 * After a successful write_file call, invalidate read guard entries targeting
 * the written path, so a re-read after a write is allowed.
 */
export function invalidateReadGuardForPath(
  seenCalls: Set<string>,
  writtenPath: string,
  readOutputCache?: ReadOutputCache,
): void {
  for (const readTool of READ_ONLY_TOOL_NAMES) {
    const candidateKeys = [
      dupKey(readTool, { path: writtenPath }),
      dupKey(readTool, { filePath: writtenPath }),
      dupKey(readTool, { query: writtenPath }),
    ];
    for (const key of candidateKeys) {
      seenCalls.delete(key);
      readOutputCache?.delete(key);
    }
  }
}

/**
 * Stable, order-independent JSON serialization for args objects. Primitive
 * values and arrays are handled structurally; object keys are sorted.
 */
function stableJsonStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map(stableJsonStringify).join(',') + ']';
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const pairs = keys.map((key) => JSON.stringify(key) + ':' + stableJsonStringify(obj[key]));
  return '{' + pairs.join(',') + '}';
}
