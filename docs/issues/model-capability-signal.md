---
type: issue
title: "D2. No model-capability signal"
description: The factory gives no signal that a configured tier is underperforming on tool-calling, masking model-driven blocks.
tags: [ergonomic, metrics, brain]
timestamp: 2026-06-25
status: fixed-pending-live-proof
kind: idea
severity: low
---

> **Fixed-pending-live-proof (2026-07-06, ADR-044).** The `toolCallSignal`
> projection (`src/eventlog/projections.ts`) folds per-tier tool-call health from
> the event log — steps, malformed-tool-call re-prompts, transport retries,
> tool-call ran/refused, and escalations-out — and `scripts/trace.ts` prints it,
> flagging a tier whose malformed-tool-call rate crosses 20% with "this tier is
> failing tool calls — consider re-tagging its model in the catalog." Attribution
> is honest to what the events carry: no event stamps a model id per step, so a
> goal's tier is reconstructed from `tier-escalated` / `judge-verdict` anchors and
> the tier→model mapping is reported alongside as the bridge to a concrete model.
> Covered by `tests/eventlog/tool-call-signal.test.ts`. Awaiting a live run's
> trace to confirm the flag fires on a real weak-tool-calling band.

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
