/**
 * The OTLP trace adapter: the second concrete {@link EventSink}, exporting the
 * factory's goal tree to any OTLP/HTTP JSON collector (Grafana Tempo, Honeycomb,
 * Datadog, …) with NO vendor SDK — plain `fetch` against the OTLP/HTTP JSON
 * encoding (ADR-001, dependency-free core).
 *
 * It folds `FactoryEvent`s into spans per the neutral event→span mapping in
 * docs/observability.md: `goal-received` opens a span, `child-spawned`/`goal.parentId`
 * set parent linkage, step-shaped events (`tool-call`, `decided`, `judge-verdict`,
 * `step`, …) become span events, `usage` becomes token attributes, and
 * `emitted`/`blocked` close the span (error status on a blocking outcome). A span
 * is exportable only once closed; open spans are buffered and closed ones are
 * POSTed in batches (size- or time-triggered). `flush()` drains everything,
 * marking still-open spans `factory.incomplete=true` rather than dropping them.
 *
 * `emit()` only folds into the buffer — the HTTP POST happens on the flush timer
 * or the size trigger, fire-and-forget, so a slow collector never slows a run.
 * Every network failure is caught and logged at most once per burst; the fan-out
 * already guards against throws, but the sink must not spam the operator.
 *
 * The OTLP wire-format construction (ids, attributes, the resourceSpans shape)
 * lives in {@link ./otlp-encoding.js}; this module owns event folding, batching,
 * and export.
 */

import type { EventSink, FactoryEvent } from '../contract/events.js';
import {
  attr,
  int,
  msToNano,
  rootFromGoalId,
  spanEvent,
  spanId,
  stepEventAttributes,
  str,
  traceId,
  traceRequest,
  usageOf,
  SPAN_KIND_INTERNAL,
  STATUS_ERROR,
  STATUS_UNSET,
  type OtlpSpan,
  type OtlpValue,
  type SpanEvent,
} from './otlp-encoding.js';
import type { Usage } from '../contract/goal.js';

/** The subset of `fetch` the sink needs — injectable so tests never hit the network. */
export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean; status: number }>;

/** A pausable timer seam so tests can drive the flush clock deterministically. */
export interface TimerControl {
  set(callback: () => void, ms: number): void;
  clear(): void;
}

export interface OtlpSinkOptions {
  /** Collector base URL; `/v1/traces` is appended if not already present. */
  endpoint: string;
  /** Extra headers (auth) — e.g. Honeycomb's `x-honeycomb-team`, Grafana's `Authorization`. */
  headers?: Record<string, string>;
  /** `service.name` resource attribute. Defaults to `corellia`. */
  serviceName?: string;
  /** Export once this many spans are closed and buffered. Default 50. */
  batchSize?: number;
  /** Export at most this often (ms) even below the batch size. Default 5000. */
  flushIntervalMs?: number;
  /** Injected fetch; defaults to the global. */
  fetch?: FetchLike;
  /** Injected interval timer; defaults to setInterval/clearInterval. */
  timer?: TimerControl;
  /** Sink for one-line diagnostics; defaults to console.warn. */
  onError?: (message: string) => void;
}

/** A span under construction: opened by goal-received, closed by emitted/blocked. */
interface OpenSpan {
  goalId: string;
  parentId: string | null;
  name: string;
  goalType: string;
  startUnixNano: string;
  endUnixNano: string | null;
  events: SpanEvent[];
  attributes: Map<string, OtlpValue>;
  status: { code: number; message?: string };
}

export class OtlpSink implements EventSink {
  readonly #endpoint: string;
  readonly #headers: Record<string, string>;
  readonly #serviceName: string;
  readonly #batchSize: number;
  readonly #flushIntervalMs: number;
  readonly #fetch: FetchLike;
  readonly #timer: TimerControl;
  readonly #onError: (message: string) => void;

  readonly #open = new Map<string, OpenSpan>();
  #closed: OpenSpan[] = [];
  #timerRunning = false;
  #errorLoggedThisBurst = false;

