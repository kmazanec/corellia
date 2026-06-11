# ADR-004: Postgres as the durable substrate (and the async contract it forced)

**Status:** Accepted · **Date:** 2026-06-10 (decided iteration 2 gate brief; recorded retroactively) · **Stretch:** no · **Contract:** yes
**Supersedes:** none · **Superseded by:** none

## Context

Iteration 1's event log lived in memory/JSONL. The operator asked where the
memory substrate and logging infrastructure should live long-term, naming
LangChain, Postgres, and Neo4j as candidates.

## Options considered

- **Postgres now** — chosen (operator decision, over the assistant's
  SQLite-first recommendation).
- SQLite first, Postgres when multi-process — recommended for zero ops burden,
  rejected for re-doing the migration later.
- Neo4j / graph store — rejected: relationship queries haven't earned graph
  complexity (DESIGN.md defers the projection shape explicitly).
- LangChain memory — rejected: a framework substrate owning seams the factory
  must own (see ADR-001 rationale).

## Decision

Postgres is the durable store: `PgEventStore` and `PgPatternStore` with
parameterized SQL and idempotent schema creation, via the `pg` driver (the one
approved runtime dependency), local instance through `docker-compose` on port
54329. In-memory and JSONL stores remain for tests and offline dev; pg
integration tests skip cleanly without `DATABASE_URL`.

**Forced consequence:** `EventStore` and `MemoryView` became async
(`Promise`-returning) — a frozen-contract change carried as a barrier commit
with every consumer updated atomically (ADR-002 discipline).

## Rationale

Pay the substrate migration once, before the data matters. Postgres also keeps
the upgrade path open (pgvector for memory relevance is a named ride-along)
without changing the store again.

## Tradeoffs & risks

- A running Postgres is now part of the dev loop for durable runs. Mitigated:
  compose file in-repo; everything except pg integration tests runs without it.
- The async contract ripples `await` through every read path. Paid once, done.

## Consequences for the build

- **Source of truth:** `src/substrate/pg-event-store.ts`,
  `src/substrate/pg-pattern-store.ts`, `docker-compose.yml`;
  `DATABASE_URL`/`POSTGRES_PASSWORD` via `.env` (ADR-012).
- New projections/stores must be written against the async interfaces; no
  sync-store assumptions anywhere.
- Schema changes are additive/idempotent until a migration story is needed.
