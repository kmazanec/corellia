---
type: issue
title: "Teach the factory to create, consume, and delete OKF issues itself"
description: Corellia should be able to file, pick up, and close issues in docs/issues/ as native factory operations, not only via the human-facing create-issue/commission skills.
tags: [factory, issues, library, engine, self-hosting]
timestamp: 2026-06-25
status: open
kind: future-work
severity: medium
---

# Teach the factory to create, consume, and delete OKF issues itself

## Problem
Today the OKF issue lifecycle (capture → plan → build → delete) is driven by
*harness* skills: `create-issue` files an issue, `commission` consumes one. The
factory itself has no native way to participate. For Corellia to follow its own
"everything that must persist lives in this repo" rule (CLAUDE.md), the factory
should be able to:

- **Create** an issue when a run surfaces unplanned follow-on work (a stall, a
  deferred sub-problem, an observed bug it shouldn't fix in-scope) — instead of
  that finding being lost or only captured by a human.
- **Consume** an issue as an intent: turn a `docs/issues/<slug>.md` into a goal
  through the front door (the commission path), the same way a human would.
- **Delete** an issue when the work it describes has landed (as an iteration, an
  ADR, and code), closing the loop so the backlog reflects only undone work.

This is the factory becoming a first-class participant in the same discipline the
human tooling already uses, not just the subject of it.

## Evidence
The docs reorg (2026-06-25, see [docs/log.md](../log.md)) established the OKF
issue/iteration/log model and the `create-issue` + `commission` skills. Those are
harness skills; the factory's own front door
([commission](../../.claude/skills/commission/SKILL.md),
`src/contract/brief.ts`) consumes `CommissionInput`, not issue files. The gap is the
issue↔factory bridge.

## Proposed direction
Rough, not committed:
- A small reader that parses an OKF `type: issue` file into the seed of a
  `CommissionInput` (mirrors the `commission` skill's "from an existing issue"
  mode, but in code the factory can call).
- A brokered capability for a goal to *emit* an issue (write
  `docs/issues/<slug>.md` with valid OKF frontmatter) when it records unplanned
  follow-on — gated like other write tools, scoped to `docs/issues/`.
- An issue-deletion step tied to delivery: when an iteration that was commissioned
  *from* an issue lands, the issue is removed (and a line added to the log). The
  commission artifact already records its source issue (`// from docs/issues/...`).
- Validation: an OKF lint (every issue has `type`/`kind`/`severity`/`status`) so
  factory-authored issues stay conformant — fold into `scripts/lint-library.ts` or
  a sibling.

Decide whether this is one ADR or rides on the existing front-door contracts.

## Acceptance hint
A factory run can: write a conformant new issue into `docs/issues/` when it defers
work; be commissioned directly from an existing issue file; and, on successful
delivery of an issue-sourced commission, the originating issue is deleted with a
corresponding `docs/log.md` entry — all without a human hand-editing the backlog.
