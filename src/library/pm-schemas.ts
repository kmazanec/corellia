/**
 * JSON-Schema objects for the PM/discovery artifact types emitted by the
 * author and research family goal cards (ADR-023). Schemas enable the
 * engine's two-phase structured-emission seam so well-formedness of the
 * output JSON is the provider's guarantee rather than a prompt discipline
 * concern.
 *
 * PRD_SCHEMA:       output of write-prd — problem, users, outcome, scope,
 *                   requirements, acceptanceCriteria, openQuestions.
 * FINDINGS_SCHEMA:  output of research-external — question, findings (each
 *                   with a source), confidence, openQuestions.
 *
 * Deterministic checks (pm-checks.ts) remain the semantic gate; these schemas
 * fix packaging, not truth.
 */

/**
 * JSON-Schema for a PRD artifact: the output of a `write-prd` run.
 *
 * Required fields: problem, users, outcome, scope {in, out, deferred},
 * requirements (numbered array), acceptanceCriteria (given/when/then),
 * openQuestions.
 */
export const PRD_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    problem: { type: 'string' },
    users: {
      type: 'array',
      items: { type: 'string' },
    },
    outcome: { type: 'string' },
    scope: {
      type: 'object',
      properties: {
        in: {
          type: 'array',
          items: { type: 'string' },
        },
        out: {
          type: 'array',
          items: { type: 'string' },
        },
        deferred: {
          type: 'array',
          items: { type: 'string' },
        },
      },
      required: ['in', 'out', 'deferred'],
      additionalProperties: false,
    },
    requirements: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          text: { type: 'string' },
          traceableTo: { type: 'string' },
        },
        required: ['id', 'text', 'traceableTo'],
        additionalProperties: false,
      },
    },
    acceptanceCriteria: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          given: { type: 'string' },
          when: { type: 'string' },
          then: { type: 'string' },
          requirementRef: { type: 'string' },
        },
        required: ['id', 'given', 'when', 'then', 'requirementRef'],
        additionalProperties: false,
      },
    },
    openQuestions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          question: { type: 'string' },
          impact: { type: 'string' },
        },
        required: ['id', 'question', 'impact'],
        additionalProperties: false,
      },
    },
  },
  required: [
    'problem',
    'users',
    'outcome',
    'scope',
    'requirements',
    'acceptanceCriteria',
    'openQuestions',
  ],
  additionalProperties: false,
};

/**
 * JSON-Schema for a research findings artifact: the output of a
 * `research-external` run.
 *
 * Required fields: question, findings (each carrying a source and a load-bearing
 * flag), confidence, openQuestions.
 *
 * Every finding must declare a source — this is the contract the deterministic
 * check enforces at the semantic level; the schema fixes structural packaging.
 */
export const FINDINGS_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    question: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          claim: { type: 'string' },
          source: { type: 'string' },
          loadBearing: { type: 'boolean' },
          confidence: {
            type: 'string',
            enum: ['low', 'medium', 'high'],
          },
        },
        required: ['claim', 'source', 'loadBearing', 'confidence'],
        additionalProperties: false,
      },
    },
    confidence: {
      type: 'string',
      enum: ['low', 'medium', 'high'],
    },
    openQuestions: {
      type: 'array',
      items: { type: 'string' },
    },
  },
  required: ['question', 'findings', 'confidence', 'openQuestions'],
  additionalProperties: false,
};
