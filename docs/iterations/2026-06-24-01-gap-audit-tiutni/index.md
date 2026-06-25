---
type: iteration
title: "Iteration 11 — Gap audit from driving an external greenfield app (tiutni)"
description: First time the factory was driven against a non-corellia, non-cats greenfield product (tiutni, an agentic tax-filing assistant) — a high-signal probe of its gaps, captured as a build backlog.
tags: [iteration, gap-audit, tiutni, greenfield, backlog, deployment, visual-verification, partial-delivery, scope-discipline]
timestamp: 2026-06-24
status: backlog-captured
---

# Iteration 11 — Gap audit from driving an EXTERNAL greenfield app (tiutni) through the factory

**Date:** 2026-06-24 · **Status:** Backlog captured

On 2026-06-24, a full hackathon deliverable — **tiutni**, an agentic tax-filing
assistant (LLM chat → filled IRS 2025 Form 1040, deployed to a public URL) — was
built by commissioning corellia three times via a new local-only harness
(`examples/live-tiutni.ts`). This was the first time the factory was driven against
a non-corellia, non-cats *greenfield product* with a human operator as the outer
harness for everything the factory could not do — a high-signal probe of its gaps.

The **exhaustive catalog** of every place the operator had to step in — in-run
stalls and structural gaps, each with evidence and a "BUILD:" line — is kept in its
own document to keep this ledger short:

→ **[gaps-from-tiutni.md](../../gaps-from-tiutni.md)** — Iteration 11 gap backlog
(categories A–D + severity-ordered build plan). Not yet built; this is the backlog.

Detailed gaps were filed as issues under `docs/issues/` (see
[docs/issues/index.md](../../issues/index.md)).

One-line summary: corellia today is a strong **single-module,
unit-test-verifiable, git-PR-shaped** worker. Building a real deployed product
surfaced that it cannot yet (a) see/verify non-test (visual/runtime/PDF)
correctness, (b) reach outside the repo (fetch assets, deploy, ground facts),
(c) recover or partially-deliver when one leaf fails, or (d) be trusted to stay
inside its declared scope.
