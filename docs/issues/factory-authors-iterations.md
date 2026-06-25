---
type: issue
title: "Teach the factory to create and work with date-prefixed iteration records"
description: When the factory delivers work, it should open/append the matching docs/iterations/YYYY-MM-DD-HH-slug record and update the catalog, the way a human iteration does.
tags: [factory, iterations, docs, self-hosting]
timestamp: 2026-06-25
status: open
kind: future-work
severity: medium
---

# Teach the factory to create and work with date-prefixed iteration records

## Problem
Iterations are now migration-style records: a `docs/iterations/YYYY-MM-DD-HH-slug/`
directory with an OKF `type: iteration` `index.md`, catalogued in
[docs/iterations/index.md](../iterations/index.md), with completed work summarized
as a line in [docs/log.md](../log.md). Today a *human* creates and fills these. The
factory delivers the work but does not author its own iteration record — so the
durable "how the build unfolded" trail depends on a harness being in the loop,
which contradicts Corellia's no-outer-harness goal (CLAUDE.md).

The factory should be able to **create** a new iteration record when it starts a
substantive piece of work, **append** run evidence/findings to the current
iteration's `index.md` as it goes (the new home for what used to go in
prototype-build-notes.md), update the **iterations catalog**, and add the closing
**log** line on delivery.

## Evidence
The 2026-06-25 docs reorg (see [docs/log.md](../log.md)) set up the date-prefixed
iteration scheme and folded the old running journal (`prototype-build-notes.md`)
into per-iteration `index.md` files. CLAUDE.md's bootstrap step 2 already instructs
a *harness* to record stuck points in the iteration `index.md` + log + issues —
this issue is about giving the *factory* that same ability natively.

## Proposed direction
Rough, not committed:
- A naming helper that mints a `YYYY-MM-DD-HH-slug` from a timestamp + intent slug
  (the hour granularity matches the existing scheme).
- A brokered, `docs/iterations/`-scoped write capability so a goal can create the
  dir + a conformant OKF `index.md` and append evidence sections to it.
- Catalog + log maintenance: on create, add a row to `iterations/index.md`; on
  delivery, add a `docs/log.md` line referencing the iteration (and any ADRs it
  produced). Keep these append-only and idempotent.
- Tie-in with [factory-manages-issues](factory-manages-issues.md): when an
  iteration that was commissioned from an issue lands, delete the issue.

Decide whether iteration authorship is a distinct goal type / family or a
post-delivery step the engine performs around any deliver-intent.

## Acceptance hint
A factory-delivered piece of substantive work produces (without a human editing
docs): a date-prefixed iteration dir with a conformant `index.md` holding its run
evidence, a new row in `iterations/index.md`, and a closing line in `docs/log.md`
that references the iteration and its ADRs.
