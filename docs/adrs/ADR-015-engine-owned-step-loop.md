# ADR-015: The engine owns the agentic step loop; the brain is pure per step

**Status:** Accepted · **Date:** 2026-06-10 · **Stretch:** no · **Contract:** yes
**Supersedes:** none · **Superseded by:** none

## Context

Tool-using leaves need a think → call → observe loop. Someone must drive it:
the engine, the brain adapter, or an external framework. The loop's bounds,
observability, and testability are acceptance criteria (PRD AC-7, AC-11,
AC-12, AC-13), not implementation details — whoever runs the loop owns those
properties. Explored at length with the operator before locking.

## Options considered

- **Engine-owned step loop** — chosen.
- Brain-owned loop over a metered broker handle — rejected: termination
  becomes an exception thrown from inside tool calls (and only fires when a
  tool is called); steps between tool calls go dark in the log unless each
  adapter self-reports; the loop is re-implemented per brain; scripted tests
  exercise a different loop than production runs.
- LangGraph / agent-SDK leaf runtime — rejected: a second control substrate
  (checkpoints vs the event log, interrupts vs decision briefs, recursion
  limits vs budgets) to reconcile; a large dependency against ADR-001; the
  recursion stops being uniform at the leaves.

## Decision

For tool-granted goal types, the engine runs the loop; the brain is a pure
function per step:

- The brain receives the transcript-so-far (harness prompt, spec, injected
  memories, prior tool calls/results) and returns either **tool-call
  requests** or a **final artifact**.
- The engine gates every step on the remaining budget (the `while` condition
  — structural termination, ADR-007), routes each requested call through the
  broker (ADR-014), and appends every step and result to the event log.
- The engine injects budget state into each step's context ("N tool calls
  remaining") — mechanical scaffolding for lower-power models.
- The **step protocol mirrors the standard tool-calling wire shape**
  (messages, tool-call requests with ids, tool results), so a provider
  adapter is a thin translation and the byte-identical transcript prefix
  keeps prompt caching effective.

## Rationale

By construction rather than by discipline: no step can run past the hard
backstops (the dollar ceiling and wall-clock, ADR-033); every step is in the
log for any brain; the loop is written once; `ScriptedBrain`
scripts step sequences so the entire broker/loop machinery is deterministically
testable with zero API calls. This also extends the design's existing edge
discipline — memory is spawner-mediated, children report rather than write;
likewise the brain expresses intent, the engine mediates effect.

## Tradeoffs & risks

- The engine grows ~150–200 lines of loop + transcript machinery. Paid once.
- Provider *server-side* agentic features (e.g. built-in code-execution
  loops) don't fit the per-step shape; if ever wanted, one appears as a
  single granted tool inside our loop, not a replacement for it.
- A genuinely novel provider wire feature may require a protocol extension —
  a contract-barrier change, by design.

## Consequences for the build

- `Brain` gains the step capability in the iteration-3 contract barrier
  (exact signature frozen at plan time); `decide`/`judge`/`repair` are
  unchanged.
- `ScriptedBrain` gains scripted step sequences; loop tests cover refusal,
  exhaustion mid-loop, batching, and artifact emission paths.
- `LlmBrain` implements step as translation to OpenAI-compatible
  tool-calling (ADR-005); no adapter ever loops internally.
