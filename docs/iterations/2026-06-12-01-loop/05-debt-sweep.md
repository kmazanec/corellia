---
id: F-65
title: "Debt sweep: tournament, lint, capture, read-only"
iteration: 06-loop
type: implement
intent: production
status: Shipped
dependsOn: []
contracts: [ADR-024, ADR-013, ADR-003]
---

# Feature: Debt sweep — tournament, lint, capture, read-only

**ID:** F-65 · **Iteration:** 06-loop · **Status:** Shipped

## What this delivers (before → after)
**Before:** four named debts ride from iterations 04/05 — design-arch's
artifact-level tournament is an unbuilt engine seam (`leafOnly` scan fields
are inert), the dangerous-grant invariant lives only in tests, integration-judge
verdicts are invisible to the flywheel, and learn-kind runs pay worktree cost
for read-only work.
**After:** the leaf tournament runs, the lint owns the rule, integration verdicts
feed golden capture, and learn-kind roots run worktree-free and byte-identical.

## Reading brief
- `src/library/types/author.ts` — `design-arch` card; `scan` field; `judgeType`
- `src/engine/engine.ts` — terraced-scan entry (~:522); normal single-derive path
  (~:536); attempt loop; integration-judge site (~:2450); `run()` sandbox/finally
  (~:334, ~:390)
- `src/library/constitution.ts` — `lintLibrary`; existing ceiling rules
- `tests/library/evolve-grants.test.ts` — dangerous-grant test to be absorbed
- `src/engine/assembly.ts` — `SandboxConfig`; broker construction seam
- ADR-024 (golden-capture decision; non-scripted filter requirement)
- ADR-013 (exact grants; kinds as lint ceilings)
- ADR-003 (exhaustive switch discipline)

## Dependencies (must exist before this starts)
None — can start as soon as the iteration's contracts are frozen.

## Contracts touched
- Event log (source of truth: ADR-003, `src/contract/events.ts`) — no new members;
  the integration-judge site wires the existing `judge-verdict` and
  `golden-candidate` members it already knew about; exhaustive switch consumers
  in `src/eventlog/projections.ts` already handle both (`traceStats` ~:139,
  `costSummary` ~:274, `projectKnowledge` ~:403).
- `lintLibrary` (source of truth: ADR-013, `src/library/constitution.ts`) —
  extends to reject any type whose grants match `/merge|approve|deploy|spend/`;
  the evolve-grants test's manual check is absorbed into this rule.

## Acceptance criteria
1. (A9) A `leafOnly` type with `scan.k > 1` generates k candidate artifacts at
   the leaf, judges each with its `judgeType`, and emits the best; the event trail
   shows the tournament (one `judge-verdict` per candidate + one `golden-candidate`
   per non-scripted run); `design-arch`'s existing card fields drive it unchanged.
2. (A10) `lintLibrary` rejects any type whose grants match the dangerous set
   (`merge|approve|deploy|spend`) at engine construction; the evolve-grants test
   is updated to assert the lint rule itself fires rather than performing a manual
   loop.
3. (A11) The integration-judge site appends `judge-verdict` and `golden-candidate`
   events on every non-scripted run; the `goldenCandidates` projection includes
   them; ADR-024's non-scripted filter applies.
4. (A12) A learn-kind ROOT goal opens no worktree: target repo is byte-identical
   after the run (no branch, no worktree dir); write-granting tools are absent from
   its broker table; `live:eyes` drops its manual teardown block.

## Testing requirements
- A9: tournament event-trail test with a scripted brain — multi-candidate `design-arch`
  run; assert k `judge-verdict` events emitted before the single winner `produced`;
  assert `golden-candidate` absent when `scripted: true`.
- A10: lint unit test — a synthetic type carrying a dangerous grant string fails
  `lintLibrary`; the absorbed evolve-grants test assertion now delegates to the
  lint rule.
- A11: integration-judge event test — mock registry with `judge-integration`;
  assert `judge-verdict` + `golden-candidate` appended post-assembly; assert
  absent when store marks run as scripted.
- A12: read-only integration test — learn-kind ROOT via real engine (scripted
  brain, real worktree layer); post-run `git status --porcelain` empty; no entry
  in `git worktree list` beyond the main checkout; `write_file` absent from broker
  tool table.

