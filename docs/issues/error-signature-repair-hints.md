---
type: issue
title: "A2. The leaf cannot escape a self-inflicted test-authoring bug"
description: There is no error-signature → suggested-repair feedback, so the leaf thrashes on known error classes like a missing vitest import.
tags: [in-run-stall, engine, repair]
timestamp: 2026-06-25
status: open
kind: bug
severity: medium
---

# A2. The leaf cannot escape a self-inflicted test-authoring bug

## Problem
No feedback loop maps a known error signature ("X is not defined" atop a test
file) to a known fix (add the import). The model thrashes — burning attempts
re-running and re-reading the same files instead of recognizing the missing-import
class of error.

## Evidence
Run 1 (tiutni), `"ReferenceError: it is not defined"` ×2 — the factory wrote a
vitest test file that omitted `import { it, describe, expect } from 'vitest'`, then
burned attempts re-running it. Source: the gap-audit iteration (docs/iterations/2026-06-24-01-gap-audit-tiutni/index.md).

## Partially addressed (2026-06-28)
A **general** version of the feedback loop now exists: on a retry, the prior
attempt's gating-finding titles are injected into the next step-loop prompt as a
"your prior attempt was rejected for X — do something different" block
(`src/engine/step-loop-context.ts` `priorRejectionBlock`, threaded via
`artifact-production.ts`). This makes the retry non-isomorphic and feeds the
failure reason back, so a leaf no longer re-runs a verbatim attempt blind to why
the last one failed.

**Residual (still open):** the **curated signature → fix library**. The general
mechanism passes back whatever the judge/gate said, but does not yet map a
*recognized* error signature ("X is not defined" atop a test file, ESM/CJS
`__dirname`, missing type import) to a *specific* known fix. The recurring,
verbatim classes from the gap audit still deserve targeted hints.

## Proposed direction
A small library of **error-signature → suggested-repair** hints injected into the
repair rung's context (missing test import, missing type import, ESM/CJS
`__dirname`, top-level-await-in-eval, etc.). These recurred verbatim across runs.
Build on the existing `priorRejectionBlock` feedback path rather than a parallel
channel.

## Acceptance hint
When a leaf produces a recognized error signature, the repair rung's context
carries the matching suggested fix, and the leaf converges instead of thrashing.
