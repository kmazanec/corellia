/**
 * The notification adapter: a push-shaped {@link EventSink} that POSTs a compact
 * JSON payload to a configured webhook for the small set of events a human
 * actually needs to *know about* — as opposed to the OTLP sink, which exports
 * every event as a trace for later inspection.
 *
 * DESIGN.md's human contract is push-shaped ("every human touchpoint is a
 * decision brief with a deadline"), but today a brief is discoverable only by
 * polling `GET /status`. This sink closes that gap: when a tree blocks on a
 * question, parks, resumes, opens a PR, or reaches a terminal outcome
 * (done/failed/partial), it fires one fire-and-forget webhook so an operator can
 * walk away from the terminal.
 *
 * The curated set is deliberately small — a firehose is what the OTLP/trace sink
 * is for. Everything not in {@link NOTIFIED_TYPES} is ignored without allocation.
 *
 * Failure discipline mirrors {@link ./otlp-sink.ts}: `emit()` never blocks a run
 * (the POST is fire-and-forget under a short timeout), every network error is
 * caught and logged at most once per burst, and the sink NEVER throws into the
 * fan-out — observability can never break durability (ADR-003). There is no
 * retry: a notification is best-effort, and the durable record is always the
 * event log itself.
 */

import type { EventSink, FactoryEvent } from '../contract/events.js';

/** The subset of `fetch` the sink needs — injectable so tests never hit the network. */
export type NotifyFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number }>;

export interface NotificationSinkOptions {
  /** The webhook URL every payload is POSTed to. */
  webhookUrl: string;
  /** Extra headers (auth) — e.g. a Slack/Discord token or a shared secret. */
  headers?: Record<string, string>;
  /** Per-request timeout in ms before the fire-and-forget POST is abandoned. Default 5000. */
  timeoutMs?: number;
  /** Injected fetch; defaults to the global. */
  fetch?: NotifyFetch;
  /** Sink for one-line diagnostics; defaults to console.warn. */
  onError?: (message: string) => void;
}

/**
 * The compact payload shape POSTed to the webhook. A flat, transport-neutral JSON
 * object (Slack/ntfy/Discord/email bridges all accept a `text` field, so `text`
 * is a ready-to-render one-liner and the structured fields carry the detail).
 */
export interface NotificationPayload {
  /** Which curated moment this is. */
  kind: 'blocked' | 'parked' | 'resumed' | 'pr-opened' | 'tree-done' | 'tree-failed' | 'tree-partial';
  /** The tree/goal the event concerns. */
  goalId: string;
  /** Wall-clock ms of the underlying event. */
  at: number;
  /** A human-readable one-line summary — the field most bridges render directly. */
  text: string;
  /** The decision being asked, on `blocked`/`parked`. */
  question?: string;
  /** The discrete choices offered, on `blocked`. */
  options?: string[];
  /** Absolute wall-clock ms the human has until the safe default fires, on `blocked`/`parked`. */
  deadline?: number;
  /** The safe default that fires at the deadline, on `blocked`/`parked`. */
  onTimeout?: string;
  /** How a `blocked` brief resolved (`deny`/`park`/`bounce`/`answered`). */
  resolution?: string;
  /** The relative route to answer a parked brief, on `blocked`/`parked`. */
  answerRoute?: string;
  /** The human's answer, on `resumed`. */
  answer?: string;
  /** The opened PR's URL, on `pr-opened`. */
  url?: string;
  /** The tree's branch, on `pr-opened`. */
  branch?: string;
  /** Blockers that failed the tree, on `tree-failed`. */
  blockers?: string[];
  /** The modules that blocked, on `tree-partial`. */
  blockedModules?: { goalId: string; title: string; blocker: string }[];
}

/** The events this sink notifies on. Everything else is ignored. */
const NOTIFIED_TYPES: ReadonlySet<FactoryEvent['type']> = new Set([
  'blocked',
  'parked',
  'resumed',
  'pr-opened',
  'emitted',
  'partial-delivered',
]);

export class NotificationSink implements EventSink {
  readonly #webhookUrl: string;
  readonly #headers: Record<string, string>;
  readonly #timeoutMs: number;
  readonly #fetch: NotifyFetch;
  readonly #onError: (message: string) => void;

  /** Goal ids known to be tree roots (parentId === null), so `emitted` notifies only at the top. */
  readonly #roots = new Set<string>();
  #errorLoggedThisBurst = false;

