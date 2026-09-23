---
type: issue
title: "The improvement loop does not run on the job queue"
description: Queue workers run without a standing envelope, so a failed job's blockers are routed but no improve-factory tree is ever admitted; ADR-027's envelope and product-first admission live in one Listener's memory and need a queue-level home before the fleet can improve itself.
tags: [listener, improvement-loop, jobs, worker, adr-027, adr-051]
timestamp: 2026-09-23
status: open
kind: future-work
severity: medium
---

# The improvement loop does not run on the job queue

## Problem

ADR-027's improvement loop mints one `improve-factory` commission per failed
run and admits it only while the standing envelope has dollars left and no
product work is running or queued. Both checks live in one `Listener`'s
memory (`envelopeSpentUsd`, `reservations`, `waitQueue`). Under ADR-051 each
queue worker has its own listener and runs one job, so those checks see one
worker, not the fleet. Workers are therefore built without a standing
envelope: a failed job still appends its `blocker-routed` events, but the
minted commission is dropped and no improvement tree runs.

## Evidence

- `src/daemon/worker.ts` constructs its `Listener` with no `standingEnvelope`.
- `Listener.commissionImprovement` returns early when no envelope is
  configured (`src/listener/listener.ts`).
- ADR-051 § As built, last bullet.

## Proposed direction

Enqueue minted improvement commissions as jobs of their own kind, and move
the two admission checks to claim time: product-first (skip improvement jobs
while any product job is queued or running for the repo), and envelope
headroom (a small `corellia_envelope` row charged with each improvement job's
measured spend, read from the log as `treeSpendUsd` does today). The worker
passes a mint callback to its listener instead of a standing envelope.

## Acceptance hint

With two workers on one repo, a job that finishes with blockers produces one
queued improvement job, which no worker claims while product jobs are queued,
and which stops being admitted once the envelope's dollars are spent.
