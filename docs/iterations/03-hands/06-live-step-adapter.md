---
id: F-36
title: Live step adapter + failure semantics
iteration: 03-hands
type: implement
intent: production
status: not-started
dependsOn: []
contracts: [ADR-015, ADR-018, ADR-005]
---

# Feature: Live step adapter + provider-failure semantics

**ID:** F-36 · **Iteration:** 03-hands · **Status:** Not started

## What this delivers (before → after)

**Before:** `LlmBrain` does one-shot completions; a live model cannot drive
tools; transport errors are ad hoc.
**After:** `LlmBrain` implements the step protocol as a thin translation to
OpenAI-compatible tool-calling (no internal looping — ADR-015), with
ADR-018's three-layer failure semantics: bounded transport retries with
backoff, one corrective re-prompt on malformed output, terminal errors
blocking with a brief. A live model can drive a leaf through the loop.

## How it fits the roadmap

The bridge from scripted correctness to live capability — and the carrier of
the iteration's existential risk test (PRD risk #1: can lower-power models
drive the loop?). Its own acceptance is adapter behavior; the full live
end-to-end is the **iteration convergence check**, not this feature's
private bar.

## Reading brief

`docs/adrs/ADR-015` (protocol, no-internal-looping rule) ·
`docs/adrs/ADR-018` (the failure table) · `docs/adrs/ADR-005` ·
`src/brains/llm.ts` + `src/brains/openrouter.ts` (the code being extended).

## Requirements traced (from the PRD)

R2 via the live path · AC-12 (usage arrives through this adapter) · risk #1
(de-risk evidence: a sonnet-class model completes the convergence demo).

## Dependencies (must exist before this starts)

None — translates the frozen step protocol; tests mock the wire. The live
convergence demo consumes F-31..F-35's implemented behavior, which is why it
runs at convergence rather than inside this feature.

## Unblocks (what waits on this)

The iteration convergence check (below).

## Contracts touched

`Brain.step` (ADR-015) — implemented. Retry/malformation events (ADR-018) —
emitted.

## Acceptance criteria (product behavior)

1. Given a wire response with tool calls, then they translate to step
   results with ids preserved; given a content-only response, it parses as
   the artifact path of the step protocol.
2. Given two consecutive 429/5xx responses then a success (mocked), then the
   step succeeds, exactly the retries occurred with backoff, each is an
   event, and no attempt was consumed.
3. Given retries exhausted, then the step fails into the attempt ladder
   carrying the transport error.
4. Given one malformed tool-call payload, then one corrective re-prompt
   (carrying the parse error) is sent and debited; a second consecutive
   malformation fails the step.
5. Given a 401/invalid-model response, then no retries occur and the goal
   blocks with a decision brief naming the terminal cause.
6. The transcript sent each step is prefix-stable (byte-identical history)
   so provider prompt caching can engage.

## Testing requirements

Mocked-fetch wire tests for every ADR-018 row plus translation fidelity and
prefix stability. Live usage only via the convergence demo (below), behind
`OPENROUTER_API_KEY`.

## Iteration convergence check (the iteration's done-when, runs after all features land)

`npm run live:hands`: a live sonnet-class `implement` leaf, in a tree
worktree on a fixture repo, builds a small module test-first — its declared
test script actually runs (red, then green after the model's fix), one
deliberately scope-violating write is refused and visible in the transcript,
and the run report prints real token + dollar totals from event usage.
That single run is AC-7/8/12 observed live, and PRD risk #1's first
evidence.

## Manual setup required

`OPENROUTER_API_KEY` in `.env` for the convergence demo (already present on
the operator's machine).

## Implementation notes (filled in by the building agent)

> Owned by the builder, not the planner. Starts empty.
