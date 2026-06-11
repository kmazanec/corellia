---
id: F-32
title: Engine-owned step loop
iteration: 03-hands
type: implement
intent: production
status: not-started
dependsOn: []
contracts: [ADR-015, ADR-014, ADR-007]
---

# Feature: Engine-owned step loop

**ID:** F-32 · **Iteration:** 03-hands · **Status:** Not started

## What this delivers (before → after)

**Before:** a leaf's `produce` is one brain call returning text; no goal can
act, observe, and act again.
**After:** a tool-granted leaf runs the engine's step loop — brain called
pure-per-step, returning tool-call requests or a final artifact; the engine
gates every step on remaining budget, routes calls through the broker,
injects "N tool calls remaining" into each step, and logs every step — a
scripted leaf builds a file across multiple steps and halts cleanly at
exhaustion.

## How it fits the roadmap

The heart of "Hands" (ADR-015). Builds against the frozen `Brain.step` and
broker signatures — no hard dependency on F-31's implementation (tests use a
fake broker; integration with the real one happens at convergence).

## Reading brief

`docs/adrs/ADR-015` (the decision and its rationale) · `docs/adrs/ADR-006`
(repair-within-attempt — the loop nests inside an attempt) ·
`src/contract/brain.ts` post-barrier · the attempt loop in
`src/engine/engine.ts` (the insertion point) · DESIGN.md § "The control
loop".

## Requirements traced (from the PRD)

R2, R9 · AC-7 (refusals surfaced into the transcript), AC-13 (every step an
event), and the loop half of AC-8.

## Dependencies (must exist before this starts)

None — can start as soon as the iteration's contracts are frozen.
(Build-scheduling note: touches `src/engine/engine.ts`, which F-34 and F-35
also touch — see the roadmap's overlap note.)

## Unblocks (what waits on this)

Nothing hard-waits; F-36's live demo exercises this loop at convergence.

## Contracts touched

`Brain.step` + step/transcript shapes (source of truth: ADR-015) — consumed,
not defined. Tool shapes (ADR-014) — consumed.

## Acceptance criteria (product behavior)

1. Given a `ScriptedBrain` scripted as [write_file, run-of-two-calls,
   artifact], when an implement leaf runs, then the artifact emits after
   exactly the scripted steps, each step and tool result is in the event
   log, and `toolCalls` reflects every executed call.
2. Given a `toolCalls` budget smaller than the scripted sequence, then the
   loop halts at exhaustion as an event (no further brain calls), and the
   attempt fails into the existing control loop — never a hang.
3. Given a refused tool call mid-loop, then the refusal is appended to the
   transcript and the next step's brain call sees it (refusal is data the
   model can react to).
4. Every step's context includes the remaining tool-call count.
5. Non-tool-granted types are unaffected: their produce path is unchanged
   and no step events appear.

## Testing requirements

Scripted-brain loop tests: multi-step success, exhaustion mid-loop, refusal
recovery, artifact-first (zero tool calls), interaction with
repair-within-attempt (a failed loop attempt escalates carrying the
transcript tail). No live API usage.

## Manual setup required

None.

## Implementation notes (filled in by the building agent)

> Owned by the builder, not the planner. Starts empty.
