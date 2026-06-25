---
type: spec
title: "Milestone loop: deliver-intent iterates to an MVP"
description: Build-ready spec for giving a composite deliver-intent goal the ability to ITERATE (decide → split → integrate → assess → re-decide) until an MVP-scale done-condition, instead of being single-pass.
tags: [spec, milestone-loop, deliver-intent, adr-031, adr-032, acceptance-criteria, iterative, runMilestone, slice-nesting]
timestamp: 2026-06-24
status: approved
---

# Milestone loop: deliver-intent iterates to an MVP

> **Iteration number TBD.** This is a flat spec; it will be moved into
> `docs/iterations/NN-milestone-loop/` (matching the `06-loop` / `07-conventions`
> layout) at build-planning time, once the next iteration number is confirmed.

**Status: Approved (2026-06-24) — building**
**ADRs:** ADR-031 (milestone loop at the root), ADR-032 (acceptance criteria
done-condition + per-round verify-on-read)
**Goal:** give a composite `deliver-intent` goal the ability to ITERATE
(decide → split → integrate → assess → re-decide) until an MVP-scale
done-condition, instead of being single-pass.

This spec is build-ready: it names exact files, line anchors, contract shapes,
the engine surgery, the constitution clause, the deterministic floor, the
guardrails, and a smallest-first build sequence in which the **flat root-loop is
proven via `live:self` BEFORE depth-capped slice-nesting is turned on.** Keep the
engine surgery **minimal and additive**: reuse `subdivide`, the frozen `Decision`
union, the event log, `persistLeafKnowledge`, and `checkCeiling`.

---

## Keith's five decisions (baked into this spec)

1. **SHIP GATE = scripts AND judge.** A round is DONE only when ALL deterministic
   script-backed criteria pass AND `judge-acceptance` returns `pass`. The judge is
   a **TRUE GATE**, not advisory. (§Done-condition, §runMilestone.)
2. **JUDGE LEASH: NONE.** The judge gates every round up to the ceiling. A picky
   judge may spend the whole $15. No grace-round leash for the judge.
   (§runMilestone guard 1; the no-progress grace round in #4 is on `passingCount`,
   not the judge.)
3. **V1 SCOPE.** Delivery = an open green PR a human merges (deploy stays gap B3).
   Build hybrid slice-nesting in v1, **depth-capped at 1**, landed as a **distinct
   late step AFTER a proven flat root-loop.** Shared $15 `TreeState` ceiling is the
   bound depth cannot multiply past. (§Slice-nesting, §Build sequence step 8.)
4. **ROUND TUNING — budget-bounded, not iteration-bounded.** `maxRounds` is a pure
   **runaway-backstop**, NOT a budget proxy: default **50**, **overridable
   per-commission**. The REAL terminators are the **$15 ceiling** and the
   **no-progress halt**; `maxRounds` only catches a pathological infinite loop.
   No-progress halt allows ONE grace round: halt only if the **deterministic
   `passingCount`** fails to strictly increase for a **SECOND consecutive** round.
   (§runMilestone guards 2 and 3.)
5. **PR HISTORY.** PRESERVE per-round commits (do NOT squash at `collectTree`).
   Per-round commits are REQUIRED to advance HEAD so verify-on-read works across
   rounds. (§worktree changes, §Engine changes.)

**Termination tradeoff (handled honestly, per ADR-031):** with the judge in the
gate and no judge leash, the **`$15` ceiling is the PRIMARY terminator** — the run
is deliberately budget-bounded, not iteration-bounded (`maxRounds` default 50 is a
runaway-backstop, not a budget proxy). The one remaining near-deterministic guard
is the no-progress halt on `passingCount`. `checkCeiling` MUST fire at the top of
every round AND inside every nested child so worst-case spend is genuinely
bounded — this is what makes "let the judge spend the whole budget" safe.

---

## 1. Contract changes (`src/contract/`)

### 1.1 `goal-type.ts` — `iterative` field (additive)

Add one optional field to `GoalTypeDef`, after `scan?` (`goal-type.ts:92`):