  constructor(opts: OtlpSinkOptions) {
    this.#endpoint = tracesEndpoint(opts.endpoint);
    this.#headers = opts.headers ?? {};
    this.#serviceName = opts.serviceName ?? 'corellia';
    this.#batchSize = opts.batchSize ?? 50;
    this.#flushIntervalMs = opts.flushIntervalMs ?? 5000;
    this.#fetch = opts.fetch ?? defaultFetch;
    this.#timer = opts.timer ?? defaultTimer();
    this.#onError = opts.onError ?? ((m) => console.warn(m));
  }

  emit(event: FactoryEvent): void {
    this.#fold(event);
    this.#ensureTimer();
    if (this.#closed.length >= this.#batchSize) {
      void this.#export(this.#drainClosed());
    }
  }

  /** Drain every buffered span — closed and still-open (marked incomplete) — and stop the timer. */
  async flush(): Promise<void> {
    for (const span of this.#open.values()) {
      span.attributes.set('factory.incomplete', { boolValue: true });
      if (span.endUnixNano === null) span.endUnixNano = span.startUnixNano;
      this.#closed.push(span);
    }
    this.#open.clear();
    this.#timer.clear();
    this.#timerRunning = false;
    await this.#export(this.#drainClosed());
  }

  // ── Folding events into spans ──────────────────────────────────────────────

  #fold(event: FactoryEvent): void {
    const nano = msToNano(event.at);

    if (event.type === 'goal-received') {
      this.#openSpan(event, nano);
      return;
    }

    const span = this.#open.get(event.goalId);
    if (span === undefined) return; // An event for a goal we never opened — ignore.

    switch (event.type) {
      case 'emitted':
        this.#closeSpan(span, nano, event.report.blockers);
        break;
      case 'blocked':
        this.#closeSpan(span, nano, [event.brief.question], event.resolution);
        break;
      case 'child-spawned':
        // Parent linkage is carried on the child's own goal.parentId; the edge is
        // recorded here as a timeline event so dependsOn is not lost.
        span.events.push(spanEvent(nano, 'child-spawned', [
          attr('corellia.child.id', str(event.childId)),
          attr('corellia.child.type', str(event.childType)),
          attr('corellia.child.dependsOn', str(event.dependsOn.join(','))),
        ]));
        break;
      default:
        this.#recordStepEvent(span, event, nano);
        break;
    }
  }

  #openSpan(event: Extract<FactoryEvent, { type: 'goal-received' }>, nano: string): void {
    if (this.#open.has(event.goalId)) return; // Idempotent on a duplicated goal-received.
    this.#open.set(event.goalId, {
      goalId: event.goalId,
      parentId: event.goal.parentId,
      name: event.goal.title,
      goalType: event.goal.type,
      startUnixNano: nano,
      endUnixNano: null,
      events: [],
      attributes: new Map<string, OtlpValue>([
        ['corellia.goal.id', str(event.goalId)],
        ['corellia.goal.type', str(event.goal.type)],
      ]),
      status: { code: STATUS_UNSET },
    });
  }

  #closeSpan(span: OpenSpan, nano: string, blockers: string[], resolution?: string): void {
    span.endUnixNano = nano;
    if (blockers.length > 0) {
      span.status = { code: STATUS_ERROR, message: blockers.join(' | ') };
    }
    if (resolution !== undefined) {
      span.attributes.set('corellia.block.resolution', str(resolution));
    }
    this.#open.delete(span.goalId);
    this.#closed.push(span);
  }

  /** Fold a step-shaped event into a span event, accumulating usage tokens as attributes. */
  #recordStepEvent(span: OpenSpan, event: FactoryEvent, nano: string): void {
    span.events.push(spanEvent(nano, event.type, stepEventAttributes(event)));

    const usage = usageOf(event);
    if (usage !== undefined) accumulateUsage(span, usage);

    // A failing verdict/check sets the span's error status even before it closes.
    if (
      (event.type === 'judge-verdict' || event.type === 'deterministic-checked') &&
      !event.verdict.pass
    ) {
      span.status = { code: STATUS_ERROR, message: `${event.type} failed` };
    }
  }

  // ── Export ─────────────────────────────────────────────────────────────────

  #drainClosed(): OpenSpan[] {
    const batch = this.#closed;
    this.#closed = [];
    return batch;
  }

  #ensureTimer(): void {
    if (this.#timerRunning) return;
    this.#timerRunning = true;
    this.#timer.set(() => {
      if (this.#closed.length > 0) void this.#export(this.#drainClosed());
    }, this.#flushIntervalMs);
  }

  async #export(spans: OpenSpan[]): Promise<void> {
    if (spans.length === 0) return;
    const request = traceRequest(this.#serviceName, spans.map((span) => this.#toSpan(span)));
    const body = JSON.stringify(request);
    try {
      const res = await this.#fetch(this.#endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...this.#headers },
        body,
      });
      if (!res.ok) {
        this.#logOnce(`[otlp-sink] collector returned HTTP ${res.status}`);
      } else {
        this.#errorLoggedThisBurst = false; // A success re-arms one log for the next burst.
      }
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      this.#logOnce(`[otlp-sink] export failed (dropped ${spans.length} spans): ${detail}`);
    }
  }

  #logOnce(message: string): void {
    if (this.#errorLoggedThisBurst) return;
    this.#errorLoggedThisBurst = true;
    this.#onError(message);
  }

  #toSpan(span: OpenSpan): OtlpSpan {
    const parentSpanId = span.parentId !== null ? spanId(span.parentId) : undefined;
    return {
      traceId: this.#traceIdFor(span),
      spanId: spanId(span.goalId),
      ...(parentSpanId !== undefined ? { parentSpanId } : {}),
      name: span.name,
      kind: SPAN_KIND_INTERNAL,
      startTimeUnixNano: span.startUnixNano,
      endTimeUnixNano: span.endUnixNano ?? span.startUnixNano,
      attributes: [...span.attributes.entries()].map(([key, value]) => ({ key, value })),
      events: span.events,
      status: span.status.message !== undefined
        ? { code: span.status.code, message: span.status.message }
        : { code: span.status.code },
    };
  }

  /**
   * The trace id is the hash of the tree-root goalId. Walk `parentId` links up to
   * the root we have seen; if an ancestor's span was already exported (not in the
   * open/closed sets), fall back to the root segment encoded in the goalId path.
   * Events are appended in causal order, so the root is normally known.
   */
  #traceIdFor(span: OpenSpan): string {
    let current = span;
    const seen = new Set<string>();
    while (current.parentId !== null && !seen.has(current.goalId)) {
      seen.add(current.goalId);
      const parent = this.#open.get(current.parentId) ?? this.#closedById(current.parentId);
      if (parent === undefined) return traceId(rootFromGoalId(current.parentId));
      current = parent;
    }
    return traceId(current.goalId);
  }

  #closedById(goalId: string): OpenSpan | undefined {
    return this.#closed.find((s) => s.goalId === goalId);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function tracesEndpoint(endpoint: string): string {
  const trimmed = endpoint.replace(/\/+$/, '');
  return trimmed.endsWith('/v1/traces') ? trimmed : `${trimmed}/v1/traces`;
}

