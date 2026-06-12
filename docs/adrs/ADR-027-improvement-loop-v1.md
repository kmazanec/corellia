# ADR-027: Improvement loop v1 — post-run blocker routing under a standing envelope

**Status:** Accepted · **Date:** 2026-06-12 · **Stretch:** no · **Contract:** yes
**Supersedes:** none · **Superseded by:** none

## Context

R14/AC-21: blocker reports become improvement goals become human-reviewed
factory-repo PRs; the factory never modifies its code mid-run. Today
`Report.blockers` and `blocked` events are recorded and then read by no
one; `improve-factory` exists as a thin card ("deep harness content is
iteration 6 work"). DESIGN.md routes output by generality: repo-specific
lessons → project memory; repo-agnostic improvements → factory-repo PRs —
inside a standing budget envelope that can never starve product work.

## Options considered

- **Mid-run self-modification** — forbidden by design; not considered
  further.
- **Deterministic listener-side classifier** (regex/keyword routing of
  blocker strings to memory vs PR) — rejected: a bogus classifier deciding
  generality is worse than no classifier.
- **Listener mints; the improvement goal itself routes** — chosen.

## Decision

When a tree completes, the Listener inspects `report.blockers`; a non-empty
batch mints **one `improve-factory` commission per run** carrying the
blocker texts and the run's event-log pointer. The generality judgment
lives *inside* the improvement goal (it reads the log and decides: a
repo-specific lesson terminates in a project-memory write; a repo-agnostic
fix terminates in a branch + PR on the factory repo via the ADR-025 tools).
Improvement commissions are admitted only against a **standing envelope** —
a daemon-configured `Budget` + spend ceiling, decremented per improvement
tree, topped up only by operator action — and at strictly lower admission
priority than product intents: an empty envelope or a queued product intent
parks improvement work, never the reverse. One additive event member:
`blocker-routed` (goalId, blocker, commissionId). Improvement PRs may
refine prompts, skills, scripts, eval sets, and add goal-types; they may
not restructure the factory (DESIGN.md: the architecture is locked).

## Tradeoffs & risks

- One commission per run batches blockers; a noisy run produces one
  improvement goal, not a storm. The cost: distinct unrelated blockers
  share one tree — accepted for v1.
- Judge calibration cold start (PRD risk #2): improvement output is a PR,
  so the operator's review is the exogenous ground truth, as designed.

## Consequences for the build

- Barrier: `blocker-routed` event member; envelope config on the daemon's
  contract surface.
- F-63 builds routing, envelope, and the deep harness; F-61's tools are a
  hard dependency; F-67 scripts the loop end-to-end.
