---
type: issue
title: "Teach the factory to produce code with durable module boundaries"
description: Corellia should internalize the code-quality lessons from the engine refactor so future factory-written code starts with small, composable domain modules instead of drifting into mega-files and overloaded functions.
tags: [factory, code-quality, patterns, constitution, self-hosting]
timestamp: 2026-06-27
status: open
kind: future-work
severity: medium
---

# Teach the factory to produce code with durable module boundaries

## Problem
The engine refactor showed that Corellia can converge functionally while still
accumulating code shape debt: oversized files, overloaded functions, repeated
callback wiring, and orchestration code that hides domain phases instead of naming
them. Passing tests are necessary, but they do not prove the code will be cheap to
change next time.

The lesson is not merely "refactor large files later." The factory should learn
the durable patterns that would have prevented the shape in the first place:
orchestration should read like a table of contents; extraction units should be
domain verbs; repeated lambdas usually want adapters; explicit context objects can
make functional composition easier; and tests should follow the ownership boundary
of the extracted module.

## Evidence
This surfaced during the June 2026 engine decomposition on `main`, especially the
commit sequence from `285e321 refactor(engine): extract split runner` through
`821d2ce refactor(engine): extract attempt failure resolution`. The work reduced
`src/engine/engine.ts` to orchestration over focused components and moved behavior
into modules such as `src/engine/root-lifecycle.ts`,
`src/engine/recursive-runner.ts`, `src/engine/split-runner.ts`, and
`src/engine/attempt/*`.

The final validation was green (`npm run typecheck`, `npm run lint`, focused
engine tests, and the full Vitest suite), which means the improvement was not a
behavioral repair. It was a maintainability repair: the same behavior became
easier to understand, test, and extend because the code expressed its domain
boundaries.

## Proposed direction
Rough, not committed:

- Add deterministic code-shape signals the factory can consult before and after a
  build: largest files, largest functions, nesting, dependency fanout, repeated
  closure shapes, and orchestration modules that contain too much local policy.
- Feed those signals into the factory's own goal context and improvement loop so a
  make/improve-factory run asks "did this change reduce or increase the cost of
  the next change?", not only "did it pass?"
- Capture reusable implementation patterns in the factory's durable guidance:
  extract lifecycle phases, name modules after domain verbs, use explicit context
  objects where they clarify dependency flow, replace repeated callback wiring with
  adapters, and move focused tests with the new ownership boundary.
- Consider a constitution-adjacent lint or advisory gate for new mega-files and
  mega-functions, with an escape hatch only when an ADR or iteration explicitly
  justifies the shape.

## Acceptance hint
A future Corellia-authored change that would otherwise add a large overloaded file
or function is either decomposed before completion or emits a concrete quality
finding that points to the missing domain boundary; validation still proves
behavior, but the factory also records and acts on code-shape evidence.