## Manual setup required
None.

## Build plan (approved)
- [ ] Chunk 1 — Leaf tournament (A9): wire `scan.k > 1` into the leaf path of
  `_run()` for `leafOnly` types; generate k produces, judge each with `judgeType`,
  select winner by fewest findings; emit `judge-verdict` per candidate +
  `golden-candidate` for non-scripted runs; satisfies AC 1; tests:
  `tests/engine/leaf-tournament.test.ts`; contract touchpoint: none new
  (uses existing `judge-verdict`, `golden-candidate`).
- [ ] Chunk 2 — Lint rule for dangerous grants (A10): add the `/merge|approve|deploy|spend/`
  check to `lintLibrary`; update `tests/library/evolve-grants.test.ts` to assert
  the lint rule fires rather than duplicating the manual loop; satisfies AC 2;
  tests: `tests/library/constitution.test.ts` (new lint case);
  contract touchpoint: `constitution.ts` ceiling rule.
- [ ] Chunk 3 — Integration-judge capture (A11): at the integration-judge site
  (~:2450) append `golden-candidate` event after each `judge-verdict`; gate on
  non-scripted runs via the run-context flag already present; satisfies AC 3;
  tests: `tests/engine/integration-capture.test.ts`; contract touchpoint:
  `golden-candidate` event (ADR-024 filter).
- [ ] Chunk 4 — Learn-kind root without worktree (A12): add a no-sandbox path in
  `run()` that activates for learn-kind ROOT goals; broker carries read-only tools
  only; `finally` skips collect/preserve (no assembly to tear down); update
  `live:eyes` teardown comment; satisfies AC 4; tests:
  `tests/engine/learn-readonly.test.ts`; contract touchpoint: `SandboxConfig`
  optional path (learn roots skip it).

### Test strategy
Each chunk is independently green — no chunk unlocks another. A12's test uses a
temp bare repo fixture (no network); the porcelain + worktree-list assertions are
the byte-identical proof. The full 1076-test suite must stay green after each chunk
(A9 is the riskiest — attempt-loop surgery).

### Contract touchpoints
No new event members. The `golden-candidate` filter (non-scripted gate) is
ADR-024's single source of truth; don't duplicate the flag logic. The lint rule
in `constitution.ts` becomes the single source for the dangerous-grant invariant —
the evolve-grants test must not re-state it.

### Manual setup
None.

### Risks
- A9 touches the attempt loop and the leaf produce path — run the full suite after
  every intermediate commit, not just at chunk end.
- A12's `finally` skip must not accidentally leave a partially-opened assembly
  open on error; the no-assembly path must be guarded by the same
  `report === undefined` check.
- A11's non-scripted gate: confirm the run-context scripted flag reaches the
  integration-judge site and is not accidentally `undefined` (falsy-safe).

## Implementation notes

**Winner-selection rule (A9 tournament):** passing candidates ranked by fewest
findings; first-in-iteration-order tie-break (earliest candidate with minimum
finding count wins). When no candidate passes, the candidate with fewest findings
is used as the best loser and flows to the deterministic + judge gates normally
(where it will likely fail and enter the standard repair/escalate path).

**Where the scripted flag is read at the integration-judge site (A11):** the
`this.goldenCapture` field on `Engine` (set at construction from
`EngineOptions.goldenCapture`). The field is falsy-safe (defaults to `false`,
never `undefined`) because the constructor initialises it as `opts.goldenCapture
?? false`. The guard at the integration-judge site is a simple `if
(this.goldenCapture)` block that wraps both the `judge-verdict` append and the
`maybeAppendGoldenCandidate` call — ADR-024's non-scripted filter is not
duplicated elsewhere.

**Guard condition for the no-sandbox learn path (A12):** `goal.parentId === null`
(root goal) AND `registry.get(goal.type).kind === 'learn'` AND the type's grants
contain no script-execution capability (`test.run_scoped` / `test.run_impacted`).
Script-granting learn goals (e.g. `map-repo`) still open a worktree for declared-
script isolation. The `report === undefined` guard in the `finally` block is
identical to the sandboxed path: the finally always clears `_activeAssembly` and
since there is no worktree, collect/preserve are simply not called.

