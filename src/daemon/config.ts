/**
 * Daemon configuration helpers: substrate selection and standing envelope.
 *
 * Extracted from daemon.ts so that tests and F-67 can import buildStore()
 * without triggering the daemon's startup side-effects (token guard,
 * process.exit, server bind, etc.).
 *
 * Substrate selection (AC 7, ADR-026):
 *   DATABASE_URL set → PgEventStore
 *   else             → JsonlEventStore at CORELLIA_EVENTS_PATH, or a
 *                      per-target-repo default (out/<repo-basename>/events.jsonl)
 *                      when that env is unset. See defaultEventsPath().
 */

import { basename, join } from 'node:path';
import { JsonlEventStore } from '../eventlog/jsonl-store.js';
import { PgEventStore } from '../substrate/pg-event-store.js';
import { SinkFanoutStore } from '../eventlog/sink-fanout-store.js';
import { StdoutSink } from '../eventlog/stdout-sink.js';
import type { EventSink, EventStore } from '../contract/events.js';
import type { StandingEnvelope } from '../contract/brief.js';

// ── Substrate ──────────────────────────────────────────────────────────────

export interface StoreHandle {
  store: EventStore;
  /** Close the underlying connection (no-op for JSONL). */
  close: () => Promise<void>;
}

export interface BuildStoreOptions {
  /**
   * The repo the factory is operating on. When present (and CORELLIA_EVENTS_PATH
   * is unset), the default JSONL log path is namespaced per-repo so concurrent
   * runs against different target repos do not clobber each other's log. When
   * absent, falls back to CORELLIA_REPO_ROOT, then to the flat legacy default.
   */
  targetRepoRoot?: string;
}

/**
 * Build the event store from the current environment.
 *
 * This function is a pure factory — it reads env vars but has no side
 * effects beyond constructing the store. Safe to call from tests.
 *
 * F-67 seam: import buildStore() here instead of from daemon.ts.
 */
export function buildStore(opts: BuildStoreOptions = {}): StoreHandle {
  const sinks = buildSinks();

  const dbUrl = process.env['DATABASE_URL'];
  if (dbUrl) {
    const pg = new PgEventStore(dbUrl);
    return {
      store: wrapWithSinks(pg, sinks),
      close: () => pg.close(),
    };
  }

  const eventsPath = process.env['CORELLIA_EVENTS_PATH'] ?? defaultEventsPath(opts.targetRepoRoot);
  const jsonl = new JsonlEventStore(eventsPath);
  return {
    store: wrapWithSinks(jsonl, sinks),
    close: () => Promise.resolve(),
  };
}

/**
 * Register the optional export sinks from the environment. Ships one concrete
 * sink — the ndjson debug sink (CORELLIA_SINK_STDOUT) — proving the fan-out seam;
 * the LangSmith / OTLP adapters are the documented follow-ons (docs/observability.md)
 * that register here behind their own env guards without touching the core.
 */
function buildSinks(): EventSink[] {
  const sinks: EventSink[] = [];
  if (isEnabled(process.env['CORELLIA_SINK_STDOUT'])) {
    sinks.push(new StdoutSink());
  }
  return sinks;
}

/** Wrap the inner store in the fan-out only when at least one sink is registered. */
function wrapWithSinks(inner: EventStore, sinks: readonly EventSink[]): EventStore {
  return sinks.length > 0 ? new SinkFanoutStore(inner, sinks) : inner;
}

function isEnabled(value: string | undefined): boolean {
  return value === '1' || value === 'true';
}

/**
 * The default JSONL event-log path when CORELLIA_EVENTS_PATH is unset.
 *
 * Per target repo: `out/<sanitized-basename>/events.jsonl`, so runs against
 * different target repos write to distinct logs and never clobber each other.
 * When no target repo is discernible, keep the flat legacy default
 * (`<cwd>/out/events.jsonl`).
 */
export function defaultEventsPath(targetRepoRoot?: string): string {
  const repoRoot = targetRepoRoot ?? process.env['CORELLIA_REPO_ROOT'];
  if (repoRoot === undefined || repoRoot.length === 0) {
    return join(process.cwd(), 'out', 'events.jsonl');
  }
  return join(process.cwd(), 'out', sanitizeRepoSegment(repoRoot), 'events.jsonl');
}

/**
 * Reduce a repo path to a single filesystem-safe path segment (its basename with
 * non-alphanumeric runs collapsed to `-`). Empty or root-only paths fall back to
 * `repo` so a valid segment is always produced.
 */
function sanitizeRepoSegment(repoRoot: string): string {
  const name = basename(repoRoot.replace(/[/\\]+$/, ''));
  const sanitized = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return sanitized.length > 0 ? sanitized : 'repo';
}

// ── Standing envelope (F-63 seam) ─────────────────────────────────────────

/**
 * Build the standing envelope from the environment if both vars are present.
 *
 * STANDING_BUDGET_JSON — JSON-encoded Budget
 * STANDING_SPEND_CEILING_USD — number (dollars)
 *
 * F-63 owns the admission-gate semantics (ADR-027); the daemon carries the
 * envelope on its config surface and logs it at startup.
 *
 * F-67 seam: import buildStandingEnvelope() here to read the same value
 * without launching the daemon.
 */
export function buildStandingEnvelope(): StandingEnvelope | undefined {
  const budgetJson = process.env['STANDING_BUDGET_JSON'];
  const ceilingStr = process.env['STANDING_SPEND_CEILING_USD'];
  if (!budgetJson || !ceilingStr) return undefined;
  try {
    const budget = JSON.parse(budgetJson) as StandingEnvelope['budget'];
    const spendCeilingUsd = parseFloat(ceilingStr);
    return { budget, spendCeilingUsd };
  } catch {
    console.warn('[config] STANDING_BUDGET_JSON is not valid JSON — standing envelope disabled');
    return undefined;
  }
}
