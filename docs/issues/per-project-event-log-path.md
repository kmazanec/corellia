---
type: issue
title: "D3. Event log path is per-invocation env, not per-project"
description: The operator had to set CORELLIA_EVENTS_PATH by hand each run to avoid clobbering; there is no per-target-repo default.
tags: [ergonomic, eventlog, config]
timestamp: 2026-06-25
status: fixed-pending-live-proof
kind: idea
severity: low
---

> **Fixed-pending-live-proof (2026-07-06):** `buildStore()` now takes an optional
> `targetRepoRoot` and, when `CORELLIA_EVENTS_PATH` is unset, defaults the JSONL
> log to `out/<sanitized-basename-of-target-repo>/events.jsonl`
> (`defaultEventsPath()`), so runs against different target repos write to
> distinct logs. The target repo is `opts.targetRepoRoot` (live:self passes
> `corelliaRoot`) → `CORELLIA_REPO_ROOT` (the daemon's own repo-root source) →
> flat legacy `out/events.jsonl` when none is discernible. Explicit
> `CORELLIA_EVENTS_PATH` always wins. `.env.example` documents the new default.

# D3. Event log path is per-invocation env, not per-project

## Problem
The operator set `CORELLIA_EVENTS_PATH` by hand each run to avoid clobbering. There
is no per-target-repo default log path.

## Evidence
tiutni runs (operator set the env var each invocation). Source:
the gap-audit iteration (docs/iterations/2026-06-24-01-gap-audit-tiutni/index.md).

## Proposed direction
Derive a default per-target-repo log path.

## Acceptance hint
Without setting `CORELLIA_EVENTS_PATH`, runs against different target repos write to
distinct per-repo default log paths and do not clobber each other.
