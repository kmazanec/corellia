---
type: issue
title: Listener has 1 of 4 designed input channels — no merge, signal, or triage path
description: Only commissioned intents (plus in-process blocker mints) create roots; the merge-event refresh channel, the external-signal event→root-goal adapter, and admission triage for non-commissioned roots are unbuilt.
tags: [listener, daemon, autonomous-seam, admission, knowledge-refresh]
timestamp: 2026-07-07
status: open
kind: future-work
severity: medium
---

# Listener has 1 of 4 designed input channels — no merge, signal, or triage path

## Problem
DESIGN.md's listener consumes four channels: human-commissioned intents, external
signals (the event→root-goal adapter), merge events (→ knowledge refresh goals),
and blocker reports (→ improvement goals). Today commissions are full-fidelity
and blockers mint in-process; the other two channels don't exist, and neither
does the admission-triage queue that non-commissioned roots must pass. Concretely:
knowledge artifacts are never warmed by merges (only split-time SHA drift catches
staleness), findings returned up the tree have no ticket queue a human can triage,
and no monitor/webhook/ticket can ever wake the factory. The factory acts only
when a human speaks first.

## Evidence
- capability-scout sweep (2026-07-07): "Listener: 1 of 4 channels wired…
  MISSING: external-signal adapter, merge-event→refresh, the event→root-goal
  autonomous seam; admission triage PARTIAL/MISSING" (src/listener/listener.ts).
- DESIGN.md "Two timescales" and "Admission: the factory never approves its own
  work queue."

## Proposed direction
In dependency order, as three separable slices: (1) admission triage — persist
proposed roots (tree findings first) into a queue surfaced via GET /status and
answered like a brief; (2) merge channel — a webhook route (or poll) per product
repo that mints drift-scoped map-repo refresh goals; (3) the general
event→root-goal adapter for external signals, whose minted roots pass the same
triage until trust is earned. Each is its own commission; this issue is the
umbrella that keeps the seam visible.

## Acceptance hint
A finding emitted by a live tree lands in a triage queue a human can approve into
a root (not silently dropped); a merge to a watched repo mints a refresh goal for
exactly the drift-fired categories.
