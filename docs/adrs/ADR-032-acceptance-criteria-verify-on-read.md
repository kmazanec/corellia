# ADR-032: Acceptance criteria are a verify-on-read, deterministic-floored done-condition; per-round commits make verify-on-read real

**Status:** Accepted · **Date:** 2026-06-24 · **Stretch:** no · **Contract:** yes
**Supersedes:** none · **Superseded by:** none · **Amends:** ADR-019
**Companion:** ADR-031 (the milestone loop this done-condition terminates)

## Context

ADR-031 gives `deliver-intent` a round loop. A loop needs a done-condition. The
naive done-condition — "ask `judge-integration` whether we're done each round" —
collapses the loop's termination into an unbounded LLM verdict: a judge that never
says "done" loops to budget death, and the target it judges against can silently
drift between rounds. The loop needs a **stable, mostly-deterministic** target.

Two facts about the current engine make a real cross-round done-condition harder
than it looks, and **both must be fixed** or the loop is built on sand:

- **`collectTree` commits ONLY at tree-end.** The worktree is committed exactly
  once, in the `finally` of the root run (`engine.ts:558` → `collectTree`,
  `worktree.ts:283-318`). **Within a tree, HEAD never advances.** Round N's built
  files sit uncommitted in the working tree; round N+1 cannot read them as a
  committed diff, and — critically — **ADR-019 verify-on-read is a no-op across
  rounds.** ADR-019's freshness check compares an artifact's `generatedAtSha` to
  current HEAD (`engine.ts:2954`); if HEAD never moves, a round-0 knowledge
  artifact is *always* "fresh" no matter how much later rounds change the code.
  The mechanism that should re-anchor a stale target silently never fires.

- **There is no read path from round N-1's built code into round N's decide.**
  `repoShapeHint` (`engine.ts:675`, ADR-029) returns a file *count* for a
  scope-less `map-repo`, not a diff of what was built. Nothing feeds the bodies of
  round N-1's changed files into round N's `BrainContext`.

So a faithful done-condition is *also* a verify-on-read fix and a per-round-commit
fix. This ADR specifies all three together.

## Decision

**1. The done-condition is a frozen, round-0, deterministic-floored
acceptance-criteria artifact, re-RUN (not re-judged) every round.** A new
`author-acceptance-criteria` leaf type is `deliver-intent`'s **first mandatory
round-0 child**; every other child `dependsOn` it. It reads the deliver-intent
free text and emits an ordered checklist:

```
[{ id: string, claim: string, check: AcceptanceCheck }]
```

where each `check` is a **repo-runnable predicate** — either a named script
command the sandbox executes (the `runScriptCheck` shape, `checks.ts:124`) or a
file/anchor existence assertion verified against the worktree (the `fileContains`
shape, `checks.ts:96`). The checklist is persisted as a SHA-anchored
`KnowledgeArtifact` (`knowledge.ts:62-77`, ADR-019) via `persistLeafKnowledge`
(`engine.ts:1151`). It is the **frozen target**: minted once at round 0, never
re-authored mid-loop, so the target cannot drift under the loop.

**2. `criteriaWellFormed` is a deterministic floor — it REJECTS judge-rubric-line
criteria.** A new deterministic check on `author-acceptance-criteria` parses the
emitted checklist and **fails** the artifact if any criterion's `check` is not a
runnable predicate — i.e. if a criterion's only "check" is a prose rubric line a
judge would have to read ("the code should be clean," "the UX should feel good").
Every criterion MUST name a script command or a file/anchor assertion the sandbox
can execute deterministically. This is the **deterministic floor** under the ship
gate: it guarantees there is always a script-backed, judge-independent boolean for
each criterion, so the no-progress halt (ADR-031 guard 2) and the DONE check
(ADR-031 guard 1) have real ground truth to compute over (the per-instance ground
truth golden-set judges otherwise lack, GOAL-TYPES.md:31). Quality concerns the
scripts cannot express are the judge's job, not a criterion's.

