---
id: F-37
title: "Assembly: engine wiring + convergence"
iteration: 03-hands
type: implement
intent: production
status: not-started
dependsOn: [F-31, F-32, F-33, F-34, F-35, F-36]
contracts: [ADR-014, ADR-015, ADR-016, ADR-017]
---

# Feature: Assembly — engine wiring + the convergence checks

**ID:** F-37 · **Iteration:** 03-hands · **Status:** Not started
*(Added at approval review, 2026-06-11: the plan review found that every
feature built a well-tested module and no feature owned composing them — the
exact engine↔eval seam failure mode from iteration 1, recurring.)*

## What this delivers (before → after)

**Before:** six green modules — broker, loop, script runner, worktree
lifecycle, accounting, live adapter — that nothing connects; the iteration's
done-when cannot run.
**After:** the engine composes them: a tree against a target repo opens its
worktree, constructs the broker bound to that root with the full tool table
(core tools + `run_script`), feeds executing checks their `CheckContext`,
enforces `diff ⊆ scope` at emission, accounts spend, and collects or
preserves the worktree — proven by a **scripted full-stack convergence
test** (no network) and the **live `npm run live:hands` demo**.

## How it fits the roadmap

The iteration's done-when lives here. This is the one feature with honest
hard dependencies — it consumes the *implemented behavior* of all six
siblings, so it builds last, on the trunk, after F-31/F-33/F-36 are folded
back.

## Reading brief

`BUILD-PLAN-03-hands.md` (frozen contracts + resolved decisions) ·
`docs/adrs/ADR-016` (lifecycle + trust posture) · the tree-root and emission
paths in `src/engine/engine.ts` · F-34's worktree module · F-31's broker
construction signature · F-33's `runScriptTool` / `loggingScriptRunner` /
`runScriptCheck` exports.

## Requirements traced (from the PRD)

AC-6 (emission diff-check, engine path) · AC-8 (executing checks through the
engine) · the engine half of AC-7 · AC-11/AC-12 observed end-to-end ·
PRD risk #1's first live evidence.

## Dependencies (must exist before this starts)

F-31..F-36 — genuine hard deps: this feature wires their implementations,
not their contracts.

## Unblocks (what waits on this)

The iteration's done-when; iteration 4 (comprehension artifacts are consumed
through this assembled tool layer).

## Contracts touched

None introduced — consumes every barrier contract as frozen. The engine
gains an optional sandbox/assembly configuration (target repo root +
declared-scripts map); if its shape wants a `src/contract/` home, that is a
flagged barrier amendment, not a silent addition.

## Build plan (approved)

- [ ] **Engine tree-root wiring** — Delivers: the engine accepts an optional
  assembly config `{repoRoot, declaredScripts}`; when present, the tree root
  opens a worktree (F-34 `openTreeWorktree`), constructs one `ToolBroker` for
  the tree bound to the worktree root with `tools: [...coreTools,
  runScriptTool(loggingScriptRunner(store, runner))]` and the engine-owned
  `onDebit` counter, threads the broker into the step loop (F-32), passes
  `CheckContext {sandboxRoot, runScript}` at both deterministic-check
  invocation sites, calls `diffWithinScope` on the emission path (violation →
  scope-insufficiency report, AC-6), and collects (success) or preserves
  (failure/block) the worktree at tree end. Without the config, behavior is
  byte-identical to today (regression guard). Tests:
  `tests/engine/assembly.test.ts` — wiring-level: config absent → no worktree
  events, existing engine.test.ts green unchanged; config present → broker
  constructed once per tree, ctx reaches checks, emission calls the diff
  check. Touches `src/engine/engine.ts` (last in the serial chain).
- [ ] **Scripted full-stack convergence test** — Delivers: one integration
  test driving the whole path with `ScriptedBrain` against a real tmp git
  fixture repo (declared scripts: a real red-then-green test script):
  scripted implement leaf writes a failing module + test via `write_file`,
  calls `run_script` (red), writes the fix, calls `run_script` (green),
  emits; one deliberately out-of-scope write is refused and visible in the
  transcript; the executing check gates on the real exit status with the
  judge never consulted on red (F-33's engine-half AC); `script-ran`,
  `tool-call`, usage-bearing, and worktree lifecycle events all present;
  `diff ⊆ scope` enforced at emission; synthetic usage totals in the cost
  projection; worktree collected with commits on the tree branch. Runs in CI
  with zero network — this is the iteration's done-when, minus "live".
  Tests: `tests/engine/convergence.test.ts`.
- [ ] **`npm run live:hands`** (moved from F-36) — Delivers:
  `examples/live-hands.ts` + package script, gated behind
  `OPENROUTER_API_KEY`: creates the fixture repo **programmatically in a tmp
  dir** (no manual fixture — gap closed), runs a live sonnet-class implement
  leaf through the assembled engine, prints the run report with real token +
  dollar totals from event usage. PRD risk #1's first live evidence; not part
  of the unit suite.

### Test strategy

The scripted convergence test is the load-bearing artifact — it proves
composition with zero API calls and pins every cross-feature seam the unit
suites deliberately stubbed (FakeBroker, stub ctx, stub runner). The wiring
test guards the config-absent path byte-identically. The live script is the
operator-run done-when, never a CI gate. Run per-chunk files only; one
`npm run typecheck` + full `npm test` at feature end.

### Risks

- The serial chain ends here; any seam mismatch discovered in assembly
  (e.g. a broker construction signature that doesn't fit the engine's
  call shape) is a finding against the barrier, escalated — not silently
  worked around.
- The live demo's model may fail the loop (PRD risk #1). That is evidence,
  not a build failure: capture the transcript, file the blocker report, and
  surface tier policy as the fallback (default implement leaves up a tier).

### Manual setup

`OPENROUTER_API_KEY` in `.env` for the live demo only.

## Implementation notes (filled in by the building agent)

> Owned by the builder, not the planner. Starts empty.
