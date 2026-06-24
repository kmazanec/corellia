# ADR-031: A composite goal iterates to an MVP — the milestone loop lives at the deliver-intent root

**Status:** Accepted · **Date:** 2026-06-24 · **Stretch:** no · **Contract:** yes
**Supersedes:** none · **Superseded by:** none · **Amends:** none
**Companion:** ADR-032 (the done-condition and per-round verify-on-read)

## Context

A `deliver-intent` goal (`src/library/types/deliver.ts:7`, GOAL-TYPES.md:142) is
the only `make` root that accepts free-text intent. It is the MVP-scale composite:
"build me a working W-2 parser + filler + orchestrator." Today it is **strictly
single-pass.** The engine path is receive → decide → dispatch
(`engine.ts:946`) → for a split, `runSplit` (`engine.ts:3016-3332`): subdivide
budget, build a child promise-map, `Promise.all`, INTEGRATE (merge child
artifacts, run `judge-integration` once), emit, return. There is **no
assess → re-decide → another-round step anywhere.** The only "re-decide" in the
engine is inside the split-eval validation loop (`engine.ts:762-940`), which
loops only until a *structurally valid* split is produced and then runs that
split exactly once. Integration is single-pass over execution.

This is the named cause of the factory's sharpest failure mode. tiutni **Run 1**
(`docs/gaps-from-tiutni.md:21`): the factory delivered **3 green modules** (engine,
W-2 parser, guardrails — 111 tests green) and then `deliver-intent` **BLOCKED on
the integration eval.** A failing integration verdict is a **terminal** blocker
(`engine.ts:3260-3265`) — it pushes `integrationBlockers` and emits; it is not a
loop signal. The operator had to merge the good modules by hand, hand-build the
two failed modules, and fix the integration bugs the judge flagged. An MVP is
rarely right in one pass; the factory cannot currently take a second pass at a
composite goal informed by what the first pass actually built.

`investigate` (GOAL-TYPES.md:156) is already `leafOnly:false` for an
"append-one-more-sub-goal-until-satisfied" chain, and DESIGN.md:119-134 claims
this discovery/build loop is **emergent** from the dependency graph. But no engine
code implements an append-until-satisfied loop over *rounds* (grep confirms none).
The composite-build loop this ADR adds is the first formalization of that
long-claimed-but-unbuilt chain, at the one altitude that holds the whole intent.

ADR-029 is the in-repo precedent for making a family recurse legitimately: it
flipped `leafOnly:false` on the comprehend family so a goal too large for one node
SPLITS, and it passed every constitution lint. ADR-030 is the precedent for *how*
a loop's bound is shaped: `subdivide` (`budget.ts:22`) passes `attempts`/`tokens`/
`toolCalls` to every child **verbatim** (dividing them floored deep nodes toward
nothing), so the only divisible dimension is `wallClockMs` and the **real** spend
bound is the per-tree dollar ceiling (`TreeState`, `engine.ts:164`, default $15).
Any round-count bound must therefore be a **dedicated** field, never the inherited
`attempts` dimension.

## Options considered

- **A 4th `Decision` kind (`iterate`).** Rejected. The `Decision` union
  (`decision.ts:91-97`) is a frozen, human-locked contract; a `make`-root that
  loops is *behavior of a goal-type*, not a new fundamental outcome of the
  one-place-a-harness-reasons decide step. Adding a kind ripples through every
  brain, every dispatch, every replay. The loop is reachable as a wrapper around
  the existing `split` arm without touching the union.

- **Loop only at the slice (feature) altitude — each feature-slice iterates,
  the root stays single-pass.** Rejected as the *primary* mechanism. Pure
  slice-looping gives the **cross-module integration seam no owner.** Each slice
  can loop itself green while the *assembly* fails — which is exactly what
  blocked tiutni Run 1: 3 green modules, terminal integration block. Only a node
  that holds the **whole** intent can re-decide against whole-product acceptance
  criteria, and `deliver-intent` is the sole type holding free-text intent (a
  human-locked invariant, GOAL-TYPES.md:220-235). So the loop must live at the
  root. (Slice-looping returns below as a *capped, deferred* composition, not the
  primary mechanism.)