```ts
/**
 * When present, this type's SPLIT dispatch arm routes through the milestone
 * loop (runMilestone) instead of the single-pass runSplit (ADR-031). The type
 * re-decides against a frozen acceptance-criteria done-condition each round.
 * MUST be kind:'make'; maxRounds >= 1; acceptanceJudge must name a registered
 * kind:'judge' type. (Constitution-enforced — §3.)
 *
 * `maxRounds` is a runaway-BACKSTOP, not a budget proxy: the type sets a
 * generous default (deliver-intent uses 50) and a commission MAY override it
 * (see below). The real terminators are the $15 ceiling and the no-progress
 * halt.
 */
iterative?: { maxRounds: number; acceptanceJudge: string };
```

**Per-commission override (decision 4).** `maxRounds` is *budget-bounded by
intent* — the ceiling does the real terminating — so a run may raise or lower the
backstop without touching the type def. The override rides the existing
commission/goal path: `commission()` (`listener.ts:238`) accepts an optional
`maxRounds`, stamped onto the root goal; `runMilestone` reads
`goal.maxRounds ?? typeDef.iterative.maxRounds` (the type default, 50). Add an
optional `maxRounds?: number` to the `Goal` shape (`goal.ts`) — additive, ignored
by every non-iterative type. The constitution floor (`>= 1`) is re-checked on the
effective value at the dispatch guard, so an override cannot smuggle in 0.

`maxRounds` is a **dedicated** count, NEVER the inherited `attempts` dimension
(`subdivide` passes `attempts` verbatim, `budget.ts:24`; overloading it would
starve leaf retries — the corrected design point).

### 1.2 `events.ts` — two new `FactoryEvent` members (additive, `events.ts:99`)

```ts
/** A milestone round began: which round, the spend so far, the round's wall-clock slice. */
| { type: 'round-started'; at: number; goalId: string; round: number; spentUsd: number; roundWallClockMs: number }
/**
 * A milestone round was assessed against the frozen criteria. Carries the
 * deterministic passingCount / total, the judge-acceptance verdict, the halt
 * decision, and a diff DIGEST (pointers, not bodies — MemoryView-consistent,
 * memory.ts:15-22). The honest per-round log of the loop.
 */
| { type: 'round-assessed'; at: number; goalId: string; round: number;
    passingCount: number; criteriaTotal: number; judgeVerdict: Verdict;
    outcome: 'done' | 'continue' | 'halt-no-progress' | 'halt-max-rounds' | 'halt-ceiling';
    diffDigest: string[] }
```

(`Verdict` is already imported in `events.ts:11`.) These are the only contract
touches beyond the `iterative` field.

### 1.3 No `Decision` change

The `Decision` union (`decision.ts:91-97`) stays **frozen**. Iteration is goal-type
behavior reachable through the existing `split` arm, NOT a 4th kind.

---

## 2. New goal-types and the deterministic floor (`src/library/`)

### 2.1 `author-acceptance-criteria` (new, `src/library/types/author.ts`)

```ts
{
  name: 'author-acceptance-criteria',
  kind: 'make',
  family: 'author',
  leafOnly: true,
  tier: { default: 'high', ladder: ['high'] },
  deterministic: [criteriaWellFormed],   // §2.3
  judgeType: null,
  grants: ['retrieval.api'],
  outputSchema: ACCEPTANCE_CRITERIA_SCHEMA, // ordered [{id, claim, check}]
}
```

`deliver-intent`'s first mandatory round-0 child; every other child `dependsOn` it
(ADR-032 §1). It reads the deliver-intent free text and emits the SHA-anchored
criteria checklist, persisted via `persistLeafKnowledge` (`engine.ts:1151`).
Add a `## author-acceptance-criteria` section to `src/library/skills/author.md`.

### 2.2 `judge-acceptance` (new, `src/library/types/critique.ts`)

```ts
{
  name: 'judge-acceptance',
  kind: 'judge',          // ⇒ leafOnly:true forced by constitution (constitution.ts:53)
  family: 'critique',
  leafOnly: true,
  tier: { default: 'high', ladder: ['high'] },
  deterministic: [],
  judgeType: null,
  grants: [],             // no writes; no dangerous grant
}
```

Input: cumulative merged artifact + frozen criteria + this round's deterministic
check RESULTS. Output: a gating `Verdict` (`pass` is load-bearing in the ship gate
per decision 1) plus quality findings that become next-round decide hints. Distinct
from `judge-integration` (cohesion); acceptance asks "are the frozen criteria
satisfied to a shippable bar." Add a `## judge-acceptance` section to
`src/library/skills/critique.md`.

