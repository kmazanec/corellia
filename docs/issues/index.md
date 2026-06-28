---
type: index
title: Issues backlog
description: Unordered catalog of open Corellia issues — ideas, bugs, and future work that is unplanned and undone.
timestamp: 2026-06-25
---

# Issues

Open, **ephemeral** work items: ideas, bugs, future work — unplanned and undone.
Unlike [iterations](../iterations/index.md) and [ADRs](../adrs/index.md), an issue
is meant to be **destroyed** once it is implemented (turned into an iteration, an
ADR, and actual code). An issue is not a commitment to build; it is a captured
intent that the [`commission`](../../.claude/skills/commission/SKILL.md) front door
can pick up, or that gets folded into an iteration.

Each issue is one OKF `type: issue` file with `kind` (bug | idea | future-work),
`severity`, `status`, and `tags`. Unordered — sort by severity/kind as you read.

## High severity

| Issue | Kind | Tags |
|---|---|---|
| [out-of-scope-edit-enforcement](out-of-scope-edit-enforcement.md) | bug | scope-safety, engine, broker |
| [comprehension-region-wallclock-exhaustion](comprehension-region-wallclock-exhaustion.md) | bug | engine, comprehend, wall-clock, recursion |
| [dive-anchor-hallucination-blocks-region](dive-anchor-hallucination-blocks-region.md) | bug | engine, comprehend, dive-anchor, verify-on-read, model-quality |
| [build-leaf-context-thrash](build-leaf-context-thrash.md) | bug | engine, build, working-memory, eviction, context, read-tool |
| [freeze-contract-step-loop-stall](freeze-contract-step-loop-stall.md) | bug | engine, build, step-loop, in-run-stall, isomorphic-failure, commission |
| [visual-runtime-verification](visual-runtime-verification.md) | future-work | structural, verification, vision |
| [milestone-loop-step-7-prove-live](milestone-loop-step-7-prove-live.md) | future-work | milestone-loop, engine, live-proof |
| [operator-console-ui](operator-console-ui.md) | future-work | ui, operator-console, observability, read-model, front-door |

## Medium severity

| Issue | Kind | Tags |
|---|---|---|
| [design-arch-empty-artifact-block](design-arch-empty-artifact-block.md) | bug | engine, brain, design-arch, robustness |
| [partial-delivery-on-blocked-dependency](partial-delivery-on-blocked-dependency.md) | idea | partial-delivery, engine, collect |
| [salvage-on-repeated-failure](salvage-on-repeated-failure.md) | bug | in-run-stall, engine, salvage |
| [error-signature-repair-hints](error-signature-repair-hints.md) | bug | in-run-stall, engine, repair |
| [repair-integration-rung](repair-integration-rung.md) | idea | in-run-stall, engine, integration |
| [collect-review-manifest](collect-review-manifest.md) | idea | scope-safety, collect, review |
| [observability-pluggable-tracing](observability-pluggable-tracing.md) | idea | observability, eventlog, cli, langsmith, otel |
| [external-asset-acquisition](external-asset-acquisition.md) | future-work | structural, asset, tool |
| [deployment-to-live-url](deployment-to-live-url.md) | future-work | structural, deploy |
| [deploy-the-factory-end-to-end](deploy-the-factory-end-to-end.md) | future-work | harness, deploy, docker, ci, ghcr, ops, lifecycle |
| [greenfield-bootstrap](greenfield-bootstrap.md) | future-work | structural, scaffold |
| [ground-fact-external-knowledge](ground-fact-external-knowledge.md) | future-work | structural, knowledge, grounding |
| [milestone-loop-step-8-slice-nesting](milestone-loop-step-8-slice-nesting.md) | future-work | milestone-loop, engine |

## Factory self-hosting (meta) — the factory participates in this discipline itself

These capture the work to make Corellia a first-class participant in the OKF
issue/iteration/log discipline, not just its subject.

| Issue | Kind | Sev | Tags |
|---|---|---|---|
| [factory-manages-issues](factory-manages-issues.md) | future-work | medium | factory, issues, self-hosting |
| [factory-authors-iterations](factory-authors-iterations.md) | future-work | medium | factory, iterations, self-hosting |
| [factory-okf-discipline](factory-okf-discipline.md) | idea | low | factory, docs, okf, constitution |

## Low severity

| Issue | Kind | Tags |
|---|---|---|
| [duplicate-read-return-cached-value](duplicate-read-return-cached-value.md) | bug | in-run-stall, engine, broker |
| [descriptive-commit-messages](descriptive-commit-messages.md) | idea | ergonomic, collect, git |
| [model-capability-signal](model-capability-signal.md) | idea | ergonomic, metrics, brain |
| [per-project-event-log-path](per-project-event-log-path.md) | idea | ergonomic, eventlog, config |
| [auto-prune-blocked-worktrees](auto-prune-blocked-worktrees.md) | idea | ergonomic, worktree, cleanup |
| [ride-along-items](ride-along-items.md) | future-work | ride-along, future-work, roadmap |
| [roadmap-non-goals](roadmap-non-goals.md) | idea | roadmap, non-goals, deferred |
