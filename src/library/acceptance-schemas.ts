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
 *
 * `check` is deliberately a FLAT object with all variant keys optional — NOT a
 * `oneOf` union. This is the same posture as `DECISION_SCHEMA` (llm.ts): many
 * providers reject or wedge on `oneOf` under `strict` json_schema decoding, and
 * this was the only step-emitted schema carrying one — the
 * `author-acceptance-criteria` emit hung at EVERY tier, every run (live-tail
 * runs 1, 9, 10: "aborted due to timeout" at 120s/180s/360s), while the
 * union-free schemas emitted fine. Variant exclusivity (exactly one of
 * script/file/capture, no stray keys) is enforced semantically by
 * `isRunnableCheck` inside `criteriaWellFormed`, exactly as `parseDecision`
 * polices the decision variants.
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
            type: 'object',
            properties: {
              script: { type: 'string' },
              file: { type: 'string' },
              anchor: { type: 'string' },
              capture: { type: 'string' },
            },
            additionalProperties: false,
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
