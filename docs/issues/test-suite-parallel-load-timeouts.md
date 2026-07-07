---
type: issue
title: "Git-heavy scripted tests time out under full-suite parallel load"
description: convergence.test.ts, convergence-eyes.test.ts, and pr-boundary.test.ts intermittently fail on per-test timeouts (5s/30s) when the full suite runs at ~10x parallelism, though every one passes in isolation; the suite cannot be trusted as a single-shot CI gate until the timeouts reflect loaded-machine reality or the git-spawning tests are serialized.
tags: [tests, flake, ci, wall-clock, dx]
timestamp: 2026-07-06
status: open
kind: bug
severity: low
---

# Git-heavy scripted tests time out under full-suite parallel load

## Problem

The git-spawning scripted tests — `tests/engine/convergence.test.ts`,
`tests/engine/convergence-eyes.test.ts`, `tests/integration/pr-boundary.test.ts`
(and occasionally the other `tests/integration/*` files) — carry per-test
timeouts of 5s/30s that assume a lightly-loaded machine. A full `npm test`
packs ~2,000s of test time into ~220s of wall-clock (~10× parallelism), and
under that contention these tests intermittently exceed their timeouts and
fail, while passing 100% of the time when their file is run alone.

This matters now that CI exists (`.github/workflows/build-image.yml` runs
`npm test` as the gate before every image push): a hosted runner is slower and
noisier than a dev laptop, so single-shot full-suite runs will flake.

## Evidence

2026-07-06 cloud-ready wave: five independent agents each reported the same
pattern on full-suite runs during concurrent builds (1–19 failures, all
"Test timed out", all in the git-heavy files, all green in isolation). Two
final gate runs on the merged `feat/cloud-ready` branch on an otherwise idle
machine still tripped 2–4 of them (`convergence*`), each passing 8/8 isolated
immediately after.

> **Addendum (2026-07-07).** A second flake mode in the same family:
> `tests/daemon/config-sinks.test.ts` mutates `process.env` and fails under
> parallel suite runs (3 notification-sink tests) while passing 9/9 isolated —
> env-var pollution between concurrently-running files, not load. The fix
> should isolate env mutation (vitest env stubbing or a serial project) along
> with the timeout work.

## Proposed direction

(Rough, not committed.) One or more of: raise the per-test timeouts on the
git-spawning tests to loaded-machine reality; move them to a vitest project
with bounded concurrency (serialize the git-heavy files); or split `npm test`
into `test:fast` (parallel) and `test:integration` (serial) with CI running
both stages. Prefer whichever keeps a single honest exit code for CI.

## Acceptance hint

Three consecutive full `npm test` runs on a loaded machine (or CI runner) exit
0 without hand-rerunning any file in isolation.
