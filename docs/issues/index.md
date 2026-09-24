---
type: index
title: Issues backlog
description: Catalog of open Corellia issues — ideas, bugs, and future work that is not yet done — with each issue's lifecycle status.
timestamp: 2026-09-23
---

# Issues

Open, **ephemeral** work items: ideas, bugs, future work — not yet done. Unlike
[iterations](../iterations/index.md) and [ADRs](../adrs/index.md), an issue is
meant to be **destroyed** once its work is implemented and proven (turned into
code plus an iteration or ADR, recorded as a line in [the log](../log.md)). An
issue is not a commitment to build; it is a captured intent that the
[`commission`](../../.claude/skills/commission/SKILL.md) front door can pick up,
or that gets folded into an iteration.

Each issue is one OKF `type: issue` file with `kind` (bug | idea | future-work),
`severity` (high | medium | low), `status`, and `tags`.

## Lifecycle

```
open ──► partially-fixed ──► fixed-pending-live-proof ──► (deleted + logged)
```

- **open** — nothing has landed.
- **partially-fixed** — some of it landed; the `## Resolution` section says what
  landed and what remains.
- **fixed-pending-live-proof** — all of it landed and is unit-proven; a live run
  is the remaining proof. The `## Resolution` section names that proof.
- **done** is not a status: a finished issue is deleted, its row removed here,
  and a line added to [docs/log.md](../log.md).

