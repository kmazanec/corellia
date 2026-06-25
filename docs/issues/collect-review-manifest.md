---
type: issue
title: "C2. No diff review surface before collection"
description: The operator must manually git diff and inspect every changed element before each merge; there is no structured review manifest.
tags: [scope-safety, collect, review]
timestamp: 2026-06-25
status: open
kind: idea
severity: medium
---

# C2. No diff review surface before collection

## Problem
There is no structured review surface before collection — the operator must
manually `git diff main..tree/<id>` and check every element by hand (that every
element id the JS depended on still existed, that no network call changed, etc.)
before each merge.

## Evidence
Operator did: manually `git diff main..tree/<id>`, checked every element id the JS
depended on still existed, that no network call changed, etc., before each merge.
Source: the gap-audit iteration (docs/iterations/2026-06-24-01-gap-audit-tiutni/index.md).

## Proposed direction
A `collect` step that produces a structured **review manifest** (files changed,
public-symbol/contract deltas, scope conformance, test delta) so the operator (or an
auto-gate) reviews intent, not raw diff lines.

## Acceptance hint
Collection emits a review manifest summarizing files changed, public-symbol/contract
deltas, scope conformance, and test delta — reviewable without reading raw diff
lines.
