---
type: issue
title: "B1. Acquiring an EXTERNAL ASSET the build depends on (the real IRS 1040 PDF)"
description: The factory has no fetch/acquire-asset tool, no network-egress grant, and no notion of a binary build-input, so asset-dependent features are impossible.
tags: [structural, asset, tool]
timestamp: 2026-06-25
status: open
kind: future-work
severity: medium
---

# B1. Acquiring an EXTERNAL ASSET the build depends on (the real IRS 1040 PDF)

## Problem
The factory has no `fetch_url` / `acquire_asset` tool, no network-egress grant, and
no notion of a binary build-input. A feature that depends on an external asset (the
PDF-fill feature) is *impossible* for the factory as-is — it can only edit text it
already sees.

## Evidence
Operator did: `curl`ed the official `f1040.pdf` from irs.gov, confirmed the tax
year, inspected its 199 AcroForm fields, vendored it into the repo. Source:
the gap-audit iteration (docs/iterations/2026-06-24-01-gap-audit-tiutni/index.md).

## Proposed direction
A sandboxed `fetch_resource` tool (allow-listed domains, size cap, checksum recorded
as an event) + an `asset` artifact kind so a goal can declare "I need file X from
URL Y" and have it fetched, vendored, and provenance-logged.

## Acceptance hint
A goal can declare a needed external asset; the factory fetches it from an
allow-listed domain, vendors it into the worktree, and records its checksum as an
event.
