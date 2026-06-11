# Corellia — Architecture

**Status:** living overview · **Date:** 2026-06-10
**Sources of truth:** [DESIGN.md](../DESIGN.md) (the locked domain
architecture) · [docs/adrs/](./adrs/) (implementation decisions) ·
[PRD.md](./PRD.md) (WHAT/WHY) · [GOAL-TYPES.md](../GOAL-TYPES.md) (the type
library)

## How this document relates to DESIGN.md

Two architecture layers, deliberately separate:

- **DESIGN.md is the domain architecture** — the recursive operation, the
  evals, memory, the event log, the human gaps. It is **locked**: changes are
  human design decisions, never build outputs.
- **This file + the ADRs are the implementation architecture** — the tech
  decisions that realize the design in a concrete codebase. ADRs supersede;
  they never silently rewrite. A shared shape decided here is flagged
  `Contract: yes` and freezes in `src/contract/` (ADR-002).

When a downstream artifact (roadmap, feature spec, build plan) needs a
decision's WHY, it cites the ADR; when it needs a mechanism's WHY, it cites
the DESIGN.md section. Nothing downstream re-derives either.

## Executive summary

A single-process TypeScript engine executes the design's one recursive
operation over typed goals, with all shared shapes frozen in `src/contract/`
(ADR-002). Every action appends to one event log; memory, stats, and views
are projections (ADR-003), durably stored in Postgres (ADR-004). Models are
reached only through one provider-agnostic `Brain` seam (ADR-005). Budgets
gate on four dimensions (ADR-007), repair is the cheap rung inside an attempt
(ADR-006), risk gates fail safe (ADR-010), and structure is trusted only by
human signoff (ADR-011). The factory is operated by one person at a terminal
(PRD), and its output is always a PR.

## System overview — component map

| Module | Realizes (DESIGN.md) | Notes |
| --- | --- | --- |
| `src/contract/` | the handoff contract, one schema every level | frozen barrier — ADR-002 |
| `src/engine/` | the single operation; split gate, three evals, control loop, budgets, scheduler, authority gate | DAG-parallel via the dependency structure |
| `src/eventlog/` | the event log + projections (memory, trace stats, tree render) | ADR-003; in-memory + JSONL stores for tests |
| `src/substrate/` | durable stores (Postgres event + pattern stores) | ADR-004 |
| `src/brains/` | one brain, many harnesses — scripted + live LLM | ADR-005 |
| `src/library/` | goal-types, deterministic checks, constitution lints, risk classifier | ADR-010, ADR-013 |
| `src/flywheel/` | spec-shape signatures for memoized splits | ADR-011 |
| `src/listener/` | the persistent front door: admission, park/TTL, brief authority | ADR-008 |
| `src/env.ts` | secrets via environment | ADR-012 |
| `examples/` | scripted demo + live OpenRouter run | outside `src`; included in typecheck |

## Decision index

| ADR | Decision | Status | Stretch | Contract |
|-----|----------|--------|---------|----------|
| [ADR-001](./adrs/ADR-001-typescript-esm-zero-deps.md) | TypeScript strict ESM, zero runtime deps by default | Accepted | no | no |
| [ADR-002](./adrs/ADR-002-frozen-contract-module.md) | `src/contract/` is the frozen contract barrier | Accepted | no | yes |
| [ADR-003](./adrs/ADR-003-event-log-substrate.md) | One append-only event log; everything else projects | Accepted | no | yes |
| [ADR-004](./adrs/ADR-004-postgres-substrate-async-contract.md) | Postgres substrate; async EventStore/MemoryView | Accepted | no | yes |
| [ADR-005](./adrs/ADR-005-provider-agnostic-brain.md) | Provider-agnostic Brain; OpenRouter default | Accepted | no | yes |
| [ADR-006](./adrs/ADR-006-repair-within-attempt.md) | Repair runs inside the producing attempt | Accepted | no | no |
| [ADR-007](./adrs/ADR-007-four-dimension-budget.md) | Four-dimension budgets, subdivided, all gating | Accepted | no | yes |
| [ADR-008](./adrs/ADR-008-listener-owns-brief.md) | The Listener owns the brief seam | Accepted | no | no |
| [ADR-009](./adrs/ADR-009-memory-promotion-projection-policy.md) | Memory trust is projection policy | Accepted | no | no |
| [ADR-010](./adrs/ADR-010-risk-gating-policy.md) | Risk gates fail-safe; 'high' gates, 'medium' records | Accepted | no | no |
| [ADR-011](./adrs/ADR-011-flywheel-trust-mechanics.md) | Spec-shape memo matching; human-only trust | Accepted | no | yes |
| [ADR-012](./adrs/ADR-012-secrets-via-environment.md) | Secrets only through the environment | Accepted | no | no |
| [ADR-013](./adrs/ADR-013-families-exact-grants.md) | Families with exact static grants | Accepted | no | no |
| [ADR-014](./adrs/ADR-014-tool-interface-broker.md) | One Tool contract, one Broker | Accepted | no | yes |
| [ADR-015](./adrs/ADR-015-engine-owned-step-loop.md) | Engine-owned step loop; brain pure per step | Accepted | no | yes |
| [ADR-016](./adrs/ADR-016-worktree-per-tree-bare-exec.md) | Worktree per tree; declared scripts, bare exec | Accepted | no | no |
| [ADR-017](./adrs/ADR-017-provider-usage-accounting.md) | Provider-reported usage; $15 tree ceiling | Accepted | no | no |
| [ADR-018](./adrs/ADR-018-provider-failure-semantics.md) | Three-layer provider-failure resolution | Accepted | no | no |

## Non-goals

Mirror the PRD: no team surfaces, no hosted operation, no web dashboards, no
factory-factory, no dangerous tool grants (spend/deploy/keys/purchases), no
live co-editing.

## Open questions

1. The pattern-trust ceremony surface (CLI vs PR-style review) — ADR-011
   names the API; the surface is undecided.
2. When `src/contract/` gains a Brief type — ADR-008 defers freezing until a
   second brief surface exists.
3. Projection scaling (snapshotting/incremental) — deferred until log size
   demands it (DESIGN.md defers the projection shape).
