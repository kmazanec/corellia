---
type: iteration
title: "Iteration 07 — Layered conventions: the factory honours how each repo wants its code"
description: A code-writing goal carries the factory's global conventions AND the relevant slice of the host repo's AGENTS.md/CLAUDE.md, with the host overriding global on conflict.
tags: [iteration, conventions, shared-preamble, host-conventions, injection-seam]
timestamp: 2026-06-12
status: shipped
---

# Iteration 07 — Layered conventions: the factory honours how each repo wants its code

**Date:** 2026-06-12 · **Status:** Shipped

This iteration taught the factory to honour conventions at two layers. A new
shared skill preamble carries global factory taste that every code-writing family
inherits (and "comments are timeless" moved out of the harness redirect file into
it, now read at runtime), and a host-conventions reader injects the relevant slice
of the target repo's `AGENTS.md`/`CLAUDE.md` with host-overrides-global precedence.
A foreign repo's convention file shapes output but never commands it — injected as
data to weigh, not instructions to obey. Both features shipped; final gate 1379
passed / 21 skipped / 0 failed.

## Features
- [00-overview](00-overview.md) — Iteration brief (why / done-when / features).
- [01-shared-preamble](01-shared-preamble.md) — Shared skill preamble (global layer) + the injection seam.
- [02-host-conventions](02-host-conventions.md) — Host-conventions reader (repo layer + override).

## ADRs produced
ADR-028 (layered conventions: global skills + shared preamble, host AGENTS.md/CLAUDE.md, host-overrides-global).

## Build plan
[BUILD-PLAN-07-conventions](BUILD-PLAN-07-conventions.md)
