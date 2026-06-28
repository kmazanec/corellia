/**
 * A bounded, structured summary of a tool call's salient arguments, for the
 * `args` field of a `tool-call` event.
 *
 * The event log must answer "what files did this leaf read, what did it search
 * for, what did it write?" so each call records its pointer-shaped arguments
 * (path, pattern, target, offset, …) as structured attributes — machine-queryable
 * (`jq '.args.path'`) rather than buried in a prose string. What it must NOT
 * record is the bulk payloads (a file's `content`, a PR `body`, a `note` text):
 * those would dump whole files into the log, so they are reduced to a length
 * attribute (`content_len: 1843`) that preserves the size signal without the
 * bytes. String values are length-bounded; unknown args are dropped.
 *
 * Returns `undefined` when a call carries no salient args, so the event field
 * stays absent rather than holding an empty object.
 */

/** Args whose value is pointer-shaped — recorded verbatim, bounded by length. */
const SALIENT_KEYS = [
  'path',
  'pattern',
  'target',
  'slug',
  'title',
  'base',
  'offset',
  'limit',
  'command',
  'symbol',
  'query',
  'name',
] as const;

/** Args whose value is bulk text — recorded as a `<key>_len` count, never inlined. */
const BULK_KEYS = ['content', 'body', 'text', 'script'] as const;

const MAX_STRING_LEN = 200;

function boundString(value: string): string {
  return value.length <= MAX_STRING_LEN ? value : `${value.slice(0, MAX_STRING_LEN)}…`;
}

/**
 * Summarize a tool call's arguments into a structured, bounded attribute object.
 * Pointer args are kept as `string`/`number`; bulk args become `<key>_len`
 * counts; unknown args are dropped. Returns `undefined` when nothing salient is
 * present.
 */
export function summarizeToolArgs(
  args: Record<string, unknown>,
): Record<string, string | number> | undefined {
  const summary: Record<string, string | number> = {};

  for (const key of SALIENT_KEYS) {
    const value = args[key];
    if (typeof value === 'number') {
      summary[key] = value;
    } else if (typeof value === 'string' && value.length > 0) {
      summary[key] = boundString(value);
    }
  }

  for (const key of BULK_KEYS) {
    const value = args[key];
    if (typeof value === 'string') {
      summary[`${key}_len`] = value.length;
    }
  }

  return Object.keys(summary).length > 0 ? summary : undefined;
}
