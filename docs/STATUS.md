# Status — Corellia

**Updated:** 2026-06-22 · **Roadmap:** [ROADMAP.md](./ROADMAP.md)

## Now

Iteration 08 (Recursion — ADR-029) **landed on main**: `leafOnly` is removed
from the comprehend family and a structured integrate-merge composes child
comprehension artifacts into one gate-passing parent artifact. The recursion
**mechanism is proven working live** — comprehension goals now split and
integrate (a `deep-dive-region` goal passed; a `map-repo` split into a nested
sub-region child). 1109 engine/brain/library tests green.

The session attempted to self-build ADR-029 via `live:self` (the factory
building the factory). It couldn't bootstrap past the very limit it was fixing,
so ADR-029 was hand-implemented on main and then *proven* via live:self. Along
the way the strange loop surfaced **7 real brain/engine robustness defects**
(all fixed on main, all green) that the scripted convergence suite could never
catch — see the iteration-08 sections of
[prototype-build-notes.md](./prototype-build-notes.md).

## Iterations

| # | Iteration | Status | Build batch | Notes |
|---|-----------|--------|-------------|-------|
| 01 | Walking skeleton | Shipped | — | engine, evals, budgets, event log (PR #1) |
| 02 | Substrate + live brain | Shipped | — | Postgres, gates, listener, flywheel, OpenRouter (PR #2) |
| 03 | Hands | Shipped (PR #3) | — | 555 tests; live convergence run green at $0.07 |
| 04 | Eyes | Shipped (PR #4) | — | 826 tests; scripted convergence green; live mapping partial (debt → 05) |
| 05 | Taste | Shipped | — | 1076 tests; 19 types; live best 4/5 at ~$2; four real bugs fixed by live runs |
| 06 | Self-hosting | Shipped | — | 1345 tests; loop closes; AC-2 1/5 (comprehension can't recurse → iter 08) |
| 07 | Conventions | Shipped | — | 1335 tests; F-68/F-69 layered conventions (ADR-028) |
| 08 | Recursion | Landed on main; recursion proven; scoping is next | — | ADR-029 Dec 1+3 built (leafOnly off + structured merge); Dec 2+4 (scoped JIT comprehension) deferred → iteration 09 |

## What's next — iteration 09: comprehension scoping (ADR-029 Decisions 2 + 4)

The recursion **mechanism** works, but the AC-2 proof runs exposed the next real
problem: **comprehension over-fires.** For a TRIVIAL feature (a pure util in a
new empty `src/util/`), the coverage gate speculatively demanded ~16 whole-repo
comprehension goals (architecture/conventions maps, deep-dives of unrelated
engine internals) it did not need — violating DESIGN.md's own JIT rule ("a
region no goal touches is never mapped; no comprehension is ever speculative").
No PR resulted; the run drowned in speculative comprehension.

This is ADR-029 **Decisions 2 + 4**, deliberately scoped OUT of the iteration-08
implementation (only the recursion mechanism, Decisions 1+3, was built):

1. **Scoped, split-gate-pulled comprehension.** Make the coverage gate mint only
   the comprehension the intent actually needs — bound by the regions the goal
   touches — instead of speculative whole-repo maps. (Touch points: the coverage
   gate / `mintComprehension` in `src/engine/assembly.ts` + the gate logic in
   `src/engine/engine.ts` ~2500-2645; the policy in `src/library/coverage.ts`.)
2. **Rewrite `examples/live-foreign-eyes.ts`** to commission a scoped intent
   pulled by the split gate (ADR-029 Decision 4), per DESIGN's JIT rule.

Two smaller decision-maker robustness items the proof runs also surfaced (good
to fold in or fix first — details in build notes):
- `parseDecision` throws on a `split` decision with no `children` array → the
  decide-fallback then blocks. Candidate: tolerate a childless split as
  satisfy/block rather than a hard parse error (`src/brains/llm.ts`).
- A comprehension decide call emitted conversational prose instead of a decision;
  the comprehension decide path may not get the same schema-constraint the
  deliver-intent decide path now has (`src/brains/llm.ts`).

**Re-entry:** read the iteration-08 sections of `prototype-build-notes.md` (the
7 fixes + the recursion-proven-but-over-fires finding) and ADR-029. The proving
harness budget is currently generous (80/5M/600 in `examples/live-self.ts`) to
keep budget arithmetic off the critical path; tune down once scoping lands.
