import type { FactoryEvent } from './events.js';
import type { KnowledgeCategory } from './knowledge.js';

type JsonObject = Record<string, unknown>;
type EventEnvelope = JsonObject & { type: FactoryEvent['type']; at: number; goalId: string };

const EVENT_TYPES = new Set([
  'goal-received',
  'gate-checked',
  'decided',
  'child-spawned',
  'deterministic-checked',
  'judge-verdict',
  'repair-applied',
  'tier-escalated',
  'blocked',
  'memory-written',
  'memory-reinforced',
  'emitted',
  'budget-exhausted',
  'risk-classified',
  'gate-decision',
  'parked',
  'resumed',
  'pattern-consulted',
  'pattern-recorded',
  'pattern-trust-signed',
  'tool-call',
  'step',
  'script-ran',
  'capture-ran',
  'worktree-created',
  'worktree-collected',
  'worktree-preserved',
  'worktree-reaped',
  'files-touched',
  'partial-delivered',
  'produced',
  'ceiling-reached',
  'transport-retry',
  'malformation-reprompt',
  'context-evicted',
  'dependency-degraded',
  'knowledge-written',
  'knowledge-facts-written',
  'knowledge-checked',
  'golden-candidate',
  'branch-pushed',
  'pr-opened',
  'blocker-routed',
  'round-started',
  'round-assessed',
] satisfies FactoryEvent['type'][]);

const TIERS = new Set(['low', 'mid', 'high']);
const RISK_CLASSES = new Set(['low', 'medium', 'high']);
const BRIEF_RESOLUTIONS = new Set(['deny', 'park', 'bounce', 'answered']);
const GATE_RESOLUTIONS = new Set(['granted', 'denied']);
const PATTERN_STATUSES = new Set(['none', 'provisional', 'trusted']);
const TRUST_STATUSES = new Set(['provisional', 'trusted']);
const OUTCOMES = new Set(['success', 'failure']);
const TOOL_OUTCOMES = new Set(['ran', 'refused']);
const STEP_OUTPUT_KINDS = new Set(['tool-calls', 'artifact']);
const BUDGET_DIMENSIONS = new Set(['attempts', 'tokens', 'toolCalls', 'wallClockMs']);
const KNOWLEDGE_CATEGORIES = new Set<KnowledgeCategory>([
  'architecture',
  'stack',
  'conventions',
  'design-system',
  'deps',
  'test-scaffold',
  'credentials',
]);
const KNOWLEDGE_CHECK_OUTCOMES = new Set(['fresh', 'stale-validated', 'invalid']);
const ROUND_OUTCOMES = new Set(['done', 'continue', 'halt-no-progress', 'halt-max-rounds', 'halt-ceiling', 'halt-deadline']);

export function parseFactoryEvent(value: unknown): FactoryEvent | null {
  const event = baseEvent(value);
  if (event === null) return null;
  return EVENT_VALIDATORS[event['type']](event) ? asFactoryEvent(event) : null;
}

type EventValidator = (event: JsonObject) => boolean;