- **Loop at the root via a new `iterative` goal-type trait routing the split arm
  through a `runMilestone` wrapper.** Chosen. The root re-decides against a frozen
  whole-product done-condition each round; the loop owns the integration seam by
  construction. This is the ADR-029 move (a trait that flips the type's behavior)
  applied to the deliver root, with the loop body reusing `runSplit`'s existing
  integrate machinery verbatim.

## Decision

**1. `iterative` is a goal-type trait, not a `Decision` kind.** Add one optional
field to `GoalTypeDef` (`goal-type.ts`, after `scan?`):

```ts
iterative?: { maxRounds: number; acceptanceJudge: string };
```

When a type carries `iterative`, the **split dispatch arm** (`engine.ts:950`)
routes through a new `runMilestone` instead of `runSplit`. The `Decision` union
stays frozen (`decision.ts:91-97`). A non-iterative split is byte-identical to
today.

**2. The loop lives on `deliver-intent`.** Set
`iterative: { maxRounds: 50, acceptanceJudge: 'judge-acceptance' }` on
`deliver-intent` (`deliver.ts:7`) — `maxRounds` is a runaway-backstop, not a
budget proxy, and is **overridable per-commission** (`goal.maxRounds`). Everything else about the type is unchanged:
`kind:'make'`, `family:'deliver'`, `leafOnly:false`, `judgeType:'judge-integration'`,
and **grants unchanged** — `['retrieval.api','classify_risk','spawn']`, no code
tools, no `/merge|approve|deploy|spend/` grant. The root still cannot satisfy
directly and still cannot self-deploy. The loop lives here because only this type
holds the whole-product intent and thus owns the integration seam that terminally
blocked tiutni Run 1.

**3. One round = one `runSplit`-shaped pass, made re-enterable.** `runSplit`'s
body (`engine.ts:3024-3328`, everything between subdivide and the final emit at
3330) is extracted into a non-emitting `runRound` that returns
`{ report, mergedArtifact, passingCount }`. `runSplit` becomes
`runRound(...) + the existing emit tail` — so every non-iterative split stays
byte-identical. `runMilestone` calls `runRound` once per round, threading what
round N-1 built into round N's decide (the mechanism is ADR-032's per-round commit
+ `diffBodiesWithinScope`). The decide → split → integrate → **assess** →
re-decide loop is this real loop wrapped around the existing single-pass body.
`brain.decide`, `brain.judge`, `subdivide`, `persistLeafKnowledge`, the comprehend
structured merge, and `checkCeiling` are all reused verbatim.

**4. The ship gate is deterministic-criteria-AND-judge — the judge is a TRUE
GATE, not advisory.** A round is DONE only when **all** deterministic,
script-backed acceptance criteria pass **AND** `judge-acceptance` returns `pass`.
(The criteria mechanism — a frozen, SHA-anchored, deterministic-floored checklist
re-run each round — is ADR-032.) `judge-acceptance` is a `kind:'judge'` type
(hence `leafOnly:true`, so a judge never recurses) whose verdict gates the round.
This is a deliberate departure from a pure-deterministic ship gate: the deterministic
checklist alone cannot catch "the criteria are all green but the assembly is shoddy,"
so the judge stays in the gate. **The judge has NO leash:** it gates **every**
round up to `maxRounds`/the ceiling. There is no grace round for the judge — a
picky judge can legitimately spend the whole $15 budget refusing to pass. (See the
termination tradeoff in Consequences — this is accepted with eyes open.)

**5. The four-guard halt, first-to-fire-wins, the report names which fired.**
After each round's integrate, `runMilestone` runs the criteria checks against the
round's worktree (computing `passingCount`), runs `judge-acceptance`, then:

1. **DONE** — every deterministic criterion passes **AND** `judge-acceptance.pass`
   → break, run `judge-integration` **once** on the cumulative artifact
   (`engine.ts:3229`, unchanged), emit one report.
2. **PROGRESS-HALT** — the **deterministic** `passingCount` failed to **strictly
   increase** for a **second consecutive round.** One flat round is *tolerated*
   (a setup-heavy or refactor round may legitimately not move the count); a
   **second** consecutive non-increase halts with partial. This is the one
   remaining near-deterministic guard and is computed purely from script results,
   not from the judge.
3. **ROUNDS-HALT** — `effectiveMaxRounds` (`goal.maxRounds ?? 50`) reached →
   partial. A runaway-backstop only; on real work CEILING or NO-PROGRESS fires
   first.
4. **CEILING-HALT** — `checkCeiling` trips (`engine.ts:3369`) → partial.

`checkCeiling` is evaluated at the **top of every round** *and* inside every
spawned child (the existing early gate at `engine.ts:576`), so worst-case
aggregate spend across all rounds is genuinely bounded by the shared $15 counter.
A halt that is not DONE emits the **cumulative green artifact** with the unmet
criteria listed as blockers — never an empty worktree (gap A5, honest partial
delivery).

**6. Hybrid slice-nesting — built in v1, depth-capped at 1, turned on LAST.**
A round's split MAY spawn child goals that are themselves `iterative:true`
feature-slices, each looping locally against a subset of the frozen criteria,
while the **root retains the cross-cutting / integration criteria** and re-judges
the whole assembly each round. This is the same `runMilestone` primitive applied
recursively (honoring DESIGN.md:92-93 — one operation, recursively). Two hard
bounds:

- **Depth is hard-capped at 1.** Root + exactly one slice layer. A slice child may
  NOT itself spawn `iterative:true` children. `runMilestone` carries a depth
  counter; a `runMilestone` invoked at depth ≥ 1 spawns only non-iterative
  children. (This is enforced in the engine, not merely by convention.)
- **The shared $15 `TreeState` ceiling is the bound depth cannot multiply past.**
  It is one counter passed by reference (`engine.ts:164`); nesting does not create
  a second budget. `checkCeiling` fires at the top of every round **and** every
  nested child, so a root × slice round product cannot exceed $15 in aggregate.