**3. The ship gate is scripts AND judge; the deterministic checklist is the
progress floor.** Per ADR-031 decision 4 (Keith's override of the design panel's
advisory-judge proposal): a round is DONE only when **every** deterministic
criterion passes **AND** `judge-acceptance` returns `pass`. The deterministic
`passingCount` (how many criteria's scripts are green this round) is what the
**no-progress halt** is computed over — it must strictly increase, with one flat
round tolerated then halt (ADR-031 guard 2). So the deterministic checklist is the
*progress floor* even though the judge is also in the *ship gate*: the loop's
near-deterministic guard never depends on the judge, but the loop cannot finish
DONE on scripts alone. `judge-acceptance` (`kind:'judge'` ⇒ `leafOnly:true`,
grants `[]`) reads the cumulative merged artifact + the frozen criteria + this
round's deterministic check RESULTS, and renders a gating `pass/fail` plus quality
findings that become next-round decide hints. It is distinct from
`judge-integration`: integration asks "does the assembly cohere"; acceptance asks
"are the frozen criteria satisfied to a shippable bar." `judge-integration` still
runs **once** at the end on the cumulative artifact (`engine.ts:3229`, unchanged).

**4. Per-round `commitRound` advances HEAD — this makes verify-on-read REAL.**
`runMilestone` commits the worktree at the end of **every** round via a new
`commitRound(worktree, roundIndex)` in `worktree.ts` — `git add --all` + commit
(reusing `collectTree`'s git ops) **without removing the worktree.** Per-round
commits are **REQUIRED** (not an optimization): they are the only thing that
advances HEAD within a tree, and without an advancing HEAD ADR-019 verify-on-read
is the no-op described in Context. With HEAD advancing each round, the round-0
criteria `KnowledgeArtifact` (anchored to the round-0 SHA) is correctly seen as
*potentially drifted* against the new HEAD each round, triggering its cheap
self-validation before reuse — ADR-019 working as designed, round to round.

**5. Per-round commits are PRESERVED as an honest build trail (NOT squashed)**
(Keith's override of the panel's open question). `commitRound` leaves one commit
per round on the tree branch; `collectTree` at tree-end does **not** squash them.
The final PR carries the round-by-round build history as an honest trail of how
the MVP converged. (Commit message shape: `feat(round N): <goal title>` — distinct
from `collectTree`'s `feat(tree): collect worktree <id>`, which now only fires if
there are uncommitted residual changes after the last round commit.)

**6. Round N reads round N-1's built code via a new `diffBodiesWithinScope`.** A
new `diffBodiesWithinScope(worktreeRoot, scope, sinceRef)` in `worktree.ts` — a
sibling of the existing `diffWithinScope` (`worktree.ts:206`) — uses the same
`git diff` + `ls-files` machinery but returns the **file bodies** (capped /
truncated) for in-scope paths changed since the prior round's commit ref.
`runMilestone` injects this digest into round N's decide `BrainContext` as quoted
**DATA** (weighed, not obeyed — `goal.ts:62-87`), alongside the unmet-criteria
findings and `judge-acceptance`'s quality findings. This is the real read path:
it reads the working tree + commits, which actually contain the built files, not
a function returning a count.

## Tradeoffs & risks

- **Criteria un-authorable from vague intent.** If `author-acceptance-criteria`
  cannot derive script-backed criteria from the intent (too vague), it blocks via
  a `DecisionBrief` at round 0 (the existing block path) — failing safe **before**
  any looping rather than looping blind against a phantom target.

- **The deterministic floor narrows what a criterion can express.** A genuinely
  important quality that no script can express cannot be a criterion — it lives in
  `judge-acceptance`'s gating verdict and findings instead. This is the right
  split: the deterministic floor gives the loop a real progress signal; the judge
  gives the ship gate a quality bar. (See ADR-031's termination tradeoff: the judge
  being in the gate is what weakens the pure-deterministic-termination guarantee,
  accepted there.)

- **Per-round commits change PR history shape.** N round commits instead of one
  collect commit. Keith's call: preserve them as the honest build trail (decision
  5). A reviewer sees how the MVP converged, which is information, not noise.

- **`diffBodiesWithinScope` can return a lot of text on a fat round.** It is capped
  / truncated (same posture as other body-returning reads) and bounded to in-scope
  paths only, so a round that touches many files gets a truncated digest, not an
  unbounded context blow-up.

- **Re-running all criteria each round costs script executions.** Bounded by the
  criteria count × rounds, and the same script runs that would gate a leaf anyway.
  Acceptable; it is what makes the continue/stop progress signal deterministic.

## Amendment to ADR-019

ADR-019 defined verify-on-read (`generatedAtSha` vs HEAD, with category
self-validation on mismatch) and named three checkpoints — DECIDE, SPLIT,
INTEGRATE — of which only SPLIT is wired. This ADR records and corrects a
previously-unstated fact: because `collectTree` commits only at tree-end
(`engine.ts:558`), **HEAD never advances within a tree, so verify-on-read was a
no-op for any consumer reading within the same tree** (every artifact appeared
permanently fresh). The fix is `commitRound` (decision 4): `runMilestone` advances
HEAD per round, so the round-0 criteria artifact is correctly re-validated against
the moving HEAD each round — ADR-019's SPLIT checkpoint now does real work across
rounds. The DECIDE and INTEGRATE global checkpoints remain **deferred** (unchanged
from ADR-019); this amendment widens only the SPLIT checkpoint's effective reach
by giving it a HEAD that actually moves.