  constructor(opts: NotificationSinkOptions) {
    this.#webhookUrl = opts.webhookUrl;
    this.#headers = opts.headers ?? {};
    this.#timeoutMs = opts.timeoutMs ?? 5000;
    this.#fetch = opts.fetch ?? defaultFetch;
    this.#onError = opts.onError ?? ((m) => console.warn(m));
  }

  emit(event: FactoryEvent): void {
    // Track tree roots so `emitted`/`partial-delivered` notify only at the top of
    // a tree, not for every child that emits a report on its way up.
    if (event.type === 'goal-received') {
      if (event.goal.parentId === null) this.#roots.add(event.goalId);
      return;
    }

    if (!NOTIFIED_TYPES.has(event.type)) return;

    const payload = this.#payloadFor(event);
    if (payload === undefined) return;

    void this.#post(payload);
  }

  // ── Event → payload ────────────────────────────────────────────────────────

  #payloadFor(event: FactoryEvent): NotificationPayload | undefined {
    switch (event.type) {
      case 'blocked':
        return {
          kind: 'blocked',
          goalId: event.goalId,
          at: event.at,
          text: `Decision needed on ${event.goalId}: ${event.brief.question}`,
          question: event.brief.question,
          options: event.brief.options,
          deadline: event.at + event.brief.deadlineMs,
          onTimeout: event.brief.onTimeout,
          resolution: event.resolution,
          answerRoute: answerRoute(event.goalId),
        };
      case 'parked':
        return {
          kind: 'parked',
          goalId: event.goalId,
          at: event.at,
          text: `Parked ${event.goalId} on: ${event.brief.question}`,
          question: event.brief.question,
          options: event.brief.options,
          deadline: event.at + event.ttlMs,
          onTimeout: event.brief.onTimeout,
          answerRoute: answerRoute(event.goalId),
        };
      case 'resumed':
        return {
          kind: 'resumed',
          goalId: event.goalId,
          at: event.at,
          text: `Resumed ${event.goalId} with answer: ${event.answer}`,
          answer: event.answer,
        };
      case 'pr-opened':
        return {
          kind: 'pr-opened',
          goalId: event.goalId,
          at: event.at,
          text: `PR opened for ${event.branch}: ${event.url}`,
          url: event.url,
          branch: event.branch,
        };
      case 'emitted':
        return this.#treeTerminalPayload(event);
      case 'partial-delivered':
        return {
          kind: 'tree-partial',
          goalId: event.goalId,
          at: event.at,
          text: `Tree ${event.goalId} delivered partially — ${event.blockedModules.length} module(s) blocked`,
          blockedModules: event.blockedModules,
        };
      default:
        return undefined;
    }
  }

  /**
   * An `emitted` event fires only for a tree root, and only there — a child's
   * report emission is not an operator-facing terminal. Done when the report has
   * no blockers, failed when it carries them.
   */
  #treeTerminalPayload(
    event: Extract<FactoryEvent, { type: 'emitted' }>,
  ): NotificationPayload | undefined {
    if (!this.#roots.has(event.goalId)) return undefined;

    const blockers = event.report.blockers;
    if (blockers.length === 0) {
      return {
        kind: 'tree-done',
        goalId: event.goalId,
        at: event.at,
        text: `Tree ${event.goalId} done`,
      };
    }
    return {
      kind: 'tree-failed',
      goalId: event.goalId,
      at: event.at,
      text: `Tree ${event.goalId} failed: ${blockers.join(' | ')}`,
      blockers,
    };
  }

  // ── Delivery ─────────────────────────────────────────────────────────────

  async #post(payload: NotificationPayload): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#timeoutMs);
    if (typeof timer.unref === 'function') timer.unref();
    try {
      const res = await this.#fetch(this.#webhookUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...this.#headers },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      if (!res.ok) {
        this.#logOnce(`[notification-sink] webhook returned HTTP ${res.status}`);
      } else {
        this.#errorLoggedThisBurst = false; // A success re-arms one log for the next burst.
      }
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      this.#logOnce(`[notification-sink] delivery failed (dropped ${payload.kind}): ${detail}`);
    } finally {
      clearTimeout(timer);
    }
  }

  #logOnce(message: string): void {
    if (this.#errorLoggedThisBurst) return;
    this.#errorLoggedThisBurst = true;
    this.#onError(message);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** The relative route a human POSTs an answer to (src/daemon/http-server.ts). */
function answerRoute(goalId: string): string {
  return `/intents/${goalId}/answer`;
}

const defaultFetch: NotifyFetch = (url, init) =>
  fetch(url, init).then((res) => ({ ok: res.ok, status: res.status }));