### 2.3 `criteriaWellFormed` (new deterministic check, `src/library/checks.ts`)

A `DeterministicCheck` (shape: `goal-type.ts:30-41`) that parses the criteria
artifact and **fails** it if any criterion's `check` is not a runnable predicate —
i.e. rejects a criterion whose only "check" is a judge rubric line. Every criterion
MUST name a script command (the `runScriptCheck` shape, `checks.ts:124`) or a
file/anchor assertion (the `fileContains` shape, `checks.ts:96`). This is the
deterministic floor under the ship gate (ADR-032 §2).

```ts
export function criteriaWellFormed(): DeterministicCheck {
  return {
    name: 'criteria-well-formed',
    async run(_goal, artifact) {
      if (artifact === null || artifact.kind !== 'text') {
        return { ok: false, detail: 'criteria artifact missing or not structured' };
      }
      // parse the [{id, claim, check}] checklist
      // FAIL if empty, if any id is duplicated/blank, or if any `check` is not one
      // of the runnable predicate kinds {script: <name>} | {file: <path>, anchor?}
      // — a prose-only "rubric line" criterion is rejected here.
      // PASS only when every criterion names a sandbox-runnable predicate.
    },
  };
}
```

### 2.4 `deliver-intent` — turn the loop on (`src/library/types/deliver.ts:7`)

Add exactly one field; everything else unchanged:

```ts
iterative: { maxRounds: 50, acceptanceJudge: 'judge-acceptance' }, // backstop; overridable per-commission
```

`kind:'make'`, `family:'deliver'`, `leafOnly:false`,
`judgeType:'judge-integration'`, `grants:['retrieval.api','classify_risk','spawn']`
all unchanged — no code tools, no `/merge|approve|deploy|spend/` grant. Update the
`## deliver-intent` section in `src/library/skills/deliver.md` to teach the loop:
mint criteria first, slices `dependsOn` it, partial delivery is the honest non-done
outcome.

---

## 3. Constitution clause (`src/library/constitution.ts`)

Add one clause inside the `for (const def of defs)` loop (after the dangerous-grant
check, ~`constitution.ts:94`):

```ts
// iterative-trait invariants (ADR-031): an iterating type must be a make type,
// must declare a positive round bound, and must route its per-round assessment
// through a registered judge. Forbids a judge/learn/evolve kind from iterating
// (no recursing judge) and forbids an unbounded loop (maxRounds floor).
if (def.iterative !== undefined) {
  if (def.kind !== 'make') {
    violations.push(`Type "${def.name}" is iterative but kind is "${def.kind}" (must be "make")`);
  }
  if (!Number.isInteger(def.iterative.maxRounds) || def.iterative.maxRounds < 1) {
    violations.push(`Type "${def.name}" iterative.maxRounds must be an integer >= 1`);
  }
  const judge = byName.get(def.iterative.acceptanceJudge);
  if (judge === undefined) {
    violations.push(`Type "${def.name}" iterative.acceptanceJudge "${def.iterative.acceptanceJudge}" is not registered`);
  } else if (judge.kind !== 'judge') {
    violations.push(`Type "${def.name}" iterative.acceptanceJudge "${def.iterative.acceptanceJudge}" has kind "${judge.kind}" (must be "judge")`);
  }
}
```

The deterministic floor on criteria (every criterion names a runnable, non-judge
check) is enforced by `criteriaWellFormed` at runtime (§2.3), not by the lint.

This passes the existing lints unchanged: `deliver-intent` keeps a non-dangerous
grant set; `judge-acceptance` is `kind:'judge'` ⇒ `leafOnly:true` with `grants:[]`;
`author-acceptance-criteria` is `kind:'make'`, `leafOnly:true`,
`grants:['retrieval.api']`; both new judges-of-record (`judge-integration`,
`judge-acceptance`) are registered `kind:'judge'` types named by `deliver-intent`'s
`judgeType` / `iterative.acceptanceJudge`; `memory.write` stays curate-only.

---

## 4. Engine changes (`src/engine/engine.ts`) — minimal, additive

