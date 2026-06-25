---
type: index
title: Corellia docs
description: Top-level index of Corellia's documentation, organized as an OKF (Open Knowledge Format) bundle.
timestamp: 2026-06-25
---

# Corellia documentation

This `docs/` tree is an [OKF](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md)
(Open Knowledge Format) bundle: every doc is a markdown file with a `type`
frontmatter field, and the reserved filenames `index.md` (a catalog) and `log.md`
(a reverse-chronological history) carry their OKF meanings.

## Durable design (long-lasting)

- [PRD.md](PRD.md) — the product requirements: what Corellia is and must do.
- [ARCHITECTURE.md](ARCHITECTURE.md) — the system architecture overview.
- [adrs/](adrs/index.md) — Architecture Decision Records (the durable decisions).
- [container.md](container.md) — container/packaging reference.

The machine-enforced rules live in `src/library/constitution.ts`; the factory's
own design intent lives in the repo-root `DESIGN.md` and `GOAL-TYPES.md`.

## The build, as it happened

- [log.md](log.md) — reverse-chronological change log (replaces the old STATUS.md).
- [iterations/](iterations/index.md) — date-prefixed, migration-style iteration
  records. More ephemeral than ADRs.

## Open work

- [issues/](issues/index.md) — ephemeral backlog of ideas, bugs, and future work.
  Issues are destroyed once implemented (turned into iterations, ADRs, and code).

## How these relate

A captured intent starts as an **issue**. When picked up, it is built as an
**iteration** (which may produce one or more **ADRs** for durable decisions), and
the issue is deleted. Completed work is recorded in the **log** with a pointer to
the iteration/ADR that owns the detail. The `commission` and `create-issue` skills
(under `.claude/skills/`) are the human-facing tools for filing and consuming
issues; the factory itself is being taught the same vocabulary.
