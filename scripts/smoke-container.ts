/**
 * Container smoke test (F-66, AC 4) — OPERATOR-RUN, NOT CI.
 *
 * Commissions a trivial `write-prd` goal through the published webhook
 * (`POST /intents`), polls `GET /status` until the intent is emitted (i.e. it
 * has left the running/queued/parked sets), then prints the report and the
 * cost line.
 *
 * Run AGAINST A RUNNING STACK:
 *   docker compose up -d        # daemon + postgres healthy
 *   npx tsx scripts/smoke-container.ts
 *
 * Required env (sourced from .env via loadDotEnv, or the shell):
 *   FRONT_DOOR_TOKEN   — bearer token the daemon enforces (required)
 *
 * Optional env:
 *   SMOKE_BASE_URL     — front-door base URL (default http://localhost:8080)
 *   SMOKE_TIMEOUT_MS   — give-up wall-clock for the poll (default 120000)
 *   SMOKE_POLL_MS      — poll interval (default 2000)
 *   CORELLIA_EVENTS_PATH — when the daemon runs the JSONL substrate AND the log
 *                          is readable from this host, the script reads the
 *                          emitted report + cost back from it (best-effort). On
 *                          the Postgres substrate the report/cost live in the DB
 *                          and are not fetched here — the script reports webhook
 *                          + admission + emission liveness and points the
 *                          operator at the event store for the full report.
 *
 * Honesty note: the shipped daemon wires a NULL engine (see src/daemon/daemon.ts)
 * that rejects every run, so against the shipped image the commissioned intent
 * does not converge to a real report — the tree errors out and the intent simply
 * leaves the running set. This script then proves the webhook + admission +
 * status surface end-to-end. A real report requires the live-engine entrypoint
 * (F-67).
 *
 * @module scripts/smoke-container
 */

import { loadDotEnv } from '../src/env.js';
import { costSummary } from '../src/eventlog/projections.js';
import type { CommissionInput, FrontDoorStatus } from '../src/contract/brief.js';
import type { FactoryEvent } from '../src/contract/events.js';

loadDotEnv();

// ── Config ─────────────────────────────────────────────────────────────────

const token = process.env['FRONT_DOOR_TOKEN'];
if (!token) {
  console.error('FRONT_DOOR_TOKEN is required — set it (or populate .env) and retry');
  process.exit(1);
}

const baseUrl = (process.env['SMOKE_BASE_URL'] ?? 'http://localhost:8080').replace(/\/$/, '');
const timeoutMs = parseInt(process.env['SMOKE_TIMEOUT_MS'] ?? '120000', 10);
const pollMs = parseInt(process.env['SMOKE_POLL_MS'] ?? '2000', 10);
const eventsPath = process.env['CORELLIA_EVENTS_PATH'];

const authHeaders = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };

// ── The trivial commission ───────────────────────────────────────────────────

const intentId = `smoke-write-prd-${Date.now()}`;

const commission: CommissionInput = {
  id: intentId,
  title: 'Smoke: a trivial PRD for a hello-world note-taker',
  spec: {
    goal: 'Write a one-paragraph PRD for a minimal command-line note-taker.',
    notes: 'Container smoke run — the smallest write-prd that exercises the webhook.',
  },
  scope: ['docs/smoke/'],
  budget: { attempts: 1, tokens: 50_000, toolCalls: 10, wallClockMs: 60_000 },
  intent: 'spike',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function getStatus(): Promise<FrontDoorStatus> {
  const res = await fetch(`${baseUrl}/status`, { headers: authHeaders });
  if (res.status !== 200) {
    throw new Error(`GET /status returned ${res.status} (expected 200)`);
  }
  return (await res.json()) as FrontDoorStatus;
}

function isPresent(status: FrontDoorStatus, id: string): boolean {
  return (
    status.running.includes(id) ||
    status.queued.includes(id) ||
    status.parked.some((p) => p.intentId === id)
  );
}

/** Best-effort: read the emitted report + cost from a host-readable JSONL log. */
async function readEvidenceFromLog(id: string): Promise<void> {
  if (!eventsPath) {
    console.log(
      '\n[evidence] CORELLIA_EVENTS_PATH not set — report + cost live in the daemon\'s\n' +
        '           event store (Postgres or the container\'s JSONL). Inspect them there:\n' +
        '             docker compose exec postgres psql -U postgres \\\n' +
        `               -c "select type, payload from corellia_events where goal_id like '${id}%' order by id;"`,
    );
    return;
  }

  const { readFile } = await import('node:fs/promises');
  let raw: string;
  try {
    raw = await readFile(eventsPath, 'utf8');
  } catch {
    console.log(`\n[evidence] CORELLIA_EVENTS_PATH=${eventsPath} not readable from this host — skipping log read`);
    return;
  }

  const events: FactoryEvent[] = raw
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as FactoryEvent)
    .filter((e) => e.goalId === id || e.goalId.startsWith(id));

  const emitted = events.find((e) => e.type === 'emitted');
  if (emitted && emitted.type === 'emitted') {
    console.log('\n── Report ───────────────────────────────────────────────');
    console.log(JSON.stringify(emitted.report, null, 2));
  } else {
    console.log('\n[evidence] no `emitted` event for this intent in the log (null engine, or still running)');
  }

  const cost = costSummary(events).tree;
  const usd = cost.costUsd !== undefined ? `$${cost.costUsd.toFixed(4)}` : '$0.0000 (no metered usage)';
  console.log('\n── Cost ─────────────────────────────────────────────────');
  console.log(`cost: ${usd}  ·  prompt=${cost.promptTokens} completion=${cost.completionTokens}`);
}

// ── Run ───────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(`[smoke] base=${baseUrl}  intent=${intentId}`);

  // 1. Health gate: GET /status must answer 200.
  const initial = await getStatus();
  console.log(`[smoke] /status ok — running=${initial.running.length} queued=${initial.queued.length} parked=${initial.parked.length}`);

  // 2. Commission via POST /intents (expect 202 with { id }).
  const postRes = await fetch(`${baseUrl}/intents`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify(commission),
  });
  if (postRes.status !== 202) {
    const body = await postRes.text();
    throw new Error(`POST /intents returned ${postRes.status} (expected 202): ${body}`);
  }
  console.log(`[smoke] commissioned ${intentId} (202)`);

  // 3. Poll until the intent has left running/queued/parked, or timeout.
  const deadline = Date.now() + timeoutMs;
  let lastSeen = true;
  while (Date.now() < deadline) {
    await sleep(pollMs);
    const status = await getStatus();
    const present = isPresent(status, intentId);
    if (present !== lastSeen) {
      console.log(`[smoke] poll — intent ${present ? 'present' : 'emitted/gone'}`);
      lastSeen = present;
    }
    if (!present) {
      console.log(`[smoke] intent emitted (left running/queued/parked)`);
      await readEvidenceFromLog(intentId);
      console.log('\n[smoke] PASS — webhook + admission + status surface verified');
      return;
    }
  }

  console.error(`[smoke] TIMEOUT after ${timeoutMs}ms — intent still present in /status`);
  process.exit(1);
}

main().catch((err: unknown) => {
  console.error('[smoke] FAILED:', err instanceof Error ? err.message : err);
  process.exit(1);
});