const EVENT_VALIDATORS = {
  'goal-received': (event) => hasObject(event, 'goal'),
  'gate-checked': (event) => hasBoolean(event, 'ok') && hasStringArray(event, 'missing'),
  decided: (event) => hasObject(event, 'decision') && hasOptionalObject(event, 'usage'),
  'child-spawned': (event) => hasString(event, 'childId') && hasString(event, 'childType') && hasStringArray(event, 'dependsOn'),
  'deterministic-checked': (event) => hasObject(event, 'verdict'),
  'judge-verdict': (event) =>
    hasString(event, 'judgeType') &&
    hasObject(event, 'verdict') &&
    hasSetValue(event, 'tier', TIERS) &&
    hasOptionalObject(event, 'usage'),
  'repair-applied': (event) => hasStringArray(event, 'prescriptions') && hasOptionalObject(event, 'usage'),
  'tier-escalated': (event) => hasSetValue(event, 'from', TIERS) && hasSetValue(event, 'to', TIERS),
  blocked: (event) => hasObject(event, 'brief') && hasSetValue(event, 'resolution', BRIEF_RESOLUTIONS),
  'memory-written': (event) => hasObject(event, 'pointer'),
  'memory-reinforced': (event) => hasString(event, 'memoryId') && hasSetValue(event, 'outcome', OUTCOMES),
  emitted: (event) => hasObject(event, 'report'),
  'budget-exhausted': (event) => hasSetValue(event, 'dimension', BUDGET_DIMENSIONS),
  'risk-classified': (event) => hasSetValue(event, 'risk', RISK_CLASSES),
  'gate-decision': (event) => hasSetValue(event, 'resolution', GATE_RESOLUTIONS),
  parked: (event) => hasObject(event, 'brief') && hasFiniteNumber(event, 'ttlMs'),
  resumed: (event) => hasString(event, 'answer'),
  'pattern-consulted': (event) => hasString(event, 'shape') && hasSetValue(event, 'status', PATTERN_STATUSES),
  'pattern-recorded': (event) => hasString(event, 'shape') && hasSetValue(event, 'outcome', OUTCOMES),
  'pattern-trust-signed': (event) =>
    hasString(event, 'shape') &&
    hasSetValue(event, 'from', TRUST_STATUSES) &&
    hasSetValue(event, 'to', TRUST_STATUSES) &&
    hasString(event, 'signer') &&
    hasString(event, 'rationale'),
  'tool-call': (event) =>
    hasString(event, 'tool') &&
    hasString(event, 'callId') &&
    hasSetValue(event, 'outcome', TOOL_OUTCOMES) &&
    hasOptionalString(event, 'reason') &&
    hasOptionalObject(event, 'args'),
  step: (event) =>
    hasFiniteNumber(event, 'index') &&
    hasSetValue(event, 'outputKind', STEP_OUTPUT_KINDS) &&
    hasOptionalObject(event, 'usage'),
  'script-ran': (event) =>
    hasString(event, 'command') &&
    hasNullableNumber(event, 'exitStatus') &&
    hasFiniteNumber(event, 'durationMs') &&
    hasString(event, 'outputRef'),
  'capture-ran': (event) =>
    hasString(event, 'captureName') &&
    hasString(event, 'kind') &&
    hasBoolean(event, 'ok') &&
    hasFiniteNumber(event, 'durationMs') &&
    hasOptionalString(event, 'outputRef'),
  'worktree-created': (event) => hasString(event, 'treeId') && hasString(event, 'branch') && hasString(event, 'path'),
  'worktree-collected': (event) => hasString(event, 'treeId') && hasString(event, 'branch') && hasStringArray(event, 'commits'),
  'worktree-preserved': (event) =>
    hasString(event, 'treeId') &&
    hasString(event, 'branch') &&
    hasString(event, 'path') &&
    hasString(event, 'reason'),
  'worktree-reaped': (event) =>
    hasString(event, 'path') && hasOptionalString(event, 'branch') && hasString(event, 'reason'),
  'files-touched': (event) => hasStringArray(event, 'scope') && hasTouchedFiles(event),
  'partial-delivered': (event) => hasBlockedModules(event),
  produced: (event) => hasObject(event, 'usage'),
  'ceiling-reached': (event) => hasFiniteNumber(event, 'spentUsd') && hasFiniteNumber(event, 'ceilingUsd'),
  'transport-retry': hasDetail,
  'malformation-reprompt': hasDetail,
  'context-evicted': hasDetail,
  'dependency-degraded': (event) => hasString(event, 'dependency') && hasString(event, 'blocker'),
  'knowledge-written': (event) => hasObject(event, 'artifact'),
  'knowledge-facts-written': (event) => hasObject(event, 'facts'),
  'knowledge-checked': (event) =>
    hasString(event, 'repoRoot') &&
    hasSetValue(event, 'category', KNOWLEDGE_CATEGORIES) &&
    hasString(event, 'sha') &&
    hasSetValue(event, 'outcome', KNOWLEDGE_CHECK_OUTCOMES),
  'golden-candidate': (event) =>
    hasString(event, 'judgeType') &&
    hasString(event, 'artifactDigest') &&
    hasString(event, 'rubricDigest') &&
    hasBoolean(event, 'verdictPass') &&
    hasSetValue(event, 'tier', TIERS) &&
    hasOptionalString(event, 'model'),
  'branch-pushed': (event) => hasString(event, 'treeId') && hasString(event, 'branch') && hasString(event, 'remote'),
  'pr-opened': (event) => hasString(event, 'treeId') && hasString(event, 'branch') && hasString(event, 'url'),
  'blocker-routed': (event) => hasString(event, 'blocker') && hasString(event, 'commissionId'),
  'round-started': (event) =>
    hasFiniteNumber(event, 'round') &&
    hasFiniteNumber(event, 'spentUsd') &&
    hasFiniteNumber(event, 'roundWallClockMs'),
  'round-assessed': (event) =>
    hasFiniteNumber(event, 'round') &&
    hasFiniteNumber(event, 'passingCount') &&
    hasFiniteNumber(event, 'criteriaTotal') &&
    hasObject(event, 'judgeVerdict') &&
    hasSetValue(event, 'outcome', ROUND_OUTCOMES) &&
    hasStringArray(event, 'diffDigest'),
} satisfies Record<FactoryEvent['type'], EventValidator>;

