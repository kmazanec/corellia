import type { FactoryEvent } from './events.js';
import type { KnowledgeCategory } from './knowledge.js';

type JsonObject = Record<string, unknown>;

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
  'tool-call',
  'step',
  'script-ran',
  'worktree-created',
  'worktree-collected',
  'worktree-preserved',
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
const ROUND_OUTCOMES = new Set(['done', 'continue', 'halt-no-progress', 'halt-max-rounds', 'halt-ceiling']);

export function parseFactoryEvent(value: unknown): FactoryEvent | null {
  const event = baseEvent(value);
  if (event === null) return null;

  switch (event['type']) {
    case 'goal-received':
      return hasObject(event, 'goal') ? asFactoryEvent(event) : null;
    case 'gate-checked':
      return hasBoolean(event, 'ok') && hasStringArray(event, 'missing') ? asFactoryEvent(event) : null;
    case 'decided':
      return hasObject(event, 'decision') && hasOptionalObject(event, 'usage') ? asFactoryEvent(event) : null;
    case 'child-spawned':
      return hasString(event, 'childId') && hasString(event, 'childType') && hasStringArray(event, 'dependsOn')
        ? asFactoryEvent(event)
        : null;
    case 'deterministic-checked':
      return hasObject(event, 'verdict') ? asFactoryEvent(event) : null;
    case 'judge-verdict':
      return hasString(event, 'judgeType') &&
        hasObject(event, 'verdict') &&
        hasSetValue(event, 'tier', TIERS) &&
        hasOptionalObject(event, 'usage')
        ? asFactoryEvent(event)
        : null;
    case 'repair-applied':
      return hasStringArray(event, 'prescriptions') && hasOptionalObject(event, 'usage') ? asFactoryEvent(event) : null;
    case 'tier-escalated':
      return hasSetValue(event, 'from', TIERS) && hasSetValue(event, 'to', TIERS) ? asFactoryEvent(event) : null;
    case 'blocked':
      return hasObject(event, 'brief') && hasSetValue(event, 'resolution', BRIEF_RESOLUTIONS) ? asFactoryEvent(event) : null;
    case 'memory-written':
      return hasObject(event, 'pointer') ? asFactoryEvent(event) : null;
    case 'memory-reinforced':
      return hasString(event, 'memoryId') && hasSetValue(event, 'outcome', OUTCOMES) ? asFactoryEvent(event) : null;
    case 'emitted':
      return hasObject(event, 'report') ? asFactoryEvent(event) : null;
    case 'budget-exhausted':
      return hasSetValue(event, 'dimension', BUDGET_DIMENSIONS) ? asFactoryEvent(event) : null;
    case 'risk-classified':
      return hasSetValue(event, 'risk', RISK_CLASSES) ? asFactoryEvent(event) : null;
    case 'gate-decision':
      return hasSetValue(event, 'resolution', GATE_RESOLUTIONS) ? asFactoryEvent(event) : null;
    case 'parked':
      return hasObject(event, 'brief') && hasFiniteNumber(event, 'ttlMs') ? asFactoryEvent(event) : null;
    case 'resumed':
      return hasString(event, 'answer') ? asFactoryEvent(event) : null;
    case 'pattern-consulted':
      return hasString(event, 'shape') && hasSetValue(event, 'status', PATTERN_STATUSES) ? asFactoryEvent(event) : null;
    case 'pattern-recorded':
      return hasString(event, 'shape') && hasSetValue(event, 'outcome', OUTCOMES) ? asFactoryEvent(event) : null;
    case 'tool-call':
      return hasString(event, 'tool') &&
        hasString(event, 'callId') &&
        hasSetValue(event, 'outcome', TOOL_OUTCOMES) &&
        hasOptionalString(event, 'reason')
        ? asFactoryEvent(event)
        : null;
    case 'step':
      return hasFiniteNumber(event, 'index') &&
        hasSetValue(event, 'outputKind', STEP_OUTPUT_KINDS) &&
        hasOptionalObject(event, 'usage')
        ? asFactoryEvent(event)
        : null;
    case 'script-ran':
      return hasString(event, 'command') &&
        hasNullableNumber(event, 'exitStatus') &&
        hasFiniteNumber(event, 'durationMs') &&
        hasString(event, 'outputRef')
        ? asFactoryEvent(event)
        : null;
    case 'worktree-created':
      return hasString(event, 'treeId') && hasString(event, 'branch') && hasString(event, 'path')
        ? asFactoryEvent(event)
        : null;
    case 'worktree-collected':
      return hasString(event, 'treeId') && hasString(event, 'branch') && hasStringArray(event, 'commits')
        ? asFactoryEvent(event)
        : null;
    case 'worktree-preserved':
      return hasString(event, 'treeId') &&
        hasString(event, 'branch') &&
        hasString(event, 'path') &&
        hasString(event, 'reason')
        ? asFactoryEvent(event)
        : null;
    case 'produced':
      return hasObject(event, 'usage') ? asFactoryEvent(event) : null;
    case 'ceiling-reached':
      return hasFiniteNumber(event, 'spentUsd') && hasFiniteNumber(event, 'ceilingUsd') ? asFactoryEvent(event) : null;
    case 'transport-retry':
    case 'malformation-reprompt':
    case 'context-evicted':
      return hasString(event, 'detail') ? asFactoryEvent(event) : null;
    case 'dependency-degraded':
      return hasString(event, 'dependency') && hasString(event, 'blocker') ? asFactoryEvent(event) : null;
    case 'knowledge-written':
      return hasObject(event, 'artifact') ? asFactoryEvent(event) : null;
    case 'knowledge-facts-written':
      return hasObject(event, 'facts') ? asFactoryEvent(event) : null;
    case 'knowledge-checked':
      return hasString(event, 'repoRoot') &&
        hasSetValue(event, 'category', KNOWLEDGE_CATEGORIES) &&
        hasString(event, 'sha') &&
        hasSetValue(event, 'outcome', KNOWLEDGE_CHECK_OUTCOMES)
        ? asFactoryEvent(event)
        : null;
    case 'golden-candidate':
      return hasString(event, 'judgeType') &&
        hasString(event, 'artifactDigest') &&
        hasString(event, 'rubricDigest') &&
        hasBoolean(event, 'verdictPass') &&
        hasSetValue(event, 'tier', TIERS) &&
        hasOptionalString(event, 'model')
        ? asFactoryEvent(event)
        : null;
    case 'branch-pushed':
      return hasString(event, 'treeId') && hasString(event, 'branch') && hasString(event, 'remote')
        ? asFactoryEvent(event)
        : null;
    case 'pr-opened':
      return hasString(event, 'treeId') && hasString(event, 'branch') && hasString(event, 'url')
        ? asFactoryEvent(event)
        : null;
    case 'blocker-routed':
      return hasString(event, 'blocker') && hasString(event, 'commissionId') ? asFactoryEvent(event) : null;
    case 'round-started':
      return hasFiniteNumber(event, 'round') &&
        hasFiniteNumber(event, 'spentUsd') &&
        hasFiniteNumber(event, 'roundWallClockMs')
        ? asFactoryEvent(event)
        : null;
    case 'round-assessed':
      return hasFiniteNumber(event, 'round') &&
        hasFiniteNumber(event, 'passingCount') &&
        hasFiniteNumber(event, 'criteriaTotal') &&
        hasObject(event, 'judgeVerdict') &&
        hasSetValue(event, 'outcome', ROUND_OUTCOMES) &&
        hasStringArray(event, 'diffDigest')
        ? asFactoryEvent(event)
        : null;
    default:
      return null;
  }
}

function baseEvent(value: unknown): JsonObject | null {
  if (!isObject(value)) return null;
  if (!hasSetValue(value, 'type', EVENT_TYPES)) return null;
  if (!hasFiniteNumber(value, 'at')) return null;
  if (!hasString(value, 'goalId')) return null;
  return value;
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
