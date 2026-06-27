---
type: issue
title: "write_file overwrites the whole file, so a large-file edit truncates it — and the leaf cannot git-checkout to recover"
description: write_file replaces a file's ENTIRE content with the model's emitted text. For a large file (engine.ts, 4734 lines) the model emits a partial body and silently truncates the file to a fraction of itself. The model detected its own truncation and tried `git checkout` to recover, but run_script only allows declared scripts (test/typecheck/lint), so it was refused — the leaf had no way to undo the damage and looped on the resulting test failures until wall-clock.
tags: [engine, build, write-file, truncation, broker, run-script, self-heal, deliver-intent]
timestamp: 2026-06-26
status: open
kind: bug
severity: high
---

# write_file overwrites the whole file, so a large-file edit truncates it — and the leaf cannot recover

## Problem

`write_file(path, content)` replaces a file's **entire** content with the model's
emitted `content`. For a small new file (`iteration-tools.ts`, 292 lines) this is
fine. For a **large existing file** it is a trap: to make a two-line surgical
addition to `engine.ts` (4734 lines), the model must re-emit all 4734 lines
verbatim — and it doesn't. It emits the import it wanted plus a truncated tail, and
the file is silently overwritten down to a fraction of itself (run
`live-self-d2ff5150`: `engine.ts` went **4734 → 61 lines**, deleting 4674 lines to
add one import).

Nothing caught it at write time. The truncation is a valid `write_file` call (the
content is well-formed TypeScript, just radically incomplete); the broker's
scope/grant checks pass; no deterministic gate runs on a mid-loop write. The damage
only surfaced downstream as compile/test failures the leaf then couldn't fix.

Worse: **the leaf knew it had broken the file and could not self-heal.** It issued
`git checkout src/engine/engine.ts` to restore the original — exactly the right
instinct — but `run_script` only executes declared scripts (`test`/`typecheck`/
`lint`); a `git` command is refused. With no way to revert, the leaf re-ran
`engine.test.ts` (now failing because of its own truncation) five times, never
converged, and ran out the wall-clock.

## Evidence

Run `live-self-d2ff5150` (slice C, run 18) — the closest slice C came to delivering.
After all dives emitted REAL and the context-thrash + ceiling fixes let the build
leaf survey then build:

- `impl` made **10 `write_file` calls**; one overwrote `engine.ts` to 61 lines
  (import line + truncated tail). `iteration-tools.ts` (new, 292 lines) wrote fine.
- `script-ran` log shows the self-heal attempt and the thrash that followed:
  - `test git checkout src/engine/engine.ts` (×2, exitStatus null — refused)
  - `test tests/engine/engine.test.ts` (×5, exitStatus 1 — failing on the truncation)
  - `test tests/engine/worktree.test.ts` (30004 ms → hung/timed out) and a bare
    `test` (30002 ms → hung) — full-suite-ish runs that ate 30 s each.
  - **15 of 40 `run_script` calls were refused** (freeform/`git`/mis-targeted).
- The leaf never emitted; the `tests` build leaf never ran. Wall-clock overran at
  ~32 min. (The `iteration-tools.ts` body itself was good — salvaged in `1686096`.)

## Proposed direction

(Rough, not committed.)

- **A patch/range edit tool, or a write that diffs against the current file.**
  The highest-leverage fix: let a build leaf express an edit as a localized change
  (anchor + replacement, or a unified diff) rather than re-emitting the whole file.
  An edit that only names the region it changes cannot truncate the rest.
- **Guard against catastrophic shrink at write time.** A `write_file` that replaces
  an N-line file with a body a small fraction of N is almost always a truncation,
  not an intended rewrite. The broker (or a deterministic post-write check) could
  flag/refuse a write that drops a large existing file below, say, 25 % of its prior
  line count unless explicitly confirmed — turning a silent corruption into a
  catchable signal.
- **A scoped revert affordance.** A leaf that detects it broke a file needs a way
  back. Either a declared `revert <path>` script (git-checkout of a single in-scope
  path), or making write idempotent/transactional so a bad write can be rolled back.
  The instinct to `git checkout` was correct; the harness simply forbade it.
- **Two more lessons from the same run (file separately if they recur):**
  - **A single `run_script` test target can hang 30 s** (worktree.test.ts, bare
    `test`) and there is no per-script timeout shorter than the leaf wall-clock —
    two such hangs burned a minute and pushed the run past budget.
  - **`run_script` refusals are silent friction**: 15/40 refused with no
    machine-readable hint of WHY or WHAT is allowed, so the model kept trying
    variants (`test src/...` vs `test tests/...`, `git checkout`, bare `test`).
    A refusal that names the allowed script set + target form would cut the flailing.

## Acceptance hint

A build leaf making a small change to a large file does not truncate it — either it
edits by range/diff, or a catastrophic-shrink guard turns a truncating whole-file
write into a caught error the leaf can repair; and a leaf that does break a file has
an in-scope way to revert rather than looping on the resulting failures to wall-clock.
