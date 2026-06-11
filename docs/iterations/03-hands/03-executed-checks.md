---
id: F-33
title: run_script + checks that execute
iteration: 03-hands
type: implement
intent: production
status: not-started
dependsOn: []
contracts: [ADR-014, ADR-016]
---

# Feature: `run_script` + deterministic checks that execute

**ID:** F-33 · **Iteration:** 03-hands · **Status:** Not started

## What this delivers (before → after)

**Before:** deterministic checks inspect artifact strings; nothing ever
compiles or runs; "tests pass" is a text pattern.
**After:** the `run_script` tool executes a target repo's declared
entry-point scripts (by name, never shell text) as bare processes in the
sandbox, and code-emitting goal-type evals gate on the real exit status; a
repo missing its declared entry points bounces at the capability check
before any tree spend.

## How it fits the roadmap

This is what makes the goal-type eval honest (PRD R10) and the regression
guard real later (iteration 4's full-suite-at-root reuses it). No hard
dependencies.

## Reading brief

`docs/adrs/ADR-016` (scripts-by-name, bare exec, the trust posture) ·
`docs/adrs/ADR-014` (tool shape) · `src/library/checks.ts` (the check
interface being upgraded) · DESIGN.md § "Eval economics" (deterministic
before judge) and § "The root's receive is the intake" (capability check).

## Requirements traced (from the PRD)

R10, R12 · AC-5, AC-8, AC-17 (the gate half — baseline semantics arrive with
iteration 4's comprehension).

## Dependencies (must exist before this starts)

None — builds against the frozen tool shapes.

## Unblocks (what waits on this)

Nothing hard-waits; F-36's live demo and the iteration's convergence check
consume it.

## Contracts touched

Tool shapes (ADR-014) — consumed. The check-definition shape gains an
executing variant — if that requires touching `src/contract/goal-type.ts`,
it belongs in the barrier; flag at plan time.

## Acceptance criteria (product behavior)

1. Given a repo declaring a test entry point, when `run_script("test")` is
   called, then the script runs with the sandbox worktree as cwd and the
   result carries exit status and captured output (truncated to a stated
   cap for transcripts; full output in the event).
2. Given a script name not in the repo's declared set, then the call is
   refused with the reason — model-composed shell text is structurally
   impossible.
3. Given an `implement` leaf whose goal-type eval declares an executing
   check, then a red exit status fails the deterministic gate (the judge is
   never consulted on a red gate) and a green one proceeds to the judge.
4. Given a commission against a repo missing the declared entry points, then
   it bounces at receive with a stated reason and zero subtree spend.
5. Script runs appear as events with command name, exit status, duration,
   and output reference.

## Testing requirements

Fixture mini-repo (tmp dir with declared scripts: one green, one red, one
hanging) covering: green gate, red gate, refusal of undeclared names,
output capture/truncation, wall-clock bound on a hanging script. No live
API usage.

## Manual setup required

None.

## Implementation notes (filled in by the building agent)

> Owned by the builder, not the planner. Starts empty.
