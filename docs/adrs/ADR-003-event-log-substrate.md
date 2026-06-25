---
type: adr
title: "ADR-003: One append-only event log; memory and all views are projections"
description: The factory is event-sourced — one append-only log is the substrate and memory and every view are projections of it.
tags: [adr, event-log, event-sourcing, memory, projections]
timestamp: 2026-06-10T21:16:39-05:00
---

# ADR-003: One append-only event log; memory and all views are projections

**Status:** Accepted · **Date:** 2026-06-10 (decided in design revision 2; recorded retroactively) · **Stretch:** no · **Contract:** yes
**Supersedes:** none · **Superseded by:** none

## Context

The first design revision had "traces" (observability) and "memory" (state) as
separate concerns. Provenance, replay, contradiction-checking, and decay each
needed machinery; building them separately would have meant four mechanisms.

## Options considered

- Event sourcing: one append-only log, everything else a projection — chosen.
- Mutable memory store + separate trace log — rejected (provenance and
  point-in-time replay become reconstruction problems instead of queries).
- Full CQRS with separate write/read services — rejected (operational
  overkill for a single-process v1).

## Decision

Everything the factory does — receive, decide, split, spawn, eval verdict,
escalation, gate, memory write, promotion, emission — is a member of the
`FactoryEvent` union appended to one `EventStore`. Memory (`projectMemory`),
trace stats, and run-tree rendering are pure projections over the log. The
log append is the serialization point.

## Rationale

One commitment buys provenance for free, point-in-time memory reconstruction
(golden-set replays see what the original run saw), forgetting-with-an-audit-
trail (the projection forgets; the log remembers), and serialized writes as a
precondition for contradiction-check-on-write — with no additional machinery.

## Tradeoffs & risks

- Projections recompute over the full log; at scale this needs snapshotting or
  incremental projection. Accepted: v1 logs are small; the projection contract
  is what's fixed, the implementation is swappable (DESIGN.md defers this
  explicitly).
- Event-union growth: every new mechanism adds members. Accepted as the honest
  cost of "everything is an event."

## Consequences for the build

- **Source of truth:** `src/contract/events.ts` (the union) and
  `src/eventlog/` (stores + projections).
- New mechanisms must define their events in the contract barrier and read
  state only through projections — never through side-channel state.
- Exhaustive `switch` over the union in projections is the consumer
  discipline; adding a member must break compilation until handled.
