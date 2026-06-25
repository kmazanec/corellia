# ADR-019: Knowledge artifacts are event-projected project memory with SHA-anchored freshness

**Status:** Accepted · **Date:** 2026-06-11 · **Stretch:** no · **Contract:** yes
**Supersedes:** none · **Superseded by:** none · **Amended by:** ADR-032

> **Amendment (ADR-032).** The SHA-anchored freshness check below assumes HEAD
> advances between an artifact's generation and its re-read. Within a single tree
> that was not true: `collectTree` committed the worktree only once at tree-end, so
> `generatedAtSha === headSha` held trivially and verify-on-read was a no-op
> *across rounds*. ADR-032's milestone loop commits the worktree **per round**
> (`commitRound`), advancing HEAD each round, which makes this freshness check real
> across a goal's iterations. See ADR-032 for the per-round-commit mechanism.

## Context

Iteration 04 gives the factory eyes: `map-repo` and `deep-dive-region`
produce typed knowledge artifacts the split gate, retrieval API, and
regression guard consume. They need a storage home and a freshness story.

## Options considered

- **Events + a knowledge projection** — chosen (largely dictated by locked
  decisions: artifacts are project memory, memory is a projection of the log
  per ADR-003, the store is independent of the product repo).
- Dedicated Postgres tables written directly — rejected: side-channel state;
  provenance and point-in-time replay would need re-derivation. A pg table
  may later *cache* the projection if query cost demands; the log stays the
  source of truth.
- Files under the target repo (`.claude/knowledge/`) — rejected: the product
  repo receives exactly one thing from the factory, a PR.

## Decision

Knowledge artifacts are appended as `knowledge-written` events and
materialized by a `projectKnowledge` projection (latest artifact per
repo × category). The frozen shape follows GOAL-TYPES:
`{ category, generatedAtSha, confidence, status: provisional|trusted,
pointers }` — **pointers, not bodies** (paths + line anchors + short notes;
the repo remains the body). Deep-dive facts are claims with `file:line`
anchors at a SHA.

**Freshness:** at decide/split/integrate checkpoints, a consumer comparing
the artifact's `generatedAtSha` against the repo's current HEAD on mismatch
runs the category's **cheap self-validation** (spot queries — anchor
existence, scaffold-runs-green, versions-match); only a failed validation
triggers a refresh dive. Validation outcomes are `knowledge-checked` events.
A stale fact is never silently used (PRD AC-16); an unchanged-but-revalidated
artifact is not needlessly rebuilt.

## Rationale

One substrate, no new machinery: provenance ("which dive wrote this fact"),
decay evidence, and golden-set replay (rebind the knowledge state a run saw)
all fall out of ADR-003. SHA-anchored pointers make every fact
verifiable-on-read — the epistemic rule's requirement for facts.

## Tradeoffs & risks

- Projection recompute grows with log size — same accepted posture as
  ADR-003; the pg cache is the named relief valve.
- Pointers-not-bodies means consumers re-read the repo for content; that is
  the design's intent (context cost paid per touched region), not a defect.

## Consequences for the build

- **Source of truth:** `src/contract/knowledge.ts` (new, barrier),
  `knowledge-written`/`knowledge-checked` event members (barrier),
  `projectKnowledge` in `src/eventlog/projections.ts`.
- Self-validation checks are per-category deterministic checks (executing
  where needed via the existing ScriptRunner/CheckContext machinery from
  iteration 03).
