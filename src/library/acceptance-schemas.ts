/**
 * JSON-Schema for the acceptance-criteria artifact (ADR-032 §1): the output of
 * an `author-acceptance-criteria` run. It is the frozen, SHA-anchored,
 * deterministic-floored done-condition the milestone loop (ADR-031) terminates
 * against.
 *
 * The artifact is an ordered checklist `[{ id, claim, check }]`, where each
 * `check` is a repo-runnable predicate — a named script command the sandbox
 * executes (`{ script }`, mapping to the `runScriptCheck` shape, checks.ts), a
 * file/anchor existence assertion verified against the worktree (`{ file,
 * anchor? }`, mapping to the `fileContains` shape, checks.ts), or a named
 * runtime/visual capture (`{ capture }`, mapping to the `captureSucceeded` shape,
 * ADR-042). A prose-only "rubric line" criterion is NOT expressible here and is
 * rejected by `criteriaWellFormed` (ADR-032 §2): quality the scripts cannot
 * express is the judge's job, not a criterion's.
 *
 * The schema fixes packaging; `criteriaWellFormed` (checks.ts) remains the
 * semantic gate.
 */
export const ACCEPTANCE_CRITERIA_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    criteria: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          claim: { type: 'string' },
          check: {
            oneOf: [
              {
                type: 'object',
                properties: { script: { type: 'string' } },
                required: ['script'],
                additionalProperties: false,
              },
              {
                type: 'object',
                properties: {
                  file: { type: 'string' },
                  anchor: { type: 'string' },
                },
                required: ['file'],
                additionalProperties: false,
              },
              {
                type: 'object',
                properties: { capture: { type: 'string' } },
                required: ['capture'],
                additionalProperties: false,
              },
            ],
          },
        },
        required: ['id', 'claim', 'check'],
        additionalProperties: false,
      },
    },
  },
  required: ['criteria'],
  additionalProperties: false,
};
