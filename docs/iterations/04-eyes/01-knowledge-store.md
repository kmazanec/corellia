---
id: F-41
title: Knowledge store + projection
iteration: 04-eyes
type: implement
intent: production
status: not-started
dependsOn: []
contracts: [ADR-019, ADR-003]
---

# Feature: Knowledge store + projection

**ID:** F-41 · **Iteration:** 04-eyes · **Status:** Not started

## What this delivers (before → after)

**Before:** the factory has no representation of what it knows about a repo;
"coverage" is uncomputable.
**After:** knowledge artifacts (`{category, generatedAtSha, confidence,
status, pointers}`) and dive facts (anchored claims) are written as events
and queryable through a `projectKnowledge` projection with per-category
freshness state — provenance and point-in-time reconstruction free via the
log.

## Reading brief

`docs/adrs/ADR-019` (the decision) · `src/contract/knowledge.ts`
post-barrier (frozen shapes) · `src/eventlog/projections.ts` (projection
idiom: `projectMemory`, `costSummary`) · GOAL-TYPES.md § learn.

## Requirements traced (from the PRD)

R11 (artifacts with freshness metadata) · AC-13 discipline · AC-16's
data layer.

## Dependencies / contracts

None hard — builds on the barrier's `src/contract/knowledge.ts` and the
`knowledge-written` / `knowledge-checked` event members. Consumes only.

## Acceptance criteria

1. Given a `knowledge-written` event, then `projectKnowledge(events)` returns
   the artifact as the current one for its repo × category, replacing any
   older artifact for the same key (the log remembers; the projection shows
   latest).
2. Given a `knowledge-checked` event with outcome stale/invalid, then the
   projection reflects the artifact's freshness state accordingly; a
   subsequent `knowledge-written` restores fresh.
3. Given a log replayed to any past event index, then the knowledge state at
   that point reconstructs exactly (AC-13).
4. Dive facts round-trip with their `file:line` anchors and SHA intact.
5. Both pg and in-memory/JSONL stores round-trip the new members.

## Build plan (approved)

- [ ] **Projection + freshness state** — `projectKnowledge` in
  `src/eventlog/projections.ts`: latest artifact per repo×category, freshness
  from interleaved checked events; exhaustive switch arms for the new
  members everywhere the union is switched. Tests:
  `tests/eventlog/projections.test.ts` (new describe — replace/latest, stale
  transitions, point-in-time replay). Run only that file.
- [ ] **Store round-trips** — `tests/eventlog/stores.test.ts` extends:
  knowledge events through InMemory, JSONL, and (skip-without-DATABASE_URL)
  pg stores.
- [ ] **Write helper** — a small `writeKnowledge(store, artifact)` /
  `recordKnowledgeCheck(...)` pair (library-side) so producers don't
  hand-roll events; used by F-44/F-45. Tests in the projection file.

### Test strategy

Pure projection/store unit tests, zero network, mirroring the
`projectMemory`/`costSummary` test idiom. Per-chunk: named file only; one
repo typecheck + full suite at feature end (barrier members force exhaustive
switches repo-wide).
