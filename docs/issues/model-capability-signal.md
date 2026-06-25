---
type: issue
title: "D2. No model-capability signal"
description: The factory gives no signal that a configured tier is underperforming on tool-calling, masking model-driven blocks.
tags: [ergonomic, metrics, brain]
timestamp: 2026-06-25
status: open
kind: idea
severity: low
---

# D2. No model-capability signal

## Problem
The factory gives no signal that a tier is underperforming on tool-calling. A
total block can correlate with a configured model's weaker tool-use, but nothing
surfaces it.

## Evidence
Run 2's (tiutni) total block correlated with the configured model's weaker tool-use.
Source: the gap-audit iteration (docs/iterations/2026-06-24-01-gap-audit-tiutni/index.md).

## Proposed direction
Track per-tier tool-call success rate as a metric; surface "this tier is failing
tool calls" in the run summary.

## Acceptance hint
The run summary reports per-tier tool-call success rate and flags a tier that is
failing tool calls.
