---
type: iteration
title: "Iteration 16 — Factory code-quality patterns"
description: Corellia learns deterministic code-shape signals and build guidance so future factory-written code preserves small, composable domain boundaries.
tags: [iteration, factory, code-quality, patterns, self-hosting]
timestamp: 2026-06-27
status: building
---

# Iteration 16 — Factory code-quality patterns

## Source issue

[factory-code-quality-patterns](../../issues/factory-code-quality-patterns.md)

## What this delivers

Before: Corellia could produce behaviorally correct code while accumulating
mega-files, overloaded functions, and hidden domain phases that a later human had
to refactor.

After: Corellia has deterministic code-shape evidence and runtime build guidance
that teach make goals to preserve small, composable module boundaries as they
write code.

## Acceptance criteria

1. A deterministic analyzer reports scoped code-shape pressure: largest files,
   largest functions, and concrete refactoring guidance.
2. Build/write harnesses receive a scoped code-shape hint for make goals when the
   sandboxed target has oversized files or functions.
3. The shared build guidance names the durable patterns learned from the engine
   refactor: orchestration as table of contents, domain-verb modules, adapters for
   repeated callback wiring, explicit context objects where they clarify flow, and
   tests following ownership boundaries.
4. The issue is closed using OKF discipline once code and tests land.

## Build plan

- [x] Add the code-shape analyzer, CLI, and focused unit tests.
- [x] Inject scoped code-shape hints into the step-loop harness for make goals.
- [x] Update shared build guidance with durable code-quality patterns.
- [ ] Validate, close the issue, and update the OKF catalog/log.

## Decisions, assumptions & blockers

- Decision: implement this as deterministic evidence plus advisory harness
  context, not as a hard fail. The first useful behavior is to prevent poor shape
  during generation; hard thresholds can come later after traces prove the right
  bounds.
- Decision: expose the analyzer as `npm run code-shape -- <scope...>` so humans,
  commissions, and future factory scripts can ask for the same evidence the
  harness injects.
