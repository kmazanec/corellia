---
type: issue
title: "Make OKF doc discipline a property the factory enforces, not just follows"
description: The factory should keep docs/ OKF-conformant and route durable findings to the right home (issue vs iteration vs ADR vs log) as a native rule, so the doc model self-maintains.
tags: [factory, docs, okf, constitution, self-hosting]
timestamp: 2026-06-25
status: open
kind: idea
severity: low
---

# Make OKF doc discipline a property the factory enforces, not just follows

## Problem
The docs are now an OKF bundle (`type` on every doc; reserved `index.md`/`log.md`;
issues ephemeral, iterations dated, ADRs durable — see
[docs/index.md](../index.md)). Right now this discipline is *convention* the human
and the harness skills uphold. For it to survive without a harness in the loop, the
factory should treat it as a property it **enforces and maintains** — the same way
the constitution lint enforces code rules.

Two halves:
1. **Conformance** — a lint that fails if any `docs/**/*.md` lacks a non-empty
   `type`, if an `index.md`/`log.md` violates its reserved structure, or if an
   issue is missing `kind`/`severity`/`status`. Run it in the same gate as
   `npm run lint`.
2. **Routing** — encode the "where does this finding go?" decision so the factory
   (and anyone reading) applies it consistently: durable design decision → ADR;
   unplanned/undone work → issue; how-the-build-unfolded → the iteration record;
   one-line completed-work summary → the log. This is the routing CLAUDE.md
   describes in prose; making it a checkable rule keeps the bundle from rotting.

## Evidence
The 2026-06-25 reorg ([docs/log.md](../log.md)) established the model and the
`create-issue` / `commission` skills. Depends on
[factory-manages-issues](factory-manages-issues.md) and
[factory-authors-iterations](factory-authors-iterations.md) for the create/delete
mechanics this would police.

## Proposed direction
- Add an OKF conformance check (extend `scripts/lint-library.ts` or a sibling
  `scripts/lint-docs.ts`) wired into the lint gate.
- Consider a constitution-style statement of the routing rule
  (`src/library/constitution.ts` is where machine-enforced rules live) so it's
  first-class, not just prose in CLAUDE.md / docs/index.md.
- Keep it light: the OKF spec is intentionally permissive (reject only on missing
  core requirements); match that — enforce `type` hard, treat the rest as warnings.

## Acceptance hint
`npm run lint` (or a doc-lint it calls) fails on a `docs/` markdown file missing a
`type`, on a malformed reserved file, or on an issue missing its required fields;
and the routing rule for findings is written somewhere checkable, not only in prose.
