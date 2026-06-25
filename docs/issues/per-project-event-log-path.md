---
type: issue
title: "D3. Event log path is per-invocation env, not per-project"
description: The operator had to set CORELLIA_EVENTS_PATH by hand each run to avoid clobbering; there is no per-target-repo default.
tags: [ergonomic, eventlog, config]
timestamp: 2026-06-25
status: open
kind: idea
severity: low
---

# D3. Event log path is per-invocation env, not per-project

## Problem
The operator set `CORELLIA_EVENTS_PATH` by hand each run to avoid clobbering. There
is no per-target-repo default log path.

## Evidence
tiutni runs (operator set the env var each invocation). Source:
`docs/gaps-from-tiutni.md` §D3.

## Proposed direction
Derive a default per-target-repo log path.

## Acceptance hint
Without setting `CORELLIA_EVENTS_PATH`, runs against different target repos write to
distinct per-repo default log paths and do not clobber each other.
