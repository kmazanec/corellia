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
| [milestone-loop-step-7-prove-live](milestone-loop-step-7-prove-live.md) | future-work | milestone-loop, engine, live-proof |
| [operator-console-ui](operator-console-ui.md) | future-work | ui, operator-console, observability, read-model, front-door |
| [worktree-work-invisible-to-artifact-judges](worktree-work-invisible-to-artifact-judges.md) | bug | engine, artifact, worktree, salvage, judge |
| [greenfield-criteria-grounding](greenfield-criteria-grounding.md) | bug | engine, acceptance-criteria, greenfield, anchors |
| [golden-outcome-labels](golden-outcome-labels.md) | bug | engine, eventlog, golden, calibration, judge |
| [judge-calibration-replay](judge-calibration-replay.md) | future-work | engine, eval, golden, calibration, judge, replay |
| [web-fetch-tool](web-fetch-tool.md) | bug | engine, broker, tool, research, web |
| [decision-brief-notification-sink](decision-brief-notification-sink.md) | future-work | eventlog, daemon, observability, human-gate, notification |

## Medium severity

| Issue | Kind | Tags |
|---|---|---|
| [design-arch-empty-artifact-block](design-arch-empty-artifact-block.md) | bug | engine, brain, design-arch, robustness |
| [partial-delivery-on-blocked-dependency](partial-delivery-on-blocked-dependency.md) | idea | partial-delivery, engine, collect |
| [repair-integration-rung](repair-integration-rung.md) | idea | in-run-stall, engine, integration |
| [collect-review-manifest](collect-review-manifest.md) | idea | scope-safety, collect, review |
| [observability-pluggable-tracing](observability-pluggable-tracing.md) | idea | observability, eventlog, cli, langsmith, otel |
| [provider-timeout-isomorphic-block](provider-timeout-isomorphic-block.md) | bug | engine, brain, retry, timeout, robustness |
| [frozen-anchor-criteria-guess-identifiers](frozen-anchor-criteria-guess-identifiers.md) | bug | engine, acceptance-criteria, milestone-loop, anchors |
| [external-asset-acquisition](external-asset-acquisition.md) | future-work | structural, asset, tool |
| [deployment-to-live-url](deployment-to-live-url.md) | future-work | structural, deploy |
| [greenfield-bootstrap](greenfield-bootstrap.md) | future-work | structural, scaffold |
| [ground-fact-external-knowledge](ground-fact-external-knowledge.md) | future-work | structural, knowledge, grounding |
| [semantic-retrieval-vector-store](semantic-retrieval-vector-store.md) | future-work | library, engine, retrieval, knowledge, embeddings, comprehend |
| [milestone-loop-step-8-slice-nesting](milestone-loop-step-8-slice-nesting.md) | future-work | milestone-loop, engine |
| [live-model-ci-smoke](live-model-ci-smoke.md) | future-work | tests, ci, brain, live-proof, smoke |
| [behavioral-fixture-library](behavioral-fixture-library.md) | future-work | tests, eval, fixtures, deterministic-gate |
| [event-log-conformance-check](event-log-conformance-check.md) | idea | eventlog, constitution, eval, replay, projections |
| [critique-ui-capture-tool](critique-ui-capture-tool.md) | future-work | engine, broker, tool, critique-ui, capture, vision |
| [pattern-trust-promotion-unwired](pattern-trust-promotion-unwired.md) | bug | engine, flywheel, split-memo, pattern-trust, human-gate |
| [type-global-memory-layers](type-global-memory-layers.md) | future-work | engine, memory, layers, promote-memory |
| [knowledge-self-validation-gaps](knowledge-self-validation-gaps.md) | bug | engine, knowledge, verify-on-read, classify-risk, comprehend |
| [verify-on-read-checkpoints](verify-on-read-checkpoints.md) | future-work | engine, knowledge, memory, verify-on-read, consistency |
| [listener-missing-channels](listener-missing-channels.md) | future-work | listener, daemon, autonomous-seam, admission, knowledge-refresh |
| [anthropic-direct-provider](anthropic-direct-provider.md) | idea | brain, provider, anthropic, resilience, cost |
| [secret-value-diff-gate](secret-value-diff-gate.md) | bug | engine, deterministic-gate, secrets, security |

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
| [test-suite-parallel-load-timeouts](test-suite-parallel-load-timeouts.md) | bug | tests, flake, ci |
| [descriptive-commit-messages](descriptive-commit-messages.md) | idea | ergonomic, collect, git |
| [auto-prune-blocked-worktrees](auto-prune-blocked-worktrees.md) | idea | ergonomic, worktree, cleanup |
| [ride-along-items](ride-along-items.md) | future-work | ride-along, future-work, roadmap |
| [roadmap-non-goals](roadmap-non-goals.md) | idea | roadmap, non-goals, deferred |
| [memory-contradiction-and-consolidation](memory-contradiction-and-consolidation.md) | future-work | engine, memory, governance, consolidation |
| [tier-band-semantics](tier-band-semantics.md) | idea | brain, model-catalog, tiers, docs, adr-needed |
| [improvement-envelope-dollar-accounting](improvement-envelope-dollar-accounting.md) | bug | listener, budget, improvement-loop, cost |
| [vision-needs-wiring](vision-needs-wiring.md) | bug | brain, model-catalog, vision, critique-ui, judge |
| [repl-wire-or-remove](repl-wire-or-remove.md) | idea | daemon, repl, front-door, dead-code |
| [bundled-trace-backend](bundled-trace-backend.md) | idea | observability, otlp, compose, deploy, ui |