**Whoever lands the work moves the issue, in the same change.** The factory does
it with the brokered `update_issue` tool (and deletes an issue-sourced
commission's issue on delivery). A hand-building agent edits the frontmatter,
the `## Resolution` section, and this catalog row. `npm run lint` fails on drift:
an unknown status, an `open` issue carrying a fix note or a `## Resolution`
section, a non-open issue without one, or a catalog row whose section, kind, or
status disagrees with its file (rules in `src/library/issue-backlog.ts`).

## High severity

| Issue | Kind | Status | Tags |
|---|---|---|---|
| [build-leaf-context-thrash](build-leaf-context-thrash.md) | bug | fixed-pending-live-proof | engine, build, working-memory, eviction, context, scratchpad, read-tool, adr-036, deliver-intent |
| [comprehension-region-wallclock-exhaustion](comprehension-region-wallclock-exhaustion.md) | bug | fixed-pending-live-proof | engine, comprehend, wall-clock, recursion, partial-delivery, deliver-intent |
| [decision-brief-notification-sink](decision-brief-notification-sink.md) | future-work | fixed-pending-live-proof | eventlog, daemon, observability, human-gate, notification |
| [dive-anchor-hallucination-blocks-region](dive-anchor-hallucination-blocks-region.md) | bug | fixed-pending-live-proof | engine, comprehend, knowledge, dive-anchor, verify-on-read, region-facts, deliver-intent, model-quality |
| [golden-outcome-labels](golden-outcome-labels.md) | bug | fixed-pending-live-proof | engine, eventlog, golden, calibration, judge |
| [greenfield-criteria-grounding](greenfield-criteria-grounding.md) | bug | fixed-pending-live-proof | engine, acceptance-criteria, milestone-loop, greenfield, anchors, explore-economy, deliver-intent |
| [judge-calibration-replay](judge-calibration-replay.md) | future-work | fixed-pending-live-proof | engine, eval, golden, calibration, judge, replay |
| [milestone-loop-step-7-prove-live](milestone-loop-step-7-prove-live.md) | future-work | open | milestone-loop, engine, live-proof |
| [operator-console-ui](operator-console-ui.md) | future-work | partially-fixed | ui, operator-console, observability, read-model, daemon, eventlog, harness, front-door |
| [out-of-scope-edit-enforcement](out-of-scope-edit-enforcement.md) | bug | fixed-pending-live-proof | scope-safety, engine, broker |
| [web-fetch-tool](web-fetch-tool.md) | bug | fixed-pending-live-proof | engine, broker, tool, research, web |
| [worktree-work-invisible-to-artifact-judges](worktree-work-invisible-to-artifact-judges.md) | bug | fixed-pending-live-proof | engine, artifact, worktree, salvage, judge, acceptance, milestone-loop, integrate-merge |

## Medium severity

| Issue | Kind | Status | Tags |
|---|---|---|---|
| [anthropic-direct-provider](anthropic-direct-provider.md) | idea | fixed-pending-live-proof | brain, provider, anthropic, resilience, cost |
| [collect-review-manifest](collect-review-manifest.md) | idea | partially-fixed | scope-safety, collect, review |
| [critique-ui-capture-tool](critique-ui-capture-tool.md) | future-work | fixed-pending-live-proof | engine, broker, tool, critique-ui, capture, vision |
| [daemon-declared-scripts](daemon-declared-scripts.md) | bug | fixed-pending-live-proof | daemon, acceptance-criteria, declared-scripts, milestone-loop, front-door |
| [deployment-to-live-url](deployment-to-live-url.md) | future-work | open | structural, deploy |
| [design-arch-empty-artifact-block](design-arch-empty-artifact-block.md) | bug | fixed-pending-live-proof | engine, brain, design-arch, robustness, partial-delivery |
| [event-log-conformance-check](event-log-conformance-check.md) | idea | fixed-pending-live-proof | eventlog, constitution, eval, replay, projections |
| [external-asset-acquisition](external-asset-acquisition.md) | future-work | open | structural, asset, tool |
| [fleet-compose-deploy](fleet-compose-deploy.md) | future-work | fixed-pending-live-proof | deploy, compose, operator-console, worker, adr-045, adr-051 |
| [factory-authors-iterations](factory-authors-iterations.md) | future-work | partially-fixed | factory, iterations, docs, self-hosting |
| [factory-manages-issues](factory-manages-issues.md) | future-work | partially-fixed | factory, issues, library, engine, self-hosting |
| [frozen-anchor-criteria-guess-identifiers](frozen-anchor-criteria-guess-identifiers.md) | bug | partially-fixed | engine, acceptance-criteria, milestone-loop, anchors, author-acceptance-criteria, adr-032 |
| [greenfield-bootstrap](greenfield-bootstrap.md) | future-work | open | structural, scaffold |
| [ground-fact-external-knowledge](ground-fact-external-knowledge.md) | future-work | open | structural, knowledge, grounding |
| [improvement-loop-on-the-queue](improvement-loop-on-the-queue.md) | future-work | open | listener, improvement-loop, jobs, worker, adr-027, adr-051 |
| [listener-missing-channels](listener-missing-channels.md) | future-work | open | listener, daemon, autonomous-seam, admission, knowledge-refresh |
| [live-model-ci-smoke](live-model-ci-smoke.md) | future-work | fixed-pending-live-proof | tests, ci, brain, live-proof, smoke |
| [milestone-loop-step-8-slice-nesting](milestone-loop-step-8-slice-nesting.md) | future-work | open | milestone-loop, engine |
| [observability-pluggable-tracing](observability-pluggable-tracing.md) | idea | partially-fixed | observability, eventlog, daemon, cli, tracing, langsmith, otel, dx |
| [partial-delivery-on-blocked-dependency](partial-delivery-on-blocked-dependency.md) | idea | fixed-pending-live-proof | in-run-stall, engine, partial-delivery, collect |
| [pattern-trust-promotion-unwired](pattern-trust-promotion-unwired.md) | bug | fixed-pending-live-proof | engine, flywheel, split-memo, pattern-trust, human-gate |
| [provider-timeout-isomorphic-block](provider-timeout-isomorphic-block.md) | bug | fixed-pending-live-proof | engine, brain, retry, isomorphic-failure, timeout, robustness, step-loop |
| [repair-integration-rung](repair-integration-rung.md) | idea | fixed-pending-live-proof | in-run-stall, engine, integration |
| [secret-value-diff-gate](secret-value-diff-gate.md) | bug | open | engine, deterministic-gate, secrets, security |
| [semantic-retrieval-vector-store](semantic-retrieval-vector-store.md) | future-work | open | library, engine, retrieval, knowledge, embeddings, comprehend |
| [type-global-memory-layers](type-global-memory-layers.md) | future-work | fixed-pending-live-proof | engine, memory, layers, promote-memory |
| [verify-on-read-checkpoints](verify-on-read-checkpoints.md) | future-work | fixed-pending-live-proof | engine, knowledge, memory, verify-on-read, consistency |

## Low severity

| Issue | Kind | Status | Tags |
|---|---|---|---|
| [bundled-trace-backend](bundled-trace-backend.md) | idea | fixed-pending-live-proof | observability, otlp, compose, deploy, ui |
| [descriptive-commit-messages](descriptive-commit-messages.md) | idea | fixed-pending-live-proof | ergonomic, collect, git |
| [duplicate-read-return-cached-value](duplicate-read-return-cached-value.md) | bug | fixed-pending-live-proof | in-run-stall, engine, broker |
| [factory-okf-discipline](factory-okf-discipline.md) | idea | partially-fixed | factory, docs, okf, constitution, self-hosting |
| [improvement-envelope-dollar-accounting](improvement-envelope-dollar-accounting.md) | bug | fixed-pending-live-proof | listener, budget, improvement-loop, cost |
| [memory-contradiction-and-consolidation](memory-contradiction-and-consolidation.md) | future-work | open | engine, memory, governance, consolidation |
| [repl-wire-or-remove](repl-wire-or-remove.md) | idea | fixed-pending-live-proof | daemon, repl, front-door, dead-code |
| [ride-along-items](ride-along-items.md) | future-work | partially-fixed | ride-along, future-work, roadmap |
| [roadmap-non-goals](roadmap-non-goals.md) | idea | open | roadmap, non-goals, deferred |
| [test-suite-parallel-load-timeouts](test-suite-parallel-load-timeouts.md) | bug | open | tests, flake, ci, wall-clock, dx |
| [tier-band-semantics](tier-band-semantics.md) | idea | partially-fixed | brain, model-catalog, tiers, docs, adr-needed |
| [vision-needs-wiring](vision-needs-wiring.md) | bug | fixed-pending-live-proof | brain, model-catalog, vision, critique-ui, judge |
