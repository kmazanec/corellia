# ADR-030: Budgets are soft signals until a real run justifies a hard bound

**Status:** Accepted · **Date:** 2026-06-23 · **Stretch:** no · **Contract:** no
**Supersedes:** none · **Superseded by:** none · **Amends:** ADR-007

## Context

ADR-007 made budgets four-dimensional, subdivided, and **all four hard-gating**:
`children.length ≤ attempts` caps fan-out, `subdivide` floors every dimension to
`max(1, …)`, and exhaustion of any dimension blocks the goal. The rationale was
"attempts bound thrashing, tokens bound spend, tool calls bound the per-edit
loop."

The problem the live runs keep showing: **these bounds block real work on no
real evidence.** We have not yet proven the factory can build anything
end-to-end. Every number in the budget — 5 attempts, 80 tool calls — is
arbitrary, not derived from an observed failure. And they are actively
preventing the one thing we need to observe:

- The eyes-on-cats checkpoint failed 0/5 because `toolCalls: 20` exhausted
  real-repo comprehension before the model could emit (already carved out:
  `enforceToolCallBudget` defaults false — warn-only — 2026-06-12).
- The iteration-09 AC-2 proof run (2026-06-23): comprehension scoping was proven
  (16 → 3 goals), but convergence still failed because `subdivide` floors child
  attempts to 1 at depth, and the `children.length > attempts` fan-out guard then
  rejects any ≥2-child split there. A trivial scoped intent could not converge —
  not because the work was hard, but because an arbitrary cap forbade the
  decomposition.

The `toolCalls` carve-out already established the right posture and the right
rationale: *keep the counter and the `budget-exhausted` signal (so we can SEE
cost and eventually set a real limit), but stop letting exhaustion KILL the run
until a genuine runaway appears in a trace.* This ADR generalizes that posture
to the rest of the budget machinery.

## Decision

**Budgets are tracked and reported, but soft by default. They no longer block or
forbid work. The only hard backstops are the ones tied to a real, external cost:
the per-tree dollar ceiling and wall-clock.**

Concretely:

1. **Fan-out cap removed.** `validateSplit` no longer rejects a split because
   `children.length > attempts`. A node may decompose into as many children as
   the brain proposes; width is no longer keyed to the scarcest, fastest-flooring
   dimension. (The other structural checks — at least one child, unique
   `localId`s, acyclic `dependsOn`, shares — stay; they guard correctness, not
   cost.)

2. **`subdivide` INHERITS `attempts` and `tokens` instead of dividing them by
   share.** Dividing by share floored a node two levels down toward nothing —
   attempts to 1 (forbidding any further split/retry), and tokens to a
   fraction-of-a-fraction (starving deep comprehension before it could emit). Each
   child inherits the parent's attempts and tokens; toolCalls/wallClock still
   subdivide proportionally for cost tracking. The real bound on token spend is the
   dollar ceiling, not an arbitrary count that floors with depth.

   *(tokens inheritance added 2026-06-23 after AC-2 run #3: with attempts/fan-out
   already soft, convergence still failed on `map-repo architecture` and a deep
   `src/utils` dive exhausting their subdivided token share — the same flooring
   pathology, and exactly the "re-arm when a real trace shows a bound blocking
   legitimate work" trigger this ADR names.)*

3. **`toolCalls` stays warn-only** (the existing carve-out, `enforceToolCallBudget`
   defaults false). Unchanged by this ADR; named here because it is the precedent
   this ADR generalizes.

4. **Attempt and token exhaustion remain honest loop terminators — NOT softened
   in this pass.** With `attempts` now inherited (decision 2), a node gets the
   full retry count at any depth, so attempts rarely bites — and a goal that
   genuinely exhausts its retries did NOT converge, so blocking (which routes to
   the listener / improvement loop) is real signal, not an arbitrary kill. These
   are deliberately left as-is. They become candidates for warn-only the first
   time a real trace shows one of them blocking legitimate work — same evidentiary
   bar as everything else here.

5. **Hard backstops kept:** the per-tree **dollar ceiling** (real spend) and
   **wall-clock** (real time / external stalls, and the genuine infinite-loop
   backstop) still block. These are grounded in real cost, not arbitrary counts.

6. **Tracking and reporting are untouched.** Every `budget-exhausted` event, the
   rolling "N remaining" context, the cost summary — all stay. The point is to
   keep learning where a bound would eventually be needed, without paying for that
   learning by killing real builds now.

An operator (or a test) can re-arm any soft bound by opting into enforcement,
exactly as `enforceToolCallBudget` already works.

## Rationale

A bound is only worth enforcing once a real run shows the failure it prevents.
We have the opposite evidence: the bounds are causing the failures. Until the
factory has demonstrably built and delivered real features, the budget machinery
should get out of the way and let us watch what actually happens — then we re-arm
each bound against an observed runaway, with a number derived from the trace
rather than guessed.

This does not abandon ADR-007's four dimensions or its "a fan-out cannot multiply
costs past its root grant" promise in spirit — the dollar ceiling enforces that
promise directly and on the dimension that is actually real (money). It abandons
the *arbitrary count-based* enforcement that was standing in for it.

## Tradeoffs & risks

- **A genuine runaway (infinite re-split, wide fan-out) is now bounded by
  wall-clock, the dollar ceiling, and the per-node attempt count — not by a
  fan-out cap.** Accepted: wall-clock and the dollar ceiling are sufficient to
  stop a real runaway from costing unbounded money or time, and they are grounded
  in real cost. Re-arm a width/count bound the first time a trace shows it is
  needed.
- **`attempts` no longer subdivides, so deep trees can do more total work than a
  strict reading of the root grant.** Accepted on purpose: cost is bounded by the
  real backstops (dollars, wall-clock), not by an arbitrary retry count laddering
  to zero.

## Consequences for the build

- `src/engine/budget.ts`: `subdivide` inherits `attempts` AND `tokens` (no longer
  floors them at depth); toolCalls/wallClock still subdivide for cost tracking.
- `src/engine/engine.ts`: `validateSplit` drops the fan-out cap (and no longer
  takes a budget). Attempt/token exhaustion are deliberately left as honest loop
  terminators (not softened this pass).
- Tests asserting the fan-out cap / the attempts-floor are rewritten to the new
  behavior (wide splits allowed; deep nodes keep their attempts).
- Re-prove iteration-09 AC-2 (`live:foreign-eyes`, then `live:self`) now that the
  arbitrary caps no longer forbid convergence.
