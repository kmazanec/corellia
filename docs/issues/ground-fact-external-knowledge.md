---
type: issue
title: "B5. Authoring its OWN external knowledge (tax law: the 2025 standard deduction)"
description: The factory has no grounded-knowledge step; it will confidently write a plausible-but-wrong constant with no way to check reality.
tags: [structural, knowledge, grounding]
timestamp: 2026-06-25
status: open
kind: future-work
severity: medium
---

# B5. Authoring its OWN external knowledge (tax law: the 2025 standard deduction)

## Problem
No grounded-knowledge step. The factory will confidently write a
plausible-but-wrong constant (or "fix" a correct one to a wrong one) with no way to
check reality — dangerous for a domain like tax law.

## Evidence
Operator supplied the 2025 brackets/deduction figures; and when a later edit changed
the standard deduction to `$15,750`, the operator caught it, checked the
authoritative source (the IRS form's own margin) before acting, and confirmed
`$15,750` was actually correct for 2025 (OBBBA) — i.e. did the fact-verification the
factory has no mechanism for. Source: `docs/gaps-from-tiutni.md` §B5.

## Proposed direction
A `ground-fact` capability — when a goal depends on an external fact (a rate,
constant, API contract), require a cited source captured as a knowledge artifact
(ties into B1 `fetch_resource` + the existing knowledge-artifact layer and ADR-019
verify-on-read). A judge should reject load-bearing magic numbers with no citation.

## Acceptance hint
A load-bearing external constant (a rate or figure) must carry a cited source
captured as a knowledge artifact; a judge rejects an uncited magic number.
