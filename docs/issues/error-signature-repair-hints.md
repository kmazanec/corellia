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

## Proposed direction
A small library of **error-signature → suggested-repair** hints injected into the
repair rung's context (missing test import, missing type import, ESM/CJS
`__dirname`, top-level-await-in-eval, etc.). These recurred verbatim across runs.

## Acceptance hint
When a leaf produces a recognized error signature, the repair rung's context
carries the matching suggested fix, and the leaf converges instead of thrashing.