### 4.1 Extract `runRound` from `runSplit` (refactor, behavior-preserving)

`runSplit` (`engine.ts:3016-3332`) is split into:

- `private async runRound(goal, children, treeState, roundIndex, priorProgress): Promise<{ report: Report; mergedArtifact: Artifact | null; passingCount: number }>`
  — everything `runSplit` does between subdivide (`engine.ts:3024`) and the final
  emit (`engine.ts:3330`), but it does **NOT** emit the `emitted` event and does
  **NOT** promote-as-final. The comprehend structured merge (`engine.ts:3159-3216`),
  the `judge-integration` integrate gate (`engine.ts:3229-3266`), the lesson/memory
  promotion (`engine.ts:3268-3306`) — all reused verbatim inside `runRound`.
  `passingCount` is computed by running the frozen criteria checks against the
  round's worktree (see §4.3); for a non-iterative caller it is `0` and ignored.
- `runSplit` becomes: `const { report } = await this.runRound(...); await this.store.append({ type:'emitted', ... }); return report;`

**Guarantee:** every existing split path stays byte-identical (the safety net for
all later steps). This is build-sequence step 2 and ships with no behavior change.

### 4.2 New `runMilestone` (the loop)

```
private async runMilestone(goal, children, treeState, depth = 0): Promise<Report>
```

Reached from the split dispatch arm (§4.4). The loop:

- **ROUND 0.** Ensure `author-acceptance-criteria` is the first child and every
  other child `dependsOn` it (validate; block via `DecisionBrief` if it cannot be
  authored — fail safe before looping). `checkCeiling` at top. Emit `round-started`.
  Call `runRound`. Persist the criteria `KnowledgeArtifact` (`persistLeafKnowledge`).
  `commitRound` (§5) — HEAD advances. Run criteria checks → `passingCount`. Run
  `judge-acceptance`. Apply guards. Emit `round-assessed`.
- **ROUND N (while guards allow).**
  (a) `checkCeiling` at top → CEILING-HALT if tripped (the per-round top gate the
      tradeoff requires). Emit `round-started`.
  (b) DECIDE: round N>0 re-decides via `brain.decide` with a `BrainContext`
      carrying the unmet-criteria findings + `judge-acceptance` quality findings +
      round N-1's `diffBodiesWithinScope` digest (quoted DATA, weighed not obeyed).
  (c) `runRound` (build child promise-map → `Promise.all` → integrate, all reused).
  (d) `commitRound` advancing HEAD.
  (e) Run criteria checks → `passingCount`; run `judge-acceptance`; emit
      `round-assessed`.
  (f) Apply the four guards (§4.3).
