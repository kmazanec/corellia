---
type: issue
title: "A3. Duplicate-read refusal (F-64) blocks progress without offering the cached value inline"
description: F-64 returns a refusal the model must reason around instead of handing back the prior read's result.
tags: [in-run-stall, engine, broker]
timestamp: 2026-06-25
status: fixed-pending-live-proof
kind: bug
severity: low
---

> **Fixed-pending-live-proof (2026-07-06):** the F-64 duplicate-read guard now
> caches each read-only tool's successful output (keyed by dupKey) and, on a
> byte-identical repeat, hands that content back inline behind a
> `[duplicate read — cached result …]` prefix instead of a bare refusal, so the
> leaf proceeds. The tool-call event stays `outcome:'refused'` (still not
> dispatched, not budget-debited) with a reason noting the cache was served. The
> cache is released in lockstep with the dedup guard on eviction and
> write-invalidation, so no stale content is served after a write.

# A3. Duplicate-read refusal (F-64) blocks progress without offering the cached value inline

## Problem
F-64 correctly prevents wasteful re-reads, but it returns a *refusal* the model
must reason around, sometimes stalling, instead of handing back the result.

## Evidence
Run 1 (tiutni), ×2: `"Duplicate read refused (F-64): an identical call to
list_dir/read_file … was already executed this attempt."` Source:
the gap-audit iteration (docs/iterations/2026-06-24-01-gap-audit-tiutni/index.md).

## Proposed direction
When refusing a duplicate read, **return the prior result's content** (or a pointer
the broker auto-expands) rather than only an error.

## Acceptance hint
A duplicate read returns the cached content (or an auto-expanding pointer) instead
of a bare refusal, and the leaf proceeds without stalling.
