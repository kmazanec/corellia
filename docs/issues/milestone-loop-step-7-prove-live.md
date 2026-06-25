---
type: issue
title: "Milestone loop step 7 — prove the flat root-loop live via live:self"
description: Prove the flat milestone root-loop converges live through the front door; the designated proof target flips example-word-count from BLOCK to converged PASS.
tags: [milestone-loop, engine, live-proof]
timestamp: 2026-06-25
status: open
kind: future-work
severity: high
---

# Milestone loop step 7 — prove the flat root-loop live via live:self

## Problem
The milestone loop (`runMilestone`, the four-guard halt) is built and green in tests
through step 6, but the flat root-loop has **not been proven live**. Step 7 of the
spec requires commissioning a small composite intent through the real front door and
confirming the loop converges (a green PR with per-round commits) and produces an
honest partial on a deliberately-hard intent. This is a hard gate: nesting (step 8)
must not proceed until the flat loop is proven.

## Evidence
docs/iterations/2026-06-24-03-milestone-loop/spec.md §8 build sequence step 7 (UNBUILT). The designated
proof target is `commissions/example-word-count.ts` flipping its current BLOCK to a
converged PASS. Context: the iteration-13 factory-first attempt
(the relevant iteration record under docs/iterations/, intent `live-self-93cbaae0`) stalled UPSTREAM of
this on a separate decide-robustness gap, so the loop itself has not yet reached a
live verdict. The hand-built `build/milestone-loop` branch (steps 1–6) remains
unmerged.

## Proposed direction
Commission a small composite intent via `live:self`; confirm convergence (green PR,
per-round commits) and an honest partial on a hard intent. Use
`commissions/example-word-count.ts` as the BLOCK→PASS proof. Record the run in the
event log / the relevant iteration record under docs/iterations/ per bootstrap discipline. (Note: the
decide-robustness gap may need resolving first for a clean run — see
`decide-json-robustness.md`.)

## Acceptance hint
`commissions/example-word-count.ts` commissioned via `live:self` converges to a
green PR with preserved per-round commits; a deliberately-hard intent halts with an
honest partial — and the run is recorded. Gate to step 8 is then open.
