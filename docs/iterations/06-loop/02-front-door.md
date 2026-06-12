---
id: F-62
title: "Daemonized front door + frozen Brief"
iteration: 06-loop
type: implement
intent: production
status: Not started
dependsOn: []
contracts: [ADR-026, ADR-008]
---

# Feature: Daemonized front door + frozen Brief

**ID:** F-62 · **Iteration:** 06-loop · **Status:** Not started

## What this delivers (before → after)
**Before:** the Listener (`src/listener/listener.ts`) is a clockless library
class driven only by tests and live scripts; the brief surface is a convention,
not a contract.
**After:** a daemon owns the listener — webhook commission/answer/status with
bearer auth, a dev REPL, graceful SIGTERM — and the Brief contract is a frozen
type in `src/contract/`.

## Reading brief
- ADR-026 (decision + tradeoffs)
- ADR-008 (single-brief-authority invariant)
- ADR-012 (credentials from environment)
- `src/listener/listener.ts` — full file; `CommissionInput`, `Parked`,
  park/answer/tick lifecycle
- `src/substrate/` — Pg and JSONL store implementations
- `src/engine/worktree.ts` — `preserveTree` (SIGTERM safe-shutdown path)
- `src/contract/brief.ts` — does not exist yet; this feature creates it

## Dependencies (must exist before this starts)
None — can start as soon as the iteration's contracts are frozen.

## Contracts touched
- Brief contract (source of truth: ADR-026, `src/contract/brief.ts`) —
  introduces `CommissionInput` (moved verbatim from `listener.ts`),
  `ParkedBrief { intentId; question; deadline }`,
  `FrontDoorStatus { running; queued; parked }`, and
  `StandingEnvelope { budget; spendCeilingUsd }`; listener and daemon consume
  them; no duplicate shapes remain.
- ADR-008 single-brief-authority invariant — pinned by test; exactly one
  listener instance owns park resolution in both daemon and REPL modes.

## Acceptance criteria
1. `src/contract/brief.ts` exports `CommissionInput`, `ParkedBrief`,
   `FrontDoorStatus`, and `StandingEnvelope`; `listener.ts` consumes them;
   no duplicate shapes remain in `listener.ts`.
2. `POST /intents` with the correct bearer token commissions an intent and
   returns its `id`; missing or wrong token → 401 with no state change.
3. `POST /intents/:id/answer` resumes a parked intent; `GET /status` returns
   `FrontDoorStatus` JSON.
4. The daemon owns the clock: a parked intent's TTL expiry fires via periodic
   `tick()` without any client call.
5. SIGTERM: the in-flight tree is preserved (`preserveTree`, never
   mid-collect teardown), the server closes, exit 0; restart against the same
   store shows the parked intents in `GET /status`.
6. REPL mode drives commission/answer/status against the same in-process
   listener; exactly one brief authority exists (ADR-008 invariant pinned by
   test).
7. `DATABASE_URL` set → Pg substrate; otherwise JSONL path from env.

## Testing requirements
- HTTP integration on an ephemeral port with a scripted brain: commission →
  run → status round-trip.
- Spawn-and-SIGTERM child-process test: verify exit 0 and preserved worktree.
- Auth tests: 401 on bad/missing token, 200 on valid token.
- Single-brief-authority contract test: daemon and REPL share one listener
  instance (no second instantiation).

## Manual setup required
`FRONT_DOOR_TOKEN` in the engine's environment for live runs; also
`DATABASE_URL` for Pg and `GITHUB_TOKEN` for any live PR work downstream.
None required for scripted tests.

## Build plan (approved)
- [x] Chunk 1 — Brief contract freeze + listener consumption: create
  `src/contract/brief.ts` with all four shapes; update `listener.ts` imports;
  delete duplicate inline definitions; satisfies AC 1; tests:
  `tests/contract/brief.test.ts` (shape round-trip); contract touchpoint:
  `brief.ts` barrier shapes.
