---
type: iteration
title: "Iteration 05 — Taste: real skills, structured emission, and the intent dial"
description: The library reaches all 19 goal types with per-family skill bundles, artifact emission is provider-guaranteed JSON, the intent dial modulates judges, golden-set capture accrues from live runs, and retries carry what the failed attempt learned.
tags: [iteration, taste, skills, structured-emission, intent-dial, golden-capture, flywheel]
timestamp: 2026-06-11
status: shipped
---

# Iteration 05 — Taste: real skills, structured emission, and the intent dial

**Date:** 2026-06-11 · **Status:** Shipped

This iteration replaced the generic-prompt ceiling with real per-family skill
bundles across all 19 goal types, made artifact emission provider-guaranteed JSON
via a two-phase explore-then-emit flow, and wired the intent dial to modulate
judges (never deterministic gates). Golden-set capture now accrues from live runs
as events, retries carry forward what the failed attempt learned, and a
commissioned mini-intent flows PRD → architecture → contract → implementation
fully scripted. Headline evidence: the eyes live retest targeting 5/5 validated
artifacts on the new cost-optimized tier models.

## Features
- [01-structured-emission](01-structured-emission.md) — Two-phase structured emission (explore then emit).
- [02-skill-loader](02-skill-loader.md) — Skill loader + family markdown files (existing 10 types).
- [03-pm-types](03-pm-types.md) — The PM/discovery goal types.
- [04-judge-completion](04-judge-completion.md) — Judge family completion + the intent dial.
- [05-evolve-thin](05-evolve-thin.md) — Evolve family registrations (thin).
- [06-flywheel-debt](06-flywheel-debt.md) — Carried debt: retries see the work, judges get remembered.
- [07-assembly-taste](07-assembly-taste.md) — Assembly: taste wired + the convergence checks.

## ADRs produced
ADR-022 (markdown family skill files), ADR-023 (two-phase structured emission),
ADR-024 (golden capture as events); plus the ADR-005 model-tier amendment and an
additive ADR-017 `Usage.cachedPromptTokens` extension.

## Build plan
[BUILD-PLAN-05-taste](BUILD-PLAN-05-taste.md)

## Build notes (folded from prototype-build-notes.md)

Same direct process, three waves (barrier → F-51∥F-52 → fold → F-53∥F-54∥
F-55∥F-56 → fold → F-57). 826 → 1076 tests. The library stands at all 19
GOAL-TYPES types with markdown family skills; the lint gate is binding in
`npm test`.

### What was added

Two-phase structured emission (explore-then-emit via provider response_format
— ADR-023); the skill loader + six→ten family files with the dotmaz seed
content ported (ADR-022); write-prd / design-arch / research-external /
investigate; critique-doc / critique-ui + the intent dial through judge
rubrics (hard invariant pinned: intent never reaches deterministic checks);
the evolve family thin with dangerous-grant proofs; carried exploration
across attempts; golden capture as events (ADR-024); cached-token surfacing;
cost-optimized tier models (deepseek-v4-flash/pro + kimi-k2.6, ADR-005
amendment) at ~7-25x lower unit price, smoke-proven.

### Review-rung highlight

The integration judge caught the iteration's defining find: F-54's
intent-dial bars lived in a `## The intent dial` section that F-56's rubric
enricher never extracted — judges were told to "apply the bar the intent
demands" without ever seeing the bars, and the arbiter's
invariants-survive-spike protection was silently lost. A synthetic-family
test had masked it. Fixed with real-skill assertions. Lesson: integration
tests must use the real artifacts, not synthetic stand-ins, when the
artifact IS the product.

### The live retest — honest results (~$13 this iteration)

live:hands on the new tiers: PASS at $0.024 (2.6x cheaper than the original
sonnet run), golden candidate captured. live:eyes across four runs: best
**4/5** (architecture+stack+conventions+dive) at ~$1.8-2.4/run vs the
iteration-04 baseline (best 3/5 at $2-6); every category passed at least
twice; never 5/5 in one pass. The runs caught and fixed four real machinery
bugs no scripted test could see:

1. **npm-script execution** — package.json script values were executed as
   node file paths (fixtures had masked it); `npm-script:` entries now spawn
   the package manager, args-array, shell-free.
2. **Worktrees lacked the toolchain** — fresh tree worktrees couldn't run a
   real repo's declared scripts; the lifecycle now links the repo root's
   node_modules in.
3. **The dependency link tripped the scope check** — a node_modules symlink
   evades a `node_modules/` gitignore rule (a link is not a directory), and
   the untracked listing didn't respect gitignore at all
   (`--exclude-standard` added; the lifecycle's own link never counts as
   work).
4. **Re-run collisions** — tree ids derive from goal ids; a worktree
   preserved by a failed earlier run collided with the next run's identical
   id. Live goal ids now carry a per-run nonce.

### Carried debt (named, for iteration 6 prep)

- **Exploration discipline at cheap tiers** is the residual 5/5 blocker:
  models over-explore real repos (token/toolCall exhaustion) with run-to-run
  variance; emission itself is now reliable (structured outputs). Levers:
  per-category budget shapes, harder economy enforcement in the loop (e.g.
  duplicate-call refusal), or tier policy per category.
- **Cache-hit share reads 0.0%** despite stable prefixes — likely OpenRouter
  provider-routing breaking cache affinity; investigate provider pinning
  (~5-10x cost lever on transcript-heavy runs).
- design-arch's own artifact-level tournament (leaf scan) is an unbuilt
  engine seam.
- Dangerous-grant regexes live in tests; promote into the constitution lint.
- Integration-judge verdicts are excluded from golden capture (pinned as
  intentional; wire when the integration site emits judge-verdict events).