- **After break:** run `judge-integration` once on the cumulative artifact
  (`engine.ts:3229`, unchanged — it already runs inside `runRound`'s integrate, so
  this is the last round's integrate verdict; do NOT double-run). Emit ONE final
  `emitted` report. A non-DONE halt emits the cumulative green artifact with unmet
  criteria as blockers (gap A5).

Reused verbatim: `brain.decide`/`brain.judge`, `subdivide`, `persistLeafKnowledge`,
`checkCeiling`/`debitTreeState`/`ceilingReport`, the comprehend merge, the
lesson/memory promotion edge.

### 4.3 The four-guard halt (first-to-fire-wins; the report names which)

Computed after each round's assess. `passingCount` is the count of frozen criteria
whose deterministic check is green this round; `criteriaTotal` is the criteria
count; `flatRounds` counts consecutive rounds where `passingCount` did not strictly
increase.

```
1. DONE          : passingCount === criteriaTotal AND judgeAcceptance.pass
                   → break, emit success.   (decision 1 — scripts AND judge)
2. NO-PROGRESS   : passingCount did NOT strictly increase vs prior round
                   → flatRounds++ ; halt with partial only if flatRounds >= 2.
                   (decision 4 — ONE grace round tolerated, then halt. Judge-
                   independent: this is the one near-deterministic guard.)
                   On a strict increase: reset flatRounds = 0.
3. MAX-ROUNDS    : roundIndex + 1 >= effectiveMaxRounds → halt with partial.
                   effectiveMaxRounds = goal.maxRounds ?? typeDef.iterative.maxRounds
                   (default 50, per-commission overridable; decision 4). This is a
                   RUNAWAY-BACKSTOP — on real work guard 2 or 4 fires first.
4. CEILING       : checkCeiling(goal, treeState) → halt with partial. THE PRIMARY
                   terminator (decision 4 — budget-bounded, not iteration-bounded).
                   Gated at the TOP of each round and inside each child via the
                   existing engine.ts:576 early gate — the bound spend cannot exceed.
```

There is **no judge guard** — the judge cannot force *another* round and gets no
grace round (decision 2). The judge only blocks DONE (guard 1) and contributes
next-round findings. The continue condition is: not DONE, strict progress this
round OR first flat round, rounds remain, ceiling not tripped.

### 4.4 Dispatch guard (`engine.ts:950`, the `split` arm)

```ts
case 'split': {
  // ... existing coverage gate (engine.ts:957) unchanged ...
  const typeDef = this.registry.get(goal.type);
  const splitReport = typeDef.iterative
    ? await this.runMilestone(goal, childrenToSplit, treeState)
    : await this.runSplit(goal, childrenToSplit, terracedLoserFindings, treeState);
  // ... existing pattern-record (engine.ts:981) on splitReport unchanged ...
  return splitReport;
}
```

Pattern-record runs on the returned report unchanged.

### 4.5 Depth cap for slice-nesting (decision 3) — engine-enforced

`runMilestone` carries `depth`. When `runRound` (inside `runMilestone`) builds
child goals, a child whose type carries `iterative` is permitted only when
`depth < 1`; at `depth >= 1` such a child is spawned as a **non-iterative** split
(or blocked, see step 8). A nested slice is invoked as `runMilestone(..., depth+1)`.
The shared `treeState` (one counter by reference) is the bound depth cannot
multiply past; `checkCeiling` at the top of each nested round and each child
enforces it. **Turned on only at build-sequence step 8.**

---

## 5. Worktree changes (`src/engine/worktree.ts`)

### 5.1 `commitRound(worktree, roundIndex)` (new)

Reuses `collectTree`'s git ops (`worktree.ts:292-318`): `git add --all`, check
`status --porcelain`, commit if dirty with message `feat(round N): <goal title>`,
return the SHA — but does **NOT** remove the worktree. Advances HEAD per round so
ADR-019 verify-on-read is real (ADR-032 §4). Per-round commits are **PRESERVED**
(decision 5): `collectTree` at tree-end does not squash them; its own commit now
fires only for residual uncommitted changes after the last round commit.

### 5.2 `diffBodiesWithinScope(worktreeRoot, scope, sinceRef)` (new)

Sibling of `diffWithinScope` (`worktree.ts:206`): same `git diff --name-only` +
`ls-files` machinery, restricted to `sinceRef..HEAD`, returning capped/truncated
**file bodies** for in-scope changed paths (reuse the `isInScope` predicate and the
`DEP_LINKS` drop at `worktree.ts:232`). Feeds round N's decide context (ADR-032 §6).
Unit-tested in isolation (build-sequence step 4) before the loop depends on it.

---

## 6. Slice-nesting (decision 3) — shaped now, turned on LAST

A round's split MAY spawn `iterative:true` feature-slice children, each looping
against a subset of the frozen criteria; the **root retains the cross-cutting /
integration criteria** and re-judges the whole assembly each round. Same
`runMilestone` primitive, recursive (DESIGN.md:92-93). Hard bounds:

- **Depth-capped at 1** (§4.5, engine-enforced): root + one slice layer; a slice
  may not spawn `iterative` children.
- **Shared $15 `TreeState` ceiling** is the bound depth cannot multiply past;
  `checkCeiling` at the top of each round and each nested child.

Lands as **build-sequence step 8**, a distinct late step AFTER the flat root-loop
is proven via `live:self` (step 7). Not interleaved.

---

## 7. Guardrails (consolidated)

- Four-guard halt, first-to-fire-wins, `round-assessed.outcome` names which (§4.3).
- `maxRounds` is a DEDICATED field, never the inherited `attempts` (`budget.ts:24`);
  lint enforces `maxRounds >= 1` (§3).
- Deterministic FLOOR: `criteriaWellFormed` rejects judge-rubric-line criteria
  (§2.3); the no-progress guard is computed on `passingCount` (script results),
  judge-independent.
- Ship gate is scripts AND judge (decision 1); the judge has no leash and no grace
  round (decision 2); the no-progress grace round is on `passingCount` only.
- Frozen + SHA-anchored criteria re-validated via verify-on-read each round; the
  target cannot drift; `commitRound` makes the anchor real (decision 5, ADR-032).
- Regression caught: each round re-runs ALL criteria, so a round that flips a
  green criterion back to red drops `passingCount` and trips the no-progress guard
  rather than oscillating.
- `checkCeiling` at the TOP of every round AND inside every child (existing
  `engine.ts:576` gate) — the open-ended-rounds AND nesting-depth backstop alike
  (the termination tradeoff's hard bound).
- Criteria un-authorable → block via `DecisionBrief` at round 0 (fail safe before
  looping).
- Partial delivery is the honest non-done outcome (gap A5): emit the cumulative
  green artifact with unmet criteria as blockers, never an empty worktree.
- Deploy not self-granted (gap B3): the loop produces a green PR; a human merges.

---

## 8. Build sequence (smallest-first; flat loop proven BEFORE nesting)

1. **Contract + lint scaffolding (no behavior).** Add `iterative?` to `GoalTypeDef`
   (§1.1); add `round-started`/`round-assessed` to `FactoryEvent` (§1.2); add the
   iterative-clause lint (§3). Ship: lint passes, types compile, no engine path
   changed.
2. **Refactor-only, behavior-preserving.** Extract `runRound` from `runSplit`;
   `runSplit = runRound + emit tail` (§4.1). Ship: every existing split test passes
   byte-identically (the safety net for all later steps).
3. **The done-condition artifact.** Add `author-acceptance-criteria` (§2.1) +
   `criteriaWellFormed` (§2.3) + `judge-acceptance` (§2.2) + skill sections. Ship: a
   `deliver-intent` split can spawn and gate a criteria artifact, persisted as a
   verify-on-read `KnowledgeArtifact`, with NO loop yet (criteria emitted, ignored).
4. **Real cross-round read.** Add `commitRound` + `diffBodiesWithinScope` (§5) with
   unit tests proving HEAD advances per round and in-scope bodies are returned.
   Ship: the mechanism exists and is tested in isolation before the loop needs it.
5. **`runMilestone` single-round (loop OFF).** Wire the dispatch guard (§4.4); run
   exactly one round + criteria check + `judge-acceptance` + final
   `judge-integration` + emit. `maxRounds` enforced but criteria-driven continue
   OFF. Ship: `deliver-intent` with `iterative` set behaves like a single split plus
   a criteria assessment — a safe superset of today.
6. **Turn the loop on.** Enable re-decide with the four-guard halt (§4.3), threading
   `diffBodies` + unmet + judge findings into round N's decide. Ship: a deliberately
   2-round goal converges and emits; a deliberately stuck goal halts partial with
   unmet criteria as blockers.
7. **PROVE THE FLAT ROOT-LOOP VIA `live:self`.** Commission a small composite intent
   through the front door; confirm convergence (a green PR with per-round commits)
   and an honest partial on a deliberately-hard intent. Record the run in the event
   log / `docs/prototype-build-notes.md` (bootstrap discipline). **Gate: do not
   proceed to step 8 until the flat loop is proven.**
8. **Turn on depth-capped slice-nesting (decision 3).** Enable `iterative:true`
   slice children at `depth < 1` (§4.5, §6); confirm the shared $15 ceiling bounds
   the root × slice round product; the root owns the integration criteria. Prove via
   `live:self` on a cleanly-partitionable intent.
9. **Docs.** ADR-031 + ADR-032 are written (done); update GOAL-TYPES.md
   (`deliver-intent` row + the two new types) and DESIGN.md:119-134 (the
   emergent-loop claim, now formalized at the composite root); confirm ADR-019's
   amendment matches the built `commitRound`.

---

## 9. What is explicitly NOT touched

The `Decision` union (`decision.ts`), `subdivide` (`budget.ts`),
`runAttemptLoop`/`runStepLoop` and the leaf retry/repair/escalate machinery, the
split-eval re-decide loop, `TreeState`/`checkCeiling`/`debitTreeState` accounting,
the comprehend structured merge, and the `open-pr` ship leaf — all unchanged.
