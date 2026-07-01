---
type: plan
title: Temporary Design and Implementation Review Plan
description: Temporary planning note capturing suggested Corellia design and implementation improvements from the June 30 review.
tags: [corellia, design, implementation, review, temporary]
timestamp: 2026-06-30
---

# Temporary Design and Implementation Review Plan

This is a temporary planning note from the June 30, 2026 review of
`DESIGN.md` against the current Corellia implementation. It records the proposed
changes and the reason each one matters. Delete this file after the work is
triaged into issues, ADR updates, or an iteration plan.

## Highest Priority

### Enforce scope at the actual emission and commit boundary

Why: `DESIGN.md` says `diff <= scope` is enforced at emission, but current child
success emission writes a report before a worktree diff-scope check, and the root
gate checks late. Milestone round commits can also hide committed out-of-scope
paths from `diffWithinScope`, because it checks against `HEAD` after `commitRound`
has advanced it.

Evidence:
- `src/engine/attempt/success.ts`
- `src/engine/root-runner.ts`
- `src/engine/worktree.ts`

Expected direction:
- Add a scope gate before successful leaf emission when a sandbox exists.
- Make round commits validate changed paths against the child/root scope before
  staging all changes.
- Make the root final gate compare all delivered changes against the worktree
  base SHA, not only uncommitted diff against current `HEAD`.

### Move the split coverage gate before split judging/acceptance

Why: The design's economics depend on a cheap "do we know enough to split?"
check before spending model/judge work on the split. Current code derives and
accepts a split before injecting coverage/JIT comprehension dependencies.

Evidence:
- `src/engine/decision/phase.ts`
- `src/engine/split-dispatch.ts`
- `src/engine/coverage/split-gate.ts`

Expected direction:
- Run coverage preconditions before `judge-split` acceptance where enough child
  shape is known.
- For missing discoverable knowledge, inject comprehension dependencies before
  split acceptance or re-run split acceptance on the augmented graph.
- Add the missing "undiscoverable ambiguity -> batched decision brief" path.

### Make pattern trust fully event-sourced

Why: The design requires trusted split-memo promotion to be replayable and
auditable as an authority-gap human signoff. Current stores mutate pattern
status directly and the event union has no promotion/signoff event.

Evidence:
- `src/contract/events.ts`
- `src/substrate/pg-pattern-store.ts`
- `src/substrate/memory-pattern-store.ts`
- `docs/adrs/ADR-011-flywheel-trust-mechanics.md`

Expected direction:
- Add a `pattern-promoted` or `pattern-trust-signed` event with signer,
  rationale, shape, from/to status, and timestamp.
- Make trusted status projectable from the event log or at least mirror every
  trust mutation into the log before it takes effect.
- Ensure replay can answer "was this memo trusted at event N?"

### Add typed input contracts for goal-types

Why: The design says free text is parsed once at the root and every lower goal
receives typed input. In code, `Goal.spec` and commission specs are `unknown`,
and `GoalTypeDef` has no input schema. Output schemas exist for some structured
types, but input contracts remain prose.

Evidence:
- `src/contract/goal.ts`
- `src/contract/brief.ts`
- `src/contract/goal-type.ts`

Expected direction:
- Add optional or required `inputSchema` to `GoalTypeDef`.
- Validate child `spec` during split validation.
- Enforce "only deliver-intent accepts free text" mechanically.

## Next Priority

### Expand the constitution lint to match GOAL-TYPES.md

Why: `src/library/constitution.ts` enforces useful rules, but it is narrower
than the documented constitution. Missing checks include kind grant ceilings,
core type immutability, free-text restriction, and human touchpoint timeout
shape.

Evidence:
- `GOAL-TYPES.md`
- `src/library/constitution.ts`

Expected direction:
- Encode grant ceilings per kind.
- Require core types and prevent core kind changes.
- Add schema support for declared human touchpoints and `onTimeout`.
- Fail library lint when type declarations drift from the design contract.

### Strengthen deterministic gates for make goals

Why: The design says make goals run compile/lint/typecheck, impacted tests,
scope checks, vault-reference scans, and process-clean checks. Current
`implement` and `freeze-contract` are much thinner.

Evidence:
- `src/library/types/build.ts`
- `src/library/checks.ts`
- `GOAL-TYPES.md`

Expected direction:
- Wire repo-declared typecheck/lint/test checks into make goal definitions where
  sandbox context is available.
- Add or document secret/vault-reference scanning.
- Add `freeze-contract` specific checks for no feature behavior and exhaustive
  consumers, or explicitly downgrade that claim in the design.

### Normalize process-clean enforcement

Why: Leaf `processClean` catches only a small set of process-language leaks,
while the richer diff gate runs at PR push time. If process-clean artifacts are a
factory invariant, the stronger check belongs at emission or collection too.

Evidence:
- `src/library/checks.ts`
- `src/engine/process-clean.ts`
- `src/engine/pr-tools.ts`
- `src/engine/worktree.ts`

Expected direction:
- Reuse the richer process-clean diff scan at root collection and/or leaf
  emission.
