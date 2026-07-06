/**
 * A store decorator that fans each successfully-appended event out to a list of
 * best-effort {@link EventSink}s. The inner store owns durability; the sinks are
 * purely additive observers (export to LangSmith, OTLP, an ndjson debug stream).
 *
 * The append order is the invariant: an event reaches a sink only *after* the
 * inner store has persisted it, and a sink that throws is caught and dropped so
 * observability can never break the factory's durability (ADR-003). `list`
 * delegates unchanged — reads never see the sinks.
 */

import type { EventSink, EventStore, FactoryEvent } from '../contract/events.js';

export class SinkFanoutStore implements EventStore {
  readonly #inner: EventStore;
  readonly #sinks: readonly EventSink[];
  readonly #onSinkError: (sink: EventSink, error: unknown) => void;

  constructor(
    inner: EventStore,
    sinks: readonly EventSink[],
    onSinkError: (sink: EventSink, error: unknown) => void = defaultOnSinkError,
  ) {
    this.#inner = inner;
    this.#sinks = sinks;
    this.#onSinkError = onSinkError;
  }

  async append(e: FactoryEvent): Promise<void> {
    await this.#inner.append(e);
    for (const sink of this.#sinks) {
      try {
        sink.emit(e);
      } catch (error) {
        this.#onSinkError(sink, error);
      }
    }
  }

  list(filter?: { goalId?: string; type?: FactoryEvent['type'] }): Promise<FactoryEvent[]> {
    return this.#inner.list(filter);
  }

  /** Flush every sink that declares a flush, swallowing individual failures. */
  async flush(): Promise<void> {
    for (const sink of this.#sinks) {
      if (!sink.flush) continue;
      try {
        await sink.flush();
      } catch (error) {
        this.#onSinkError(sink, error);
      }
    }
  }
}

function defaultOnSinkError(_sink: EventSink, error: unknown): void {
  const detail = error instanceof Error ? error.message : String(error);
  console.warn(`[event-sink] emit failed (dropped): ${detail}`);
}
