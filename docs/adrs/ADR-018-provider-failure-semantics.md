# ADR-018: Provider failures resolve at three layers — transport retries, re-prompt, then the attempt ladder

**Status:** Accepted · **Date:** 2026-06-10 · **Stretch:** no · **Contract:** no
**Supersedes:** none · **Superseded by:** none

## Context

A live tool loop multiplies provider calls, and with them rate limits, 5xx
errors, timeouts, and malformed outputs. Undefined semantics would leak
infrastructure noise into the attempt ladder — burning attempts (and tiers,
and eventually human escalations) on failures that aren't the model's
judgment failing.

## Options considered

- Three-layer resolution matched to failure class — chosen.
- Everything consumes an attempt — rejected: a 429 storm would escalate a
  perfectly good goal to opus and then to the human.
- Infinite transport retries — rejected: turns an outage into a hang;
  exhaustion must remain an event (DESIGN.md: never a hang).

## Decision

Failures resolve at the layer that owns their cause:

1. **Transport layer (the adapter):** HTTP 429/5xx/timeouts get bounded
   retries with exponential backoff and jitter (small cap, ~3). Retries are
   not attempt-consuming and not token-debited (no usage was returned), but
   wall-clock keeps ticking — the `wallClockMs` dimension is the outage
   bound. Each retry is recorded as an event.
2. **Protocol layer (the adapter):** malformed model output (unparseable
   JSON, unknown tool name, bad tool-call shape) gets **one** corrective
   re-prompt carrying the parse error (the existing two-fetch pattern,
   generalized to steps). Usage is debited (the provider did the work). A
   second consecutive malformation fails the step.
3. **Attempt layer (the engine):** a failed step fails the attempt and
   enters the existing control loop — repair/escalate/block — carrying the
   failure. Terminal errors (401/403, invalid model id) skip retries
   entirely and surface as a blocker-grade failure: no ladder rung fixes a
   revoked key, so the goal blocks with a decision brief.

## Rationale

The attempt ladder prices *judgment* failures; infrastructure failures have
their own cheaper, faster resolutions. Sorting by cause keeps escalation
statistics meaningful (a type's escalation rate stays a quality signal, not
a weather report) and keeps the isomorphic-failure detector pointed at real
loops rather than network flapping.

## Tradeoffs & risks

- Backoff during a sustained outage spends wall-clock budget on waiting;
  trees fail slow-but-bounded rather than fast. Accepted — that's what the
  dimension is for.
- Classifying provider error responses is endpoint-dependent; misclassifying
  a terminal error as retryable costs three wasted retries, the reverse
  blocks early. Conservative default: unknown status codes are terminal.

## Consequences for the build

- Retry/backoff lives in `LlmBrain`'s fetch path; classification is a small
  named table, not inline conditionals.
- Retry and malformation events join the log (no contract change beyond the
  event members landing with ADR-017's usage fields).
- Scripted tests cover: retry-then-succeed, retry-exhausted, single
  malformation recovery, double malformation failing the step, terminal
  error blocking.
