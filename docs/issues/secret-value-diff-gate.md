---
type: issue
title: No deterministic secret-value scan on emitted diffs — the vault-ref gate is prose-only
description: GOAL-TYPES' implement card lists "vault-ref scan (no secret values)" in the deterministic gate, but no diff-level secret-value scanner exists; risk.ts classifies by path and the only value scan guards knowledge artifacts, not emitted code.
tags: [engine, deterministic-gate, secrets, security]
timestamp: 2026-07-07
status: open
kind: bug
severity: medium
---

# No deterministic secret-value scan on emitted diffs — the vault-ref gate is prose-only

## Problem
The `implement` exemplar in GOAL-TYPES.md lists `vault-ref scan (no secret
values)` among its deterministic checks, and DESIGN.md's eval economics names
"secret-reference scans" in the deterministic-before-judge floor. No such gate
exists on the emission path: `src/library/risk.ts` classifies risk by PATH
(secrets-adjacent files), never by value, and the only value-shaped secret
scanner in the repo guards knowledge artifacts at promotion
(`credentialsCheck`, src/library/knowledge-checks.ts) — not the diffs goals
emit. A leaf that hardcodes an API key into product code passes every
deterministic check today; catching it is left to the judge, which is exactly
what the deterministic floor exists to avoid.

## Evidence
- Discovered during the behavioral-fixture-library build (2026-07-07): the
  planned "secret-value leak → vault-ref scan" fixture pair had no gate to pin —
  "the pin would be circular" (fixtures/README.md, "Note on the fourth gate";
  docs/issues/behavioral-fixture-library.md Fixed addendum).
- GOAL-TYPES.md implement card, `eval.deterministic` list; DESIGN.md "Eval
  economics — deterministic before judge".

## Proposed direction
Lift the high-signal value patterns already proven in `credentialsCheck`
(provider-prefixed keys, AWS/GitHub/Slack/Google tokens, JWTs, PEM blocks,
`secret = <value>` assignments) into a shared scanner and run it over every
emitted diff alongside `scanDiffForProcessLanguage` — same emission choke
point, same failure semantics (cannot emit; report, don't judge). Add the
originally-planned fixture pair (`fixtures/secret-value-leak/`) to pin it once
it exists.

## Acceptance hint
A diff introducing a value-shaped secret cannot pass the deterministic gate (a
fixture pair proves catch-the-defect / pass-the-clean), while a vault
*reference* (env-var name, path) passes; the scanner is shared with
credentialsCheck rather than duplicated.
