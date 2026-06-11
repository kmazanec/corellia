/**
 * JSON-Schema objects for the knowledge artifact types emitted by learn-type
 * goal cards (ADR-023). These are the structural contracts the engine's
 * two-phase emit seam validates against via provider response_format, so that
 * well-formedness of the emitted JSON is the provider's guarantee rather than
 * a prompt discipline concern.
 *
 * The schemas faithfully mirror the TypeScript interfaces in
 * src/contract/knowledge.ts: required fields, enums for category/confidence/
 * status, and the pointer/fact array item shapes. They are intentionally
 * verbose so the provider's schema validator rejects structurally incorrect
 * output at the wire level.
 *
 * Deterministic checks (knowledge-checks.ts) remain the semantic gate;
 * these schemas fix packaging, not truth.
 */

/**
 * JSON-Schema for {@link KnowledgeArtifact}: the output of a `map-repo` run.
 * Required fields: repoRoot, category, generatedAtSha, confidence, status,
 * pointers (array, may be empty), summary.
 */
export const KNOWLEDGE_ARTIFACT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    repoRoot: { type: 'string' },
    category: {
      type: 'string',
      enum: [
        'architecture',
        'stack',
        'conventions',
        'design-system',
        'deps',
        'test-scaffold',
        'credentials',
      ],
    },
    generatedAtSha: { type: 'string' },
    confidence: {
      type: 'string',
      enum: ['low', 'medium', 'high'],
    },
    status: {
      type: 'string',
      enum: ['provisional', 'trusted'],
    },
    pointers: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          line: { type: 'integer' },
          note: { type: 'string' },
        },
        required: ['path', 'note'],
        additionalProperties: false,
      },
    },
    summary: { type: 'string' },
  },
  required: [
    'repoRoot',
    'category',
    'generatedAtSha',
    'confidence',
    'status',
    'pointers',
    'summary',
  ],
  additionalProperties: false,
};

/**
 * JSON-Schema for {@link RegionFacts}: the output of a `deep-dive-region` run.
 * Required fields: repoRoot, region, generatedAtSha, facts (array, may be empty).
 * Each fact: claim, anchors (array of {path, line}), sha, confidence.
 */
export const REGION_FACTS_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    repoRoot: { type: 'string' },
    region: { type: 'string' },
    generatedAtSha: { type: 'string' },
    facts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          claim: { type: 'string' },
          anchors: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                path: { type: 'string' },
                line: { type: 'integer' },
              },
              required: ['path', 'line'],
              additionalProperties: false,
            },
          },
          sha: { type: 'string' },
          confidence: {
            type: 'string',
            enum: ['low', 'medium', 'high'],
          },
        },
        required: ['claim', 'anchors', 'sha', 'confidence'],
        additionalProperties: false,
      },
    },
  },
  required: ['repoRoot', 'region', 'generatedAtSha', 'facts'],
  additionalProperties: false,
};
