# Corellia

A recursive software factory. Every unit of work — a PRD, a design, a diff,
a renamed symbol — is a typed **goal**. One recursive operation drives the whole
machine: receive a goal, decide (satisfy it directly, split it into children, or
block on a human decision), evaluate the result through a deterministic gate and
an LLM judge, repair on prescription, escalate on persistent failure, and emit a
typed report upward. The factory's memory, metrics, and visualizations are
pure projections of an append-only event log — there is no other state.

Full specification: [DESIGN.md](DESIGN.md) · [GOAL-TYPES.md](GOAL-TYPES.md)

---

## Quickstart

```bash
npm install

# Run all tests
npm test

# Run the end-to-end demo (writes to out/greeting/)
npm run demo

# Typecheck
npm run typecheck
```

The demo scripts a complete run of a `deliver-intent` goal ("Ship a greeting
CLI") through split, dependency sequencing, deterministic checks,
`critique-code` judge, the repair rung, and `judge-integration`. Console output
includes the running CLI, the goal tree, trace stats, and a control-loop
summary.

---

## Module map

| Module | What it is |
|---|---|
| `src/contract/` | The frozen type layer — the one handoff schema every layer is built on. No engine or brain logic here. |
| `src/engine/` | The recursive engine (`engine.ts`) and pure budget accounting (`budget.ts`). Drives receive → decide → attempt-loop → repair → integrate → emit. |
| `src/eventlog/` | The append-only event stores (`JsonlEventStore`, `InMemoryEventStore`) and pure projection functions (`renderTree`, `traceStats`, `projectMemory`). Every read-model is a fold over the log. |
| `src/library/` | The starter set of goal-type definitions (`starterTypes()`), the deterministic check library (`checks.ts`), and `createRegistry()`. |
| `src/brains/` | `ScriptedBrain` (deterministic, for tests and demos) and `LlmBrain` (any OpenAI-compatible endpoint). |
| `src/substrate/` | Durable store implementations: `PgEventStore`, `PgPatternStore`, and `InMemoryPatternStore`. |

---

## Substrate

The factory's event log and pattern store can be backed by PostgreSQL for
durability across restarts. The SQL substrate provides one authoritative store
per process: writes are serialized through pg's connection pool, and
`bigserial` row order is the canonical append sequence.

**Rationale.** A JSONL file is sufficient for single-process demos. Once the
engine fans out across processes or restarts, you need a store that (a) gives
every writer a stable ordering key without coordination and (b) lets the
pattern flywheel accumulate across runs. PostgreSQL gives both: `INSERT`s are
totally ordered by the WAL, and `ON CONFLICT DO UPDATE` makes pattern recording
idempotent under retry.

**JSONL and in-memory remain the default** for tests, demos, and offline use.
`PgEventStore` and `PgPatternStore` are opt-in — wire them in when you deploy.

### Starting Postgres with docker-compose

```bash
docker compose -f docker-compose.yml up -d postgres
```

This starts Postgres on port `54329` (non-standard to avoid colliding with any
local Postgres on the default 5432).

> **Note:** The `-f docker-compose.yml` flag is required because Docker Compose v2
> prefers `compose.yaml` when both files are present. Without it, `docker compose up`
> picks up `compose.yaml` (the full daemon stack) instead of the dev-only Postgres helper.

### DATABASE_URL convention

```
DATABASE_URL=postgres://postgres:corellia@localhost:54329/postgres
```

Pass this to any process that constructs a `PgEventStore` or `PgPatternStore`.
Both accept either a connection string or a pre-configured `pg.Pool`.

Call `ensureSchema()` once at startup before the first append or record.

### Running the integration tests

```bash
docker compose -f docker-compose.yml up -d postgres
DATABASE_URL=postgres://postgres:corellia@localhost:54329/postgres npx vitest run tests/substrate
```

Without `DATABASE_URL` the Pg test suites are skipped automatically via
`describe.skipIf`, so `npm test` stays green for contributors without a
database.

---

## First live run

Runs a real `deliver-intent` goal ("Ship a word-count CLI") against
OpenRouter's Anthropic models.  The factory splits the goal, implements the
artifact, judges it, and optionally repairs it — all via live LLM calls.

**Setup**

```bash
cp .env.example .env                     # then fill in OPENROUTER_API_KEY
# (real environment variables always win over .env values;
#  `export OPENROUTER_API_KEY=sk-or-...` works too)

# Optional, in .env or exported: pin specific model versions
# CORELLIA_MODEL_LOW=deepseek/deepseek-v4-flash
# CORELLIA_MODEL_MID=deepseek/deepseek-v4-pro
# CORELLIA_MODEL_HIGH=qwen/qwen3-235b-a22b
```

**Run**

```bash
npm run live
```

Artifacts land in `out/live/`; the full event log at `out/live/events.jsonl`.
The script also runs a smoke test of the produced CLI and prints a brain-call
summary (decide / produce / judge / repair counts).

**Expected cost** — a small tree like this typically issues ~10–20 LLM calls
(a few decides, one or two produces, one or two judge calls at haiku/sonnet
class).  At current OpenRouter haiku pricing that is well under $0.01.

**Defaults chosen from `GET https://openrouter.ai/api/v1/models`** (checked
2026-06-10): `anthropic/claude-haiku-latest` (haiku tier),
`anthropic/claude-sonnet-latest` (sonnet tier), `anthropic/claude-opus-4-5`
(opus tier).  Re-check that endpoint if you want newer versions.

---

## Using LlmBrain with any OpenAI-compatible provider

`LlmBrain` talks to any chat-completions endpoint. Supply a `baseUrl`, an
`apiKey`, and a `modelByTier` map:

```ts
import { LlmBrain } from './src/brains/llm.js';

// OpenAI
const brain = new LlmBrain({
  baseUrl: 'https://api.openai.com/v1',
  apiKey: process.env.OPENAI_API_KEY ?? '',
  modelByTier: {
    haiku:  'gpt-4o-mini',
    sonnet: 'gpt-4o',
    opus:   'gpt-4o',
  },
});

// OpenRouter (access Anthropic, Mistral, Llama, etc. through one key)
// openRouterConfig() reads OPENROUTER_API_KEY and optional CORELLIA_MODEL_*
// overrides from process.env and returns a ready-to-use LlmBrainConfig.
import { openRouterConfig } from './src/brains/openrouter.js';
const brain = new LlmBrain(openRouterConfig());

// Local (Ollama, LM Studio, etc.)
const brain = new LlmBrain({
  baseUrl: 'http://localhost:11434/v1',
  apiKey: 'ollama',          // many local servers accept any value
  modelByTier: {
    haiku:  'llama3.2',
    sonnet: 'llama3.2',
    opus:   'llama3.1:70b',
  },
});
```

Inject a `fetchImpl` to stub the network in tests:

```ts
const brain = new LlmBrain({ ..., fetchImpl: myStubFetch });
```

---

## Deploy & operate

Run the factory as a container, locally or in the cloud.

```bash
npm run docker:build      # build the daemon image (compose.yaml)
npm run docker:up         # daemon + Postgres up (detached)
npm run docker:logs       # tail the daemon
npm run docker:down       # stop + remove (keeps the corellia-pgdata volume)
npm run docker:up:dev-db  # dev-only Postgres helper (port 54329)
```

These wrap the `-f compose.yaml` selection so the Compose-v2 file-shadowing rule
is never a footgun. Copy `.env.example` → `.env` and populate it first.

- **[docs/container.md](docs/container.md)** — the local build → up → smoke →
  down loop and the image internals.
- **[docs/deploy.md](docs/deploy.md)** — running remotely and unattended: CI →
  GHCR image delivery, one-command SSH deploy (`scripts/deploy.sh`), state
  placement + backup/restore, host secrets provisioning, restart/upgrade/rollback,
  and observability. Design and alternatives in
  [ADR-045](docs/adrs/ADR-045-factory-deployment-path.md).

---

## Deliberately deferred

These are real features — they appear in DESIGN.md — but are not part of this
walking skeleton:

- **Split-memo flywheel** — eval-gated promotion of split patterns to the
  `type` memory layer so the factory learns which decompositions work.
- **Terraced scan** — the brownfield comprehension pass that builds the
  architecture artifact from an existing codebase before any intent runs.
- **Improvement loop** — routing blocker reports back through admission as
  root goals so the factory repairs its own friction.
- **Grant enforcement** — the runtime check that a goal's tool calls stay
  within the grants declared on its type definition.
- **Risk and authority gates** — the pre-fan-out classification that routes
  high-risk or high-authority goals through a human brief before children spawn.