Slice-nesting lands as a **distinct late step in the build sequence, AFTER a
proven flat root-loop** (ADR-032's spec build sequence; not interleaved). The
primitive is shaped from day one so it composes, but the flat loop ships and is
proven via `live:self` before nesting is turned on.

**7. Deploy stays deferred (gap B3).** "Delivery" for this iteration =
**an open, green PR a human merges.** The existing `open-pr` leaf
(`deliver.ts:24`) remains the ship step; the constitution still forbids any
`/merge|approve|deploy|spend/` grant (`constitution.ts:87`). The loop produces a
mergeable PR; a human merges/deploys.

## Tradeoffs & risks

- **TERMINATION TRADEOFF — stated honestly.** With the judge **in** the ship gate
  (decision 4) and **no judge leash** (decision 4), the run is deliberately
  **budget-bounded, not iteration-bounded**: the **`$15` ceiling is the PRIMARY
  terminator** (`maxRounds` is a runaway-backstop, default 50). The factory's prior
  "termination is a deterministic boolean" guarantee is **weakened**: a round can no
  longer be declared DONE on script results alone — an LLM verdict
  (`judge-acceptance`) is now load-bearing in the continue/stop decision, and an
  LLM verdict is not guaranteed to ever say `pass`. We accept this with eyes open
  because the deterministic checklist alone cannot catch a green-but-shoddy
  assembly. Two things keep worst-case spend bounded and the loop honest:
  (a) the **deterministic no-progress halt** (decision 4, guard 2) on `passingCount`
  remains the one near-deterministic guard and is judge-independent — a loop that
  stops making script-measurable progress halts regardless of what the judge says;
  (b) **`checkCeiling` fires at the top of every round and every nested child**
  so the $15 ceiling is a hard, judge-independent cap on spend. The judge can burn
  the budget being picky; it cannot run forever or unbounded.

- **A picky judge spends the whole budget (accepted, Keith's explicit call).** A
  judge that never passes will drive the loop to the ceiling and emit a partial.
  This is the intended cost of a real quality gate; we do **not** add a grace-round
  leash for the judge specifically. The cure (calibrate `judge-acceptance` on a
  golden set, GOAL-TYPES.md:31) is the normal judge-quality path, not a special-case
  escape in the loop.

- **`maxRounds` is a backstop, not a budget proxy (decision 4).** Keith's explicit
  call: *budget-bounded, not iteration-bounded.* Default 50 — high enough that the
  ceiling or no-progress halt essentially always fires first on real work; it only
  catches a pathological infinite loop. It is **overridable per-commission**
  (`goal.maxRounds`), with the constitution's `>= 1` floor re-checked on the
  effective value at the dispatch guard.

- **One flat progress round is tolerated (decision 5, guard 2).** A round that
  meaningfully refactors toward a fix but lands the same `passingCount` is allowed
  *once*; a second consecutive flat round halts. This avoids killing a legitimate
  setup-heavy round while still refusing to oscillate to budget death.

- **Slice-nesting depth-1 cap is a v1 conservatism, not a law.** Deeper nesting is
  possible in principle (the ceiling bounds it regardless) but is deferred: depth-1
  is the smallest composition that proves the primitive recurses, and it lands only
  after the flat loop is proven.

## Consequences for the build

- `src/contract/goal-type.ts`: add optional `iterative?: { maxRounds; acceptanceJudge }`.
- `src/contract/events.ts`: add `round-started` and `round-assessed` members
  (the only contract touch beyond the field; additive, `events.ts:99`).
- `src/engine/engine.ts`: extract non-emitting `runRound` from `runSplit`; add
  `runMilestone` (the four-guard loop, depth-capped); add the dispatch guard at
  `engine.ts:950` (`if (typeDef.iterative) runMilestone else runSplit`).
  Pattern-record (`engine.ts:981`) runs on the returned report unchanged.
- `src/engine/worktree.ts`: `commitRound` + `diffBodiesWithinScope` (ADR-032).
- `src/library/constitution.ts`: the new iterative-clause lint (see ADR-032 / spec).
- `src/library/types/deliver.ts`: `iterative` on `deliver-intent`;
  `src/library/types/critique.ts`: new `judge-acceptance`;
  `src/library/types/author.ts`: new `author-acceptance-criteria` (ADR-032).
- Untouched: the `Decision` union (`decision.ts`), `subdivide` (`budget.ts`),
  `runAttemptLoop`/`runStepLoop`, the leaf retry/repair/escalate machinery, the
  split-eval re-decide loop, `TreeState`/`checkCeiling`/`debitTreeState`, the
  comprehend structured merge.
- Build sequence proves the flat root-loop via `live:self` BEFORE turning on
  depth-capped slice-nesting (decision 6; full sequence in the spec).
- GOAL-TYPES.md (`deliver-intent` row, the new types) and DESIGN.md:119-134 (the
  emergent-loop claim, now partly formalized at the composite root) updated.