- [x] Chunk 2 — `node:http` server with bearer auth and three routes: `POST
  /intents`, `POST /intents/:id/answer`, `GET /status`; satisfies AC 2, 3;
  tests: `tests/daemon/http.test.ts` (ephemeral port, scripted brain);
  contract touchpoint: `FrontDoorStatus` wire shape.
- [x] Chunk 3 — Daemon entrypoint: periodic `tick()` clock, substrate
  selection (`DATABASE_URL` → Pg else JSONL), SIGTERM handler calling
  `preserveTree`; satisfies AC 4, 5, 7; tests:
  `tests/daemon/sigterm.test.ts` (child-process spawn); contract touchpoint:
  `StandingEnvelope` on daemon config.
- [x] Chunk 4 — REPL mode: stdin readline drives commission/answer/status
  against the same in-process listener; satisfies AC 6; tests:
  `tests/daemon/repl.test.ts` (piped stdin); contract touchpoint: ADR-008
  single-authority pin.
- [x] Chunk 5 — Integration + signal suite: full HTTP lifecycle + SIGTERM +
  auth + substrate selection; satisfies AC 2–7; tests:
  `tests/integration/front-door.test.ts`.

### Test strategy
HTTP tests use an ephemeral `0` port, real `node:http`, and a scripted engine
mock. The SIGTERM test spawns a child process and sends the signal; the test
verifies exit code 0 and that the store records the preserved worktree. Auth
tests check both 401 and 200 paths without an engine mock.

### Contract touchpoints
`src/contract/brief.ts` is a frozen barrier shape. Changes require ADR-026
sign-off. `CommissionInput` moves verbatim from `listener.ts` — the builder
must not add fields during the move.

### Manual setup
None beyond token env vars for operator-run live demos.

### Risks
- Graceful-shutdown grace window vs a long tree: policy is preserve-don't-await
  (ADR-026); the daemon must not block SIGTERM on an in-flight run.
- The HTTP surface is attack surface; v1 mitigations are the bearer token and
  no TLS in-process (the host's proxy owns TLS).
- `CommissionInput` move may ripple into examples/ and live scripts — update
  them as part of this chunk.

## Implementation notes

### Daemon entrypoint (F-66 needs this)
- **File:** `src/daemon/daemon.ts`
- **Invocation (dev):** `npx tsx src/daemon/daemon.ts`
- **Invocation (compiled):** `node dist/src/daemon/daemon.js`
- Required env: `FRONT_DOOR_TOKEN` (required), `FRONT_DOOR_PORT` (default 8080),
  `FRONT_DOOR_HOST` (default 0.0.0.0), `CORELLIA_TICK_MS` (default 5000),
  `CORELLIA_EVENTS_PATH` (JSONL path, default `out/events.jsonl`),
  `DATABASE_URL` (Pg URL; if set, overrides JSONL).

### Substrate selection logic location
- **File:** `src/daemon/config.ts` → `buildStore()`
- `DATABASE_URL` set → `PgEventStore(DATABASE_URL)`; else `JsonlEventStore(CORELLIA_EVENTS_PATH)`
- `buildStore()` is exported from `config.ts` (not `daemon.ts`) so tests and
  F-67 can import it without triggering daemon startup side-effects.

### F-67 seams
- **`buildStore()`** in `src/daemon/config.ts`: import to create a compatible
  event store without spawning the daemon process.
- **`buildStandingEnvelope()`** in `src/daemon/config.ts`: import to read the
  standing envelope for the improvement-loop admission gate (ADR-027, F-63).
- **`FrontDoorServer`** in `src/daemon/http-server.ts`: can be instantiated with
  an externally-constructed `Listener` and `Engine` for live integration tests.
- **`startRepl()`** in `src/daemon/repl.ts`: can be wired to any `Listener`.
- The null engine in `daemon.ts` (`buildNullEngine()`) should be replaced with a
  real `Engine` construction when live LLM calls are needed (F-67 live evidence).