function accumulateUsage(span: OpenSpan, usage: Usage): void {
  bump(span, 'corellia.usage.prompt_tokens', usage.promptTokens);
  bump(span, 'corellia.usage.completion_tokens', usage.completionTokens);
  if (usage.cachedPromptTokens !== undefined) {
    bump(span, 'corellia.usage.cached_prompt_tokens', usage.cachedPromptTokens);
  }
  if (usage.costUsd !== undefined) {
    const prior = span.attributes.get('corellia.usage.cost_usd');
    const priorCost = prior !== undefined && 'doubleValue' in prior ? prior.doubleValue : 0;
    span.attributes.set('corellia.usage.cost_usd', { doubleValue: priorCost + usage.costUsd });
  }
}

function bump(span: OpenSpan, key: string, delta: number): void {
  const prior = span.attributes.get(key);
  const priorValue = prior !== undefined && 'intValue' in prior ? Number(prior.intValue) : 0;
  span.attributes.set(key, int(priorValue + delta));
}

// ── Defaults ────────────────────────────────────────────────────────────────

const defaultFetch: FetchLike = (url, init) =>
  fetch(url, init).then((res) => ({ ok: res.ok, status: res.status }));

function defaultTimer(): TimerControl {
  let handle: ReturnType<typeof setInterval> | undefined;
  return {
    set(callback, ms) {
      handle = setInterval(callback, ms);
      // Do not keep the process alive solely for the flush timer.
      if (typeof handle.unref === 'function') handle.unref();
    },
    clear() {
      if (handle !== undefined) clearInterval(handle);
      handle = undefined;
    },
  };
}