- Keep a narrower factory-repo exception only when the actual target repo is the
  factory repo.

### Repair `characterize` write capability

Why: `characterize` grants `fs.write_test_dirs`, but the broker grants
`write_file` only to `fs.write`. Tests currently pin this as a deferral, which
means the type's advertised contract cannot deliver its intended test files.

Evidence:
- `src/library/types/build.ts`
- `src/contract/tool.ts`
- `tests/engine/broker.test.ts`

Expected direction:
- Add a test-dir scoped write tool or teach the broker that `fs.write_test_dirs`
  grants `write_file` only under test paths.
- Add deterministic checks that production code was not modified.

### Apply default sensitivity unless explicitly overridden

Why: Default risk facts identify auth, secrets, env, and migrations, but `Engine`
uses an empty sensitivity list unless callers remember to pass defaults. A
forgotten option can silently classify sensitive paths as low risk.

Evidence:
- `src/library/risk.ts`
- `src/engine/engine.ts`
- `src/engine/options.ts`

Expected direction:
- Use default sensitivity by default.
- Provide an explicit opt-out or replacement mode for tests and specialized
  deployments.

## Memory and Knowledge Governance

### Make project memory governance less skeletal

Why: Current memory projection uses substring matching, ignores scope, lacks
design-required metadata, and reinforces every injected memory on success. That
does not yet support causal decay, contradiction checks, or trusted/provisional
semantics at the level the design claims.

Evidence:
- `src/contract/goal.ts`
- `src/contract/memory.ts`
- `src/eventlog/projections.ts`
- `src/engine/split-report.ts`
- `src/engine/reports.ts`

Expected direction:
- Extend memory metadata with created-at, repo SHA, factory version, and utility
  counters or project them from richer events.
- Make memory query scope-aware.
- Record which memories were actually used, not merely injected.
- Add contradiction-check-on-write before promotion.

### Complete verify-on-read coverage

Why: Knowledge verification exists for several categories and dive anchors, but
some categories pass without self-validation, and injected region facts are only
downgraded on SHA mismatch rather than checked and logged.

Evidence:
- `src/library/knowledge-checks.ts`
- `src/engine/knowledge-memory.ts`
- `src/eventlog/projections.ts`

Expected direction:
- Add self-validation for design-system, dependency, and credential categories,
  or mark them explicitly unsupported/deferred.
- Emit `knowledge-checked` events when region facts are used at checkpoints.
- Extend checkpoint consistency beyond split where it is load-bearing.

### Enforce projection exhaustiveness

Why: ADR-003 says adding event members should break projections until handled.
Projection switches currently omit some newer event types without a `never`
exhaustiveness check.

Evidence:
- `src/eventlog/projections.ts`
- `src/contract/events.ts`
- `docs/adrs/ADR-003-event-log-substrate.md`

Expected direction:
- Add exhaustive handling helpers or explicit ignored-event lists with tests.
- Make newly added events fail compile or lint until each projection chooses how
  to handle or ignore them.

## Semantics and Documentation Alignment

### Reconcile count budgets with liveness guards

Why: The contract says attempts, tokens, and tool calls never block or steer
work, but the step loop uses tool-call budget to issue convergence messages and
eventually hard-stop at a multiple. That may be a good liveness guard, but the
current naming conflicts with ADR-033 language.

Evidence:
- `src/contract/goal.ts`
- `src/engine/step-loop-budget.ts`
- `src/engine/step-loop.ts`

Expected direction:
- Rename the 50x cap as a liveness/runaway guard distinct from count budget, or
  update ADR-033/design language to allow this specific safety valve.
- Avoid prompt wording that makes count budget a steering signal unless that is
  now an accepted design decision.

### Decide which design claims are live invariants versus roadmap

Why: `DESIGN.md` often speaks in final-state language while code implements v1
subsets. This makes audits noisy and can hide real safety gaps behind "deferred"
language.

Expected direction:
- Add an implementation-status section or link to a roadmap matrix for major
  invariants.
- Mark each mechanism as live, partially live, or deferred.
- Keep `DESIGN.md` as domain architecture, but make the current implementation
  delta easy to query.

## Test and CI Follow-up

### Make typecheck part of the normal test gate

Why: Some contract tests rely on TypeScript compilation as proof, but `npm test`
does not run `tsc --noEmit`. Runtime Vitest alone cannot pin type-level shapes.

Evidence:
- `package.json`
- `tests/contract/brief.test.ts`

Expected direction:
- Add `npm run typecheck` to the normal test script or CI gate.
- Fix tests that currently construct stale contract shapes.

## Useful Triage Order

1. Scope enforcement at emission/round commit/root finalization.
2. Split gate ordering and undiscoverable ambiguity briefs.
3. Type input schemas and expanded constitution lint.
4. Deterministic make gates and process-clean normalization.
5. Pattern trust event sourcing.
6. Memory governance and verify-on-read completion.
7. Budget/liveness terminology cleanup.
8. CI typecheck inclusion.
