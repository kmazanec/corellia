---
type: issue
title: "A3. Duplicate-read refusal (F-64) blocks progress without offering the cached value inline"
description: F-64 returns a refusal the model must reason around instead of handing back the prior read's result.
tags: [in-run-stall, engine, broker]
timestamp: 2026-06-25
status: open
kind: bug
severity: low
---

# A3. Duplicate-read refusal (F-64) blocks progress without offering the cached value inline

## Problem
F-64 correctly prevents wasteful re-reads, but it returns a *refusal* the model
must reason around, sometimes stalling, instead of handing back the result.

## Evidence
Run 1 (tiutni), ×2: `"Duplicate read refused (F-64): an identical call to
list_dir/read_file … was already executed this attempt."` Source:
`docs/gaps-from-tiutni.md` §A3.

## Proposed direction
When refusing a duplicate read, **return the prior result's content** (or a pointer
the broker auto-expands) rather than only an error.

## Acceptance hint
A duplicate read returns the cached content (or an auto-expanding pointer) instead
of a bare refusal, and the leaf proceeds without stalling.
