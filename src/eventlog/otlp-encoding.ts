/**
 * OTLP/HTTP JSON encoding: the wire-format shapes and the pure functions that
 * turn the sink's in-memory spans into an OTLP `resourceSpans` request, plus the
 * deterministic id derivation and the per-event attribute mapping.
 *
 * This is the *format* half of the OTLP adapter — no I/O, no buffering. The sink
 * (`otlp-sink.ts`) owns folding events into spans and batch-exporting; this module
 * owns how a closed span looks on the wire. Kept separate so the mapping can grow
 * (new event kinds, new attributes) without touching the export machinery.
 */

import { createHash } from 'node:crypto';
import type { FactoryEvent } from '../contract/events.js';
import type { Usage } from '../contract/goal.js';

// ── OTLP JSON value/attribute shapes ──────────────────────────────────────────

export type OtlpValue =
  | { stringValue: string }
  | { intValue: string }
  | { doubleValue: number }
  | { boolValue: boolean };

export interface OtlpAttribute {
  key: string;
  value: OtlpValue;
}

export interface SpanEvent {
  timeUnixNano: string;
  name: string;
  attributes: OtlpAttribute[];
}

export interface OtlpSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind: number;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  attributes: OtlpAttribute[];
  events: SpanEvent[];
  status: { code: number; message?: string };
}

export interface OtlpTraceRequest {
  resourceSpans: {
    resource: { attributes: OtlpAttribute[] };
    scopeSpans: {
      scope: { name: string; version: string };
      spans: OtlpSpan[];
    }[];
  }[];
}

/** SPAN_KIND_INTERNAL — the factory owns the whole tree. */
export const SPAN_KIND_INTERNAL = 1;
export const STATUS_UNSET = 0;
export const STATUS_ERROR = 2;

/** Wrap a set of encoded spans in the OTLP resource/scope envelope. */
export function traceRequest(serviceName: string, spans: OtlpSpan[]): OtlpTraceRequest {
  return {
    resourceSpans: [
      {
        resource: { attributes: [attr('service.name', str(serviceName))] },
        scopeSpans: [
          { scope: { name: 'corellia.eventlog', version: '1' }, spans },
        ],
      },
    ],
  };
}

// ── Ids ───────────────────────────────────────────────────────────────────────

/** 16-byte trace id as 32 hex chars, derived deterministically from the root goalId. */
export function traceId(rootGoalId: string): string {
  return createHash('sha256').update(`trace:${rootGoalId}`).digest('hex').slice(0, 32);
}

/** 8-byte span id as 16 hex chars, derived deterministically from the goalId. */
export function spanId(goalId: string): string {
  return createHash('sha256').update(`span:${goalId}`).digest('hex').slice(0, 16);
}

/** The tree-root segment of a slash-nested goalId (`root/a/b` → `root`). */
export function rootFromGoalId(goalId: string): string {
  const slash = goalId.indexOf('/');
  return slash === -1 ? goalId : goalId.slice(0, slash);
}

/** Wall-clock ms → OTLP nanosecond string. */
export function msToNano(ms: number): string {
  return (BigInt(Math.trunc(ms)) * 1_000_000n).toString();
}

// ── Attribute construction ─────────────────────────────────────────────────────

export function attr(key: string, value: OtlpValue): OtlpAttribute {
  return { key, value };
}

export function str(value: string): OtlpValue {
  return { stringValue: value };
}

export function int(value: number): OtlpValue {
  return { intValue: Math.trunc(value).toString() };
}

export function spanEvent(nano: string, name: string, attributes: OtlpAttribute[]): SpanEvent {
  return { timeUnixNano: nano, name, attributes };
}

// ── Per-event mapping ──────────────────────────────────────────────────────────

/** The `usage` field of any event that carries one, or undefined. */
export function usageOf(event: FactoryEvent): Usage | undefined {
  return 'usage' in event ? event.usage : undefined;
}

/** The salient fields of a step-shaped event, as OTLP attributes on its span event. */
export function stepEventAttributes(event: FactoryEvent): OtlpAttribute[] {
  switch (event.type) {
    case 'decided':
      return [attr('decision.kind', str(event.decision.kind))];
    case 'tool-call':
      return [
        attr('tool', str(event.tool)),
        attr('outcome', str(event.outcome)),
        ...(event.reason !== undefined ? [attr('reason', str(event.reason))] : []),
      ];
    case 'step':
      return [attr('index', int(event.index)), attr('outputKind', str(event.outputKind))];
    case 'judge-verdict':
      return [
        attr('judgeType', str(event.judgeType)),
        attr('tier', str(event.tier)),
        attr('pass', { boolValue: event.verdict.pass }),
      ];
    case 'deterministic-checked':
      return [attr('pass', { boolValue: event.verdict.pass })];
    case 'tier-escalated':
      return [attr('from', str(event.from)), attr('to', str(event.to))];
    case 'repair-applied':
      return [attr('prescriptions', str(event.prescriptions.join('; ')))];
    case 'script-ran':
      return [attr('command', str(event.command)), attr('exitStatus', int(event.exitStatus ?? -1))];
    case 'capture-ran':
      return [attr('captureName', str(event.captureName)), attr('ok', { boolValue: event.ok })];
    case 'ceiling-reached':
      return [attr('spentUsd', { doubleValue: event.spentUsd }), attr('ceilingUsd', { doubleValue: event.ceilingUsd })];
    case 'budget-exhausted':
      return [attr('dimension', str(event.dimension))];
    default:
      return [];
  }
}
