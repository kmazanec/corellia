---
type: issue
title: "a transient provider timeout repeats the same failure signature and is escalated as an isomorphic failure to a hard block"
description: A step-loop LLM request that aborts on timeout produces the identical failure signature ("step-loop:failed") on retry, so the isomorphic-failure detector reads a transient infrastructure fault as "the model keeps making the same mistake" and blocks the goal instead of backing off and retrying.
tags: [engine, brain, retry, isomorphic-failure, timeout, robustness, step-loop]
timestamp: 2026-07-01
status: open
kind: bug
severity: medium
---

# A transient provider timeout is escalated as an isomorphic failure to a hard block

## Problem

The isomorphic-failure detector exists to stop the model repeating the same
*mistake* (same input → same wrong output). But a **transient provider fault** —
an LLM request aborted on timeout — also produces the identical failure
signature on retry (`step-loop:failed`), so the detector escalates it to a block
("Needs human resolution" → auto-deny in an unattended run). Infrastructure
flakiness is being classified as model behavior. The right response to a
timeout is a backoff-and-retry (possibly with a smaller prompt), not a block —
and a timeout should not count toward isomorphism at all, since nothing about
the *attempt* was wrong.

## Evidence

Commission run `observability-live-tail` (2026-07-01): goal
`observability-live-tail/ac` ("Mint frozen acceptance criteria") failed its step
loop with findings `"Step loop failed: The operation was aborted due to
timeout"`, retried, hit the same signature, and blocked with "Isomorphic failure
detected (signature: step-loop:failed)". The block then cascade-blocked `judge`
and `pr`. Events under `out/commission-observability-live-tail/`.

> **Update (2026-07-05, run 7).** Recurred: the "Add test coverage for live
> view behavior" implement goal hit `step-loop:failed` twice (isomorphic) and
> hard-blocked, cascading into three dependent blockers on the root report —
> in a run that was otherwise one flaky test away from passing its acceptance
> bar.

## Proposed direction

(Rough, not committed.) Classify step-loop failures before signature matching:
a timeout/abort/network-class error is *transient*, retried with backoff and
exempt from the isomorphic-failure count (bounded by the attempt budget, so a
persistently-down provider still terminates). Only model-behavior failures
(deterministic-check failures, judge failures, malformed emissions) feed the
isomorphism detector.

## Acceptance hint

A step-loop attempt that fails on a provider timeout is retried (with backoff)
without incrementing the isomorphic-failure count; two consecutive timeouts do
not block a goal that still has attempt budget.
