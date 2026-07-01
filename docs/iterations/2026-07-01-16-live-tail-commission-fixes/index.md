---
type: iteration
title: "Iteration 20 — Acceptance-floor fixes from driving the live-tail commission"
description: Four bootstrap-driven fixes surfaced by running the observability-live-tail commission — acceptance file criteria read the round's worktree (not the artifact list), factory-initiated check scripts get a realistic wall-clock ceiling, code-shape joins the default declared scripts, and the commission runner mirrors artifacts under its out dir instead of crashing on repo-relative paths.
tags: [iteration, factory, commission, acceptance-criteria, checks, worktree, script-runner, bootstrap]
timestamp: 2026-07-01
status: landed on main
---

# Iteration 20 — Acceptance-floor fixes from driving the live-tail commission

## Source

Running the `observability-live-tail` commission through the front door
(`npm run commission:run -- observability-live-tail`, 2026-07-01, $2.17,
events under `out/commission-observability-live-tail/`). The run built the
implementation (CLI script, live-tail module, tests, package.json wiring — all
present in the tree worktree) but FAILED its acceptance bar 0/8 and then the
runner itself crashed writing the report. Each stall was the signal for a fix,
hand-built on `main` (interactive cleanup) per the bootstrap loop.

## What the run exposed, and what this iteration fixes

### 1. Acceptance `{file}` criteria checked the artifact list, not the worktree

`criterionToCheck` mapped a `{file, anchor?}` criterion to `fileContains`, which
reads only the emitted artifact's in-memory file list. ADR-031 §4.3 says the
round is assessed against the worktree — and `{script}` criteria already run
there. Result: acceptance reported `File "package.json" not found in artifact.`
while the modified `package.json` sat in the worktree.

**Fix:** `sandboxFileContains` (`src/library/checks.ts`) reads
`ctx.sandboxRoot` when a sandbox is in context (with a traversal guard), and
falls back to the artifact-based check otherwise. `criterionToCheck` now uses
it. Tests at both boundaries (`tests/library/checks.test.ts`,
`tests/library/acceptance-criteria.test.ts`).

### 2. Factory-initiated check scripts inherited the 30s model-tool cap

The `CheckContext.runScript` built in `openSandboxAssembly` called the script
runner with its default 30s ceiling — sized for *model* `run_script` calls,
which are told to scope their targets. Acceptance criteria run whole declared
scripts; this repo's full suite takes ~2 minutes, so a `{script:"test"}`
criterion was structurally unpassable (observed: four `exit=null 30004ms` runs).

**Fix:** `CHECK_SCRIPT_TIME_LIMIT_MS = 600_000` in `src/engine/assembly.ts`,
applied only to the check context. The model-facing `run_script` tool keeps its
30s default.

### 3. `code-shape` was undeclared, so a constraint-mandated call was refused

Commission constraints say "use `npm run code-shape` as review evidence", but
the default declared-scripts trio (test/typecheck/lint) in
`examples/run-commission.ts` and `examples/live-self.ts` omitted it — every
such `run_script` call was an instant refusal (`exit=null 0ms`).

**Fix:** `'code-shape': 'npm-script:code-shape'` added to both defaults.

### 4. The runner crashed writing repo-relative artifact paths

`safeResolve` in `examples/run-commission.ts` resolved `file.path` against the
**cwd**, not `OUT_DIR`, so any repo-relative artifact path (e.g.
`docs/log.md`) "resolved outside" the out dir and threw — killing the
post-run goal tree / stats / blockers summary after the paid run completed.

**Fix:** paths resolve *under* `OUT_DIR` (mirroring the repo-relative layout as
a record; real delivery stays the worktree/PR path), genuine escapes are
skipped with a warning, and the summary always prints.

## Recorded, not fixed here (issues)

- [worktree-work-invisible-to-artifact-judges](../../issues/worktree-work-invisible-to-artifact-judges.md)
  (new, high): the merged artifact and `judge-acceptance` under-credit files that
  exist in the worktree — the judge half of stall 1.
- [provider-timeout-isomorphic-block](../../issues/provider-timeout-isomorphic-block.md)
  (new, medium): the `ac` goal's LLM request timed out, retried, and the
  identical `step-loop:failed` signature was escalated as an isomorphic failure
  to a block.
- [comprehension-region-wallclock-exhaustion](../../issues/comprehension-region-wallclock-exhaustion.md)
  (updated): fresh evidence — the first characterize child starved on its
  subdivided wallClockMs and cascade-blocked `c2`–`c7`; the replanned implement
  goal starved too. The commission's 15-min budget was authored for a "focused
  slice" and is too small once subdivided.

## Validation

`npm run typecheck`, `npm run lint`, and the full test suite green after the
fixes; the two touched test files carry the new regression coverage.
