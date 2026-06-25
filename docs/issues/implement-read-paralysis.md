---
type: issue
title: "An implement leaf can read-loop without ever writing — no forced-emit backstop like comprehend has"
description: A make/implement leaf on a hard task reads many files but never transitions to a write, looping to a step-loop:failed isomorphic block; the comprehend over-explore forced-emit backstop is scoped out of implement leaves.
tags: [engine, step-loop, implement, read-paralysis, forced-emit]
timestamp: 2026-06-25
status: open
kind: bug
severity: high
---

# An implement leaf can read-loop without ever writing — no forced-emit backstop like comprehend has

## Problem
On a hard multi-file implement task, a make/`implement` leaf can take many
read-only steps (list_dir / read_file / search) **without ever attempting a single
`write_file`**, looping until the isomorphic-failure detector blocks it as
`step-loop:failed` with nothing produced.

The engine HAS a backstop for this shape — but only for the **comprehend** family.
`runStepLoop` carries a `COMPREHEND_READ_CEILING = 16`: once a comprehend leaf
crosses it, the engine FORCES a two-phase emit on the next step (added for the AC-4
over-explore failures). The comment explicitly excludes implement leaves:

> "deliver/implement leaves are untouched (they legitimately make many
> write_file/run_script/re-read calls)."

That assumption holds for a *normal* implement leaf (read → write → test →
re-read, interleaved) but breaks for a *hard* one that read-paralyzes: pure reads,
no write, until block. An implement leaf has two legitimate modes and the engine
only backstops the comprehend version of the failure.

## Evidence
Build runs #7 and #8 (slice C — the ADR-034 engine integration steps; the one
mechanism the factory couldn't build). Run #8 (`live-self-cb6abfc2`, $0.56): the
implement leaf ran **11 steps, 50 read-class tool calls (16 list_dir + 28 read_file
+ 6 search), and 0 write_file** — no budget exhaustion, no tier escalation, no
refused write — then blocked on `step-loop:failed`. Step-by-step trace: every one
of the 11 steps was read-only. Run #7's slice C: same, `write_file=0`. The leaf
comprehends the task (it reads the right files) but never commits to producing the
coordinated multi-file change (modify `engine.ts` + a new module + tests).
Backstop site: `src/engine/engine.ts` `runStepLoop`, the `COMPREHEND_READ_CEILING`
forced-emit logic.

## Proposed direction
(Rough, not committed.)
- **An implement/make read-paralysis backstop.** Track consecutive *write-free*
  steps for a make leaf; after a ceiling of pure read-only steps (set well above
  a normal read→write rhythm, e.g. 5–6 write-free steps), inject a forcing nudge —
  "you have read enough; make your first edit now (write_file), or emit your
  artifact" — rather than letting it loop to an isomorphic block. Mirror the
  comprehend forced-emit, scoped to make leaves and keyed on *write-free* steps
  rather than a raw read count (so a leaf that IS writing/testing is never cut
  short).
- **Or** a skill nudge in `build.md`: an explicit "read at most N files before your
  first edit; prefer writing a first draft and iterating" — cheaper but softer than
  an engine backstop.
- The isomorphic-failure block should perhaps distinguish "repeating a *failure*"
  from "repeating read-only *progress-shaped* steps that produced nothing" — the
  latter wants a forced-emit, not a terminal block.

## Acceptance hint
An implement leaf on a hard multi-file task either makes its first write within a
bounded number of read-only steps (nudged/forced), or emits — instead of
read-looping to a `step-loop:failed` block with 0 writes. Slice C (the ADR-034
engine integration steps) becomes buildable by the factory.
