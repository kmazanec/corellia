/**
 * Daemon configuration helpers: substrate selection and standing envelope.
 *
 * Extracted from daemon.ts so that tests and F-67 can import buildStore()
 * without triggering the daemon's startup side-effects (token guard,
 * process.exit, server bind, etc.).
 *
 * Substrate selection (AC 7, ADR-026):
 *   DATABASE_URL set → PgEventStore
 *   else             → JsonlEventStore at CORELLIA_EVENTS_PATH
 *                      (default: <cwd>/out/events.jsonl)
 */

import { join } from 'node:path';
import { JsonlEventStore } from '../eventlog/jsonl-store.js';
import { PgEventStore } from '../substrate/pg-event-store.js';
import type { EventStore } from '../contract/events.js';
import type { StandingEnvelope } from '../contract/brief.js';

// ── Substrate ──────────────────────────────────────────────────────────────

export interface StoreHandle {
  store: EventStore;
  /** Close the underlying connection (no-op for JSONL). */
  close: () => Promise<void>;
}

/**
 * Build the event store from the current environment.
 *
 * This function is a pure factory — it reads env vars but has no side
 * effects beyond constructing the store. Safe to call from tests.
 *
 * F-67 seam: import buildStore() here instead of from daemon.ts.
 */
export function buildStore(): StoreHandle {
  const dbUrl = process.env['DATABASE_URL'];
  if (dbUrl) {
    const pg = new PgEventStore(dbUrl);
    return {
      store: pg,
      close: () => pg.close(),
    };
  }

  const eventsPath =
    process.env['CORELLIA_EVENTS_PATH'] ?? join(process.cwd(), 'out', 'events.jsonl');
  const jsonl = new JsonlEventStore(eventsPath);
  return {
    store: jsonl,
    close: () => Promise.resolve(),
  };
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
