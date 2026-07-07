---
type: issue
title: Knowledge self-validation covers 4/7 categories — credentials among the unchecked
description: design-system, deps, and credentials knowledge artifacts pass through promotion unchecked; the credentials inventory feeds classify_risk, so an unvalidated artifact weakens the risk gate.
tags: [engine, knowledge, verify-on-read, classify-risk, comprehend]
timestamp: 2026-07-07
status: open
kind: bug
severity: medium
---

# Knowledge self-validation covers 4/7 categories — credentials among the unchecked

## Problem
The knowledge artifacts' trust mechanism is per-category self-validation ("spot
queries pass, scaffold runs green, versions match the build" — GOAL-TYPES.md,
map-repo). Only 4 of 7 categories actually validate; design-system, deps, and
credentials pass through promotion unchecked (src/library/knowledge-checks.ts:528-564).
The credentials/secrets inventory is the sharpest edge: it is a named input to
`classify_risk` and the deterministic gate, so an unvalidated (hallucinated or
stale) credentials artifact silently weakens the instance-risk gating that decides
where the human sits.

## Evidence
- capability-scout sweep (2026-07-07): "Knowledge self-validation only 4/7
  categories — design-system/deps/credentials pass through unchecked
  (knowledge-checks.ts:528-564); the credentials inventory feeding classify_risk
  isn't validated."
- DESIGN.md "The knowledge artifacts — typed, fresh, queryable" (credentials:
  vault references only, never values).

## Proposed direction
Add the three missing validators, cheapest-honest per category: deps — parse the
lockfile(s) fresh and diff against the artifact's claims (same machinery the
stack category already uses); credentials — every entry is a reference (pattern
check: no value-shaped strings), each referenced file/env-var location actually
exists at the SHA, and a secret-value scan proves the artifact itself carries
none; design-system — pointer liveness (every token/exemplar pointer resolves at
the SHA). Failure at promotion means the artifact stays provisional/unpromoted,
same as the categories that already validate.

## Acceptance hint
All 7 categories run a real self-validation at promotion; a test feeds each of
the three new validators a deliberately broken artifact (dangling pointer, stale
dep claim, value-shaped credential) and sees it rejected.