function hasDetail(event: JsonObject): boolean {
  return hasString(event, 'detail');
}

/** Validate `files: { path: string; inScope: boolean }[]` on a files-touched event. */
function hasTouchedFiles(event: JsonObject): boolean {
  const files = event['files'];
  return (
    Array.isArray(files) &&
    files.every(
      (f) =>
        isObject(f) &&
        typeof (f as JsonObject)['path'] === 'string' &&
        typeof (f as JsonObject)['inScope'] === 'boolean',
    )
  );
}

/** Validate `blockedModules: { goalId, title, blocker }[]` on a partial-delivered event. */
function hasBlockedModules(event: JsonObject): boolean {
  const modules = event['blockedModules'];
  return (
    Array.isArray(modules) &&
    modules.every(
      (m) =>
        isObject(m) &&
        typeof (m as JsonObject)['goalId'] === 'string' &&
        typeof (m as JsonObject)['title'] === 'string' &&
        typeof (m as JsonObject)['blocker'] === 'string',
    )
  );
}

function baseEvent(value: unknown): EventEnvelope | null {
  if (!isObject(value)) return null;
  if (!hasSetValue(value, 'type', EVENT_TYPES)) return null;
  if (!hasFiniteNumber(value, 'at')) return null;
  if (!hasString(value, 'goalId')) return null;
  return value as EventEnvelope;
}

function asFactoryEvent(event: JsonObject): FactoryEvent {
  return event as unknown as FactoryEvent;
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasObject(value: JsonObject, key: string): boolean {
  return isObject(value[key]);
}

function hasOptionalObject(value: JsonObject, key: string): boolean {
  return value[key] === undefined || isObject(value[key]);
}

function hasString(value: JsonObject, key: string): boolean {
  return typeof value[key] === 'string';
}

function hasOptionalString(value: JsonObject, key: string): boolean {
  return value[key] === undefined || typeof value[key] === 'string';
}

function hasBoolean(value: JsonObject, key: string): boolean {
  return typeof value[key] === 'boolean';
}

function hasFiniteNumber(value: JsonObject, key: string): boolean {
  return typeof value[key] === 'number' && Number.isFinite(value[key]);
}

function hasNullableNumber(value: JsonObject, key: string): boolean {
  return value[key] === null || hasFiniteNumber(value, key);
}

function hasStringArray(value: JsonObject, key: string): boolean {
  return Array.isArray(value[key]) && value[key].every((entry) => typeof entry === 'string');
}

function hasSetValue(value: JsonObject, key: string, allowed: ReadonlySet<string>): boolean {
  const candidate = value[key];
  return typeof candidate === 'string' && allowed.has(candidate);
}
