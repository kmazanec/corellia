# Status — Corellia

**Updated:** 2026-06-22 · **Roadmap:** [ROADMAP.md](./ROADMAP.md)

## Now

**AC-3 PROVEN — the strange loop is closed.** On 2026-06-24 corellia built a
feature on its OWN repo end-to-end and opened a real pull request, autonomously:
comprehend → implement test-first → verify green → `open-pr` ship step → **PR
[#6](https://github.com/kmazanec/corellia/pull/6)**. Zero blockers; worktree
collected; primary `main` undisturbed. $0.39. This was the named blocker on
AC-3/AC-4 since iteration 06; **AC-4 (deliver-to-foreign) is now unblocked.**

Getting AC-3 there took 6 live `live:self` runs (~$6 total), each buying one real
engine/harness fix — soft budgets, transport timeout, decide-skill injection,
head_sha tool, sandbox-path truth, block-without-effort coercion,
conventions-pointer, the correct prescribed model (z-ai/glm-5.2 vs a silent
claude-sonnet-4 fallback), declared verification scripts, path-like fence parsing,
targeted test execution, and the `open-pr` ship step. Full run-by-run record in
[prototype-build-notes.md](./prototype-build-notes.md). Next iteration: multi-tree
PARALLEL build + cherry-pick aggregation (today the engine uses one shared
worktree per tree).

---

Iteration 09 (Comprehension scoping — ADR-029 Decisions 2+4) **PROVEN LIVE — AC-2
PASSED.** On 2026-06-23 a scoped intent converged END-TO-END on a real foreign
repo (cats): all 4 scoped comprehension goals passed (3 artifacts written) and
the `implement` leaf delivered the change — `AC-2 CHECKPOINT: PASSED`, $0.59.
This unblocked AC-3/AC-4 (deliver-to-self / deliver-to-foreign).

Getting there took 8 live runs this session, each buying one real fix (full
run-by-run record in [prototype-build-notes.md](./prototype-build-notes.md)):
- **Iteration 09 scoping** (ADR-029 Dec 2+4): relevance-bounded coverage table —
  greenfield root splits pull no whole-repo maps; region dives only for EXISTING
  regions (injectable `regionExists`); child-scope union existence-filtered.
  Comprehension dropped from ~16 speculative goals to 3–4 scoped ones.
- **ADR-030 (soft budgets until proven):** the fan-out cap is removed and
  `subdivide` INHERITS attempts/tokens/toolCalls instead of flooring them at
  depth (each was discovered starving deep comprehension on a successive run);
  only wall-clock subdivides; dollar ceiling + wall-clock are the only hard
  backstops. Generalizes the prior `toolCalls` warn-only carve-out.
- **Transport timeout:** a per-request AbortSignal so a hung LLM call aborts and
  retries instead of wedging the run forever.
- **Decide-path skill injection:** the brain now decides satisfy-vs-split WITH
  the family skill (it was deciding blind → comprehension over-split).
- **`head_sha` tool:** comprehension can read the HEAD SHA without thrashing
  against the worktree `.git` indirection.
- **comprehend.md hardening:** never block to ask a human for files it can read;
  hard 6–8 read ceiling then emit (fixed block-without-trying + over-explore).
- **Native tracing:** `live:foreign-eyes` persists the event log
  (`CORELLIA_EVENTS_PATH`) and `scripts/trace.ts` replays it — this is how the
  load-bearing failures were root-caused.

**1409 tests green, lint clean.** Next: `live:self` (AC-3 — the factory delivers
to its own repo and opens a real PR), now approved by the AC-2 pass.

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
| 09 | Comprehension scoping | **Shipped — AC-2 PROVEN LIVE** | — | ADR-029 Dec 2+4 (relevance-bounded coverage) + ADR-030 (soft budgets) + transport timeout + decide-skill injection + head_sha tool + comprehend hardening + native tracing; scoped intent converged end-to-end on cats ($0.59); 1409 tests green; unblocks AC-3/AC-4 |

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
