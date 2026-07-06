/**
 * The reference {@link EventSink}: writes each event as one NDJSON line to a
 * stream (stdout by default). It proves the fan-out seam end-to-end without any
 * vendor dependency — the LangSmith and OTLP adapters follow the same shape
 * (see docs/observability.md), replacing the line writer with an SDK call.
 *
 * Wired at the daemon when CORELLIA_SINK_STDOUT is set (src/daemon/config.ts).
 */

import type { EventSink, FactoryEvent } from '../contract/events.js';

/** A minimal sink target — the writable side of a stream, or any line writer. */
export interface LineWriter {
  write(chunk: string): unknown;
}

export class StdoutSink implements EventSink {
  readonly #out: LineWriter;

  constructor(out: LineWriter = process.stdout) {
    this.#out = out;
  }

  emit(event: FactoryEvent): void {
    this.#out.write(JSON.stringify(event) + '\n');
  }
}
