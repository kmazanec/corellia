---
type: index
title: Iterations catalog
description: Date-ordered index of Corellia's build iterations. Each is a migration-style dated directory; this lists them with a one-line description.
timestamp: 2026-06-25
---

# Iterations

Iterations are treated like database migrations: each lives in a directory named
`YYYY-MM-DD-HH-slug` (the prefix is the hour the iteration's work began, from git
history). They are more ephemeral than [ADRs](../adrs/index.md) — a record of how
the build actually unfolded, not a durable decision. Each dir has an `index.md`
(its overview + folded build notes) and, for already-shipped iterations, the
per-feature plans and `BUILD-PLAN-*.md` that drove it.

Newest last (chronological).

| Date · dir | Iteration | Status |
|---|---|---|
| [2026-06-10-01](2026-06-10-01-walking-skeleton/index.md) | 01 — Walking skeleton: the single recursive operation | shipped |
| [2026-06-10-10](2026-06-10-10-substrate/index.md) | 02 — Substrate, gates, listener, flywheel, live brain | shipped |
| [2026-06-10-21](2026-06-10-21-hands/index.md) | 03 — Hands: agentic leaf execution | shipped |
| [2026-06-11-14](2026-06-11-14-eyes/index.md) | 04 — Eyes: repo comprehension + impact-aware splitting | shipped |
| [2026-06-11-17](2026-06-11-17-taste/index.md) | 05 — Taste: real skills, structured emission, intent dial | shipped |
| [2026-06-12-01](2026-06-12-01-loop/index.md) | 06 — The loop closes: self-hosting | shipped |
| [2026-06-12-13](2026-06-12-13-conventions/index.md) | 07 — Layered conventions | shipped |
| [2026-06-12-21](2026-06-12-21-recursion/index.md) | 08 — Recursion (ADR-029): comprehension obeys the split law | landed on main |
| [2026-06-23-00](2026-06-23-00-comprehension-scoping/index.md) | 09 — Comprehension scoping (ADR-029 Dec 2+4); AC-2 + AC-3 proven | proven live |
| [2026-06-24-00](2026-06-24-00-deliver-foreign/index.md) | 10 — AC-4: deliver-to-foreign (cats), clean PR | proven live |
| [2026-06-24-01](2026-06-24-01-gap-audit-tiutni/index.md) | 11 — Gap audit from driving tiutni (external greenfield) | backlog captured |
| [2026-06-24-02](2026-06-24-02-commission-frontdoor/index.md) | 12 — The human→commission front door | shipped |
| [2026-06-24-03](2026-06-24-03-milestone-loop/index.md) | 13 — Building the milestone loop (steps 1–6 + ADR-033) | landed on main |
| [2026-06-25-21](2026-06-25-21-cascade-and-decide-fixes/index.md) | 14 — Cascade + decide-robustness fixes from driving slice C (ADR-037 + mustDecompose re-decide) | landed on main |
| [2026-06-26-00](2026-06-26-00-explore-then-emit-consolidation/index.md) | 15 — Explore-then-emit consolidation (ADR-039): one root cause, three audits, proven live | landed on main |
| [2026-06-27-18](2026-06-27-18-code-quality-patterns/index.md) | 16 — Factory code-quality patterns | landed on main |

Open follow-on work from these iterations lives in [../issues/](../issues/index.md).
