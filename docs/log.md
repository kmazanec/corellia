---
type: log
title: Corellia change log
description: Reverse-chronological log of Corellia's build. Completed work references an iteration or ADR; undone work lives in docs/issues/.
timestamp: 2026-06-25
---

# Corellia log

OKF change log — newest first. Each entry is terse: **completed** work points at
the [iteration](iterations/index.md) or [ADR](adrs/index.md) that owns the detail;
**undone** work lives as an [issue](issues/index.md) and is not narrated here.

This file replaces the former `STATUS.md`. Forward strategy is no longer a
standalone roadmap — it lives as open issues.

## 2026-06-26

- **The deep-dive size-split signal measures bytes, not only file count.**
  `repoShapeHint` fired only on `files >= 40`, missing a few-but-huge region:
  `tests/engine` (33 files but ~642KB / ~17K lines) deep-dived as one node, ballooned,
  evicted, and `step-loop:failed`, cascade-blocking every build leaf (slice-C run 15,
  $2.02, no code written). `countRegion` now sums bytes (cheap statSync) and the hint
  fires on EITHER bar (`files >= 40` OR `bytes >= ~450KB`) — the byte bound sits above
  `src/engine` (332KB, dives fine) and below `tests/engine`. Advances
  [comprehension-region-wallclock-exhaustion](issues/comprehension-region-wallclock-exhaustion.md).
  Also (run 15): the bare control-token form `<｜DSML｜` (no closing `>`) now strips
  (`884e8d9`), and the dive-anchor repair rung was proven — `dive-src-engine` repaired
  its hallucinated anchor in-attempt and emitted REAL (run-14's killer).

- **A mechanically-repairable deterministic failure routes through the repair rung
  instead of escalating the tier.** `DeterministicCheck.run` gained an optional
  `prescription`; `diveAnchorCheck` supplies one on a bad anchor, so a hallucinated
  `path:line` is re-grounded in-attempt (ADR-006) rather than re-rolled at the next
  tier into the same hallucination (the dominant wall in slice-C run 14). Partially
  closes [dive-anchor-hallucination-blocks-region](issues/dive-anchor-hallucination-blocks-region.md)
  (structural floor + model-capability signal still open). Also fixed a pre-existing
  full-suite flake: the two subprocess-heavy convergence flows
  (`convergence-eyes`/`convergence-taste`) timed out under parallel contention at the
  default 5s — given a 30s file timeout.

- **Iteration 15 — explore-then-emit consolidation** ([ADR-039](adrs/ADR-039-explore-then-emit-is-a-bounded-shape-and-scope-is-load-bearing.md);
  [iteration 15](iterations/2026-06-26-00-explore-then-emit-consolidation/index.md)).
  Three independent audits traced a string of slice-C stalls to ONE root cause — an
  explore-then-emit leaf reads the repo forever because its force-emit ceiling and
  read-economy teaching were comprehend-private by accident, compounded by scope never
  being load-bearing. Fixed at the design's altitude: ceiling keyed off SHAPE
  (`isExploreThenEmitLeaf`), read-economy shape-injected (`_explore-economy.md`), scope
  load-bearing via a per-type `requiresScope` property (zero test churn), safe step-loop
  dedup with the big collapse deferred (the mechanisms are each load-bearing). Plus five
  robustness fixes from driving slice C live: re-decided-satisfy no longer bypasses the
  mustDecompose guard, the decide prompt scopes producing children, the malform-reprompt
  fetch got its abort timeout, and a timed-out step is a transport incident
  (`StepTransportError`/`step-loop:transport`) not a logical `step-loop:failed`. **Proven
  live** (`live-self-6060bbf1`, $0.92): the author leaf that read 140 files to a timeout
  now bounds at exactly 16 reads; the root decomposes with scoped children; no wedge. The
  former `author-leaf-first-step-failure` issue is resolved + deleted. Slice C still
  unbuilt — knocked out by a slow provider endpoint, not a design pathology.

- **Provider control tokens stripped from tool-call args, not only content** (`ba4a9d1`).
  GLM/DeepSeek leak `<｜DSML｜>`-style tokens into the structured-emit tool-call
  arguments, not just the message-content fallback; `stripControlTokens` now runs on
  `tool_calls[].function.arguments` before parse. Found in slice-C run 14
  (`live-self-a6963719`): a contaminated `RegionFacts` emit collapsed `dive-src-engine`
  to a null artifact, starving the dependent build leaf. The run's *dominant* wall —
  a dive hallucinating `path:line` anchors the dive-anchor check rightly rejects — is
  filed as [dive-anchor-hallucination-blocks-region](issues/dive-anchor-hallucination-blocks-region.md);
  slice C remains unbuilt.

## 2026-06-25

- **Expert-persona layer for minted subagents** ([ADR-038](adrs/ADR-038-expert-persona-layer.md)).
  Cloned 12 domain-expert personas into `src/library/personas/` under generic names
  (go-expert, rust-expert, typescript-expert, …; provenance kept in frontmatter), added one
  shared pure selector (`src/library/personas.ts` — scope+type → ordered persona keys, LLM-free)
  and wired `renderPersonaBlock(goal)` into both mint paths: the brain's four roles via
  `systemPrompt` and the step-loop leaf's harness context. Derived from the goal, so no
  `BrainContext` plumbing. 23 selector tests; issue `expert-persona-subagents` deleted per the
  ephemeral-issue rule. Hand-built on main; not yet proven through a live run.

- **Iteration 14 — cascade + decide-robustness fixes from driving slice C**
  ([iteration 14](iterations/2026-06-25-21-cascade-and-decide-fixes/index.md)). Bundles
  ADR-037 + the mustDecompose re-decide (below) and the live runs that surfaced them.
  Fixed issues deleted per the ephemeral-issue rule (comprehension-oversplit-cascade,
  mustdecompose-satisfy-terminal-block, implement-read-paralysis — folded into the
  iteration record + ADRs). Re-run `live-self-481afacb` ($0.78, isolated store): the
  root **cleared and split correctly** into a slice-C decomposition (5 dives → author →
  2 implement → open-pr), ADR-037's fatal branch fired correctly — but
  `author-acceptance-criteria` **died at its first step** (`step-loop:failed`, 0 steps /
  0 tools / 0 produced), cascade-blocking the builders. New wall filed as
  author-leaf-first-step-failure (later resolved by
  [iteration 15](iterations/2026-06-26-00-explore-then-emit-consolidation/index.md)).
  Slice C is one wall further along, still unbuilt.
- **Build run `live-self-2e2ece33`** ($1.56, polluted shared store) — re-commissioned
  slice C to prove ADR-037. It did **not** reach ADR-037: the `deliver-intent` root
  returned `satisfy` on its **first** decision (8 completion tokens, defying the
  prompt that omits the satisfy shape), and the `mustDecompose` guard terminal-blocked
  it before any split formed. Surfaced a new gap (filed +fixed below); ADR-037 stays
  committed but unproven live. (Orphaned worktrees from this + an interrupted attempt
  cleaned up; primary `main` undisturbed. Aside: `out/events.jsonl` is a shared store
  across runs — pollutes the tree view/cost; noted for a per-run-store cleanup.)
- **mustDecompose guard re-decides once instead of terminal-blocking**
  ([iteration 14](iterations/2026-06-25-21-cascade-and-decide-fixes/index.md)).
  A `mustDecompose` root that returns `satisfy` is now **re-decided once** with a
  corrective nudge (`BrainContext.decideCorrection`); only a *repeated* satisfy
  terminal-blocks. The guard moved before the SPLIT EVAL so a corrected split is
  validated normally. `src/engine/engine.ts`, `src/contract/brain.ts`,
  `src/brains/llm.ts`; tests in `tests/engine/engine.test.ts`. Next: re-commission
  slice C (should now clear the root decision and finally exercise ADR-037).
- **ADR-037 — degraded dependency does not cascade-block** (the run-#9 fix). The
  dependency cascade (`src/engine/engine.ts`) gated on "does this dependency have a
  blocker"; it now gates on the dependency's **artifact**: a dependency that blocked
  but still produced a usable partial (run #9's `dive-tests` merged a valid
  `RegionFacts` despite one sub-dive's coverage nit) no longer hard-blocks its
  dependents — they proceed on the partial, the blocker is carried forward as a
  finding, and a `dependency-degraded` event records the decision. Only a dependency
  that produced **nothing** (`artifact === null`) still hard-blocks. Closes the
  cascade half of the former comprehension-oversplit-cascade issue (folded into
  [iteration 14](iterations/2026-06-25-21-cascade-and-decide-fixes/index.md))
  and the upstream half of [partial-delivery-on-blocked-dependency](issues/partial-delivery-on-blocked-dependency.md);
  unblocks slice C. Tests: `tests/engine/engine.test.ts` (degraded + fatal cases).
  The comprehension **over-split** itself is deferred (ADR-037 makes it non-fatal,
  not absent). Next: re-commission slice C through the factory.
- **Build run #9** (`live-self-76943fcd`, $0.48) — re-proved ADR-036 on slice C.
  **ADR-036 held**: the comprehension leaf that DID run (`dive-src-engine`, 34
  reads) stayed bounded at **74K tokens (run #8 ballooned to 117K), eviction fired
  3×, no truncation crash, and it EMITTED a converged artifact** — the exact run-#8
  failure mode is fixed. BUT slice C still didn't build, for a DIFFERENT reason: the
  root over-split (`tests` → 4 sub-dives), one sub-dive blocked, and the cascade
  starved the two implement leaves (`impl-steps`/`impl-wire`) before they ever ran
  (only `emitted` block events, 0 step execution). So `write_file=0` this run is the
  partial-delivery cascade + comprehension over-split, NOT the balloon. The
  hollow-emit gate correctly caught the characterization-not-code emit. ADR-036
  proven on the path it touched; the next wall is the cascade (already filed). Note:
  the leaf never used the `note` tool (0 notes) — eviction carried the bound alone.
- **Build run #8** (`live-self-cb6abfc2`, $0.56) — commissioned slice C ALONE (the
  engine integration steps). The implement leaf **read extensively (11 steps, 50
  reads) but wrote 0 files** before blocking (`step-loop:failed`) — no budget
  exhaustion, no salvageable code. Same can't-produce result as run #7's slice C.
  **Slice C is the genuine stuck point**: real engine surgery in the delivery hot
  path (modify engine.ts + a new module + tests, all consistent) that the factory
  comprehends but cannot produce across two attempts. The other 3 of 4 ADR-034/035
  mechanisms are built; this one is a hand-build candidate per the bootstrap loop.
  Worktree torn down; main undisturbed.
- **Build run #7** (`live-self-744d415d`, $2.51, 80% cache) — **the hollow-emit gate
  worked.** Commissioned the 3 remaining ADR-034/035 mechanisms; this time the
  slices did REAL write_file work (slice A: 6 writes + 20 script runs; slice B: 12 +
  10) instead of run #6's fake "pass" (slice A then did 0 writes). The judges caught
  slice C's absence honestly ("hollow emit — no actual code files written"). Salvaged
  + verified + landed **2 of 3 mechanisms** (commit 4ae7ced): the OKF **docs lint**
  (`scripts/lint-docs.ts`, wired into `npm run lint`, runs clean on our real docs/)
  and the **issue→CommissionInput reader** (`parseIssueToCommissionSeed`). 31
  factory-written tests pass; fixed 2 strictness gaps the blocked leaf left. Slice C
  (engine integration steps) was not built — still to do. Worktree torn down.
- **Hollow-emit gate added** (`src/engine/engine.ts`, commit 9bd1037) — the
  parent-eval gap Keith flagged: a make root could "succeed" while its children
  emitted plausible text / called open_pr without building anything (run #6's slice
  A). The integration judge reads text and can be fooled; now a deterministic gate
  at tree emission blocks a make root that produced NO real change (no in-scope
  worktree diff since the tree's base commit AND no files artifact). Counts changes
  vs. the BASE sha, not the moving HEAD, so committed milestone rounds still count
  (a first cut wrongly blocked legit convergence). 1506 green.
- **Build run #6** (`live-self-a2397f0f`, $1.17, 80% cache) — commissioned the 3
  remaining ADR-034/035 mechanisms (docs lint, issue→CommissionInput reader, engine
  integration steps) as explicit slices. **All 8 comprehension dives succeeded** (the
  wall-clock floor is proven), but **0 of 3 mechanisms were actually built**: slice A
  ("docs lint") did NO `write_file` calls (only `open_pr` ×2 + a 70-char text emit) —
  its ✓ was a hollow ship-wrapper, not the lint; slice B wrote 2 files then blocked;
  slice C never ran. (An initial read claimed the engine "reset away passing lint
  work" — that was a MISDIAGNOSIS: the engine `preserveTree`'d correctly, and the
  reflog reset was the operator's own teardown. Corrected on the
  [partial-delivery issue](issues/partial-delivery-on-blocked-dependency.md).) The
  real gap is the empty/no-real-work emit. Worktree torn down; main undisturbed.
- **PR [#7](https://github.com/kmazanec/corellia/pull/7) merged — the factory's
  `file_issue` tool shipped.** Build run #5 (`live-self-bd479522`, $2.46) opened
  the first real factory PR. It built a complete, sound 319-line `file_issue` tool
  (ADR-034) but its `implement` leaf emitted an EMPTY artifact, failed
  `artifact-present`, blocked, and the code was stranded uncollected. The tool was
  folded onto main (commit 37e898b) with the missing `docs.issues.write` grant on
  `investigate`, 11 tests, and **a fix to the gate that stranded it**:
  `artifact-present` now passes an empty artifact when the leaf actually WROTE
  files within scope (a tool-driven implement delivers via `write_file`, not
  returned text). 1506 tests green. Note: only the `file_issue` mechanism of
  ADR-034/035 is built; the engine integration steps, issue→CommissionInput
  reader, and OKF docs lint remain unbuilt.
- **ADR-034/035 build run #4** (`live-self-63daa9cf`, $3.21, 2.4M tokens) — went
  furthest yet: split into ~13 children, the **milestone loop ran 3 rounds**
  trying to converge, 8 of 12 dives succeeded. Blocked on the refined root cause:
  comprehension dives are **wall-clock-starved** — once the root fans out wide,
  ADR-030's subdivision gives each dive only ~94s, and 5 timed out (incl.
  `src/contract` at 14 files — NOT a size problem). The region-split fix (22a411e)
  didn't help because size wasn't the cause. Finding recorded on
  [the wall-clock issue](issues/comprehension-region-wallclock-exhaustion.md):
  comprehension needs a non-subdividing wall-clock floor (or narrower fan-out).
  Worktree torn down; main undisturbed.
- **ADR-034/035 build run #3** (`live-self-4b84f2d2`, $1.05) — the breakthrough
  run: the satisfy-prevention worked, the root SPLIT (no satisfy), `judge-split`
  PASSED first try into 6 proper vertical slices (4 `implement` + 2
  `improve-factory` — the factory correctly typed the self-modification slices),
  and it built far past the prior dead-ends. It blocked downstream: the `docs/`
  comprehension dive exhausted its wall-clock (~112s — `docs/` is now large after
  the OKF reorg) and that one failed dependency cascade-blocked all 6 build slices.
  Filed as [issue](issues/comprehension-region-wallclock-exhaustion.md) (a large
  region should split, not time out; + the cascade has no degraded path). Four
  engine fixes this session (decide-json, satisfy-guard, satisfy-prevention,
  CORELLIA_REFS) took the factory from "blocks at decision #1" → "splits and builds
  6 slices." Worktree torn down; main undisturbed.
- **Cannot-satisfy guard + decide-time prevention** for `mustDecompose` types
  (`mustDecompose` on `GoalTypeDef`/`deliver-intent`; engine guard + constitution
  lint; `BrainContext.mustDecompose` so the decide prompt omits `satisfy`). A
  re-commission of the ADR-034/035 build (`live-self-9e845f36`, $0.02) showed the
  guard working — but the brain decided `satisfy` on its FIRST decision, so the
  prevention was added on top: the decide prompt no longer offers `satisfy` to a
  root that cannot produce. Guard blocks the dead-end; prevention stops the brain
  reaching for it. Issue implemented and deleted; tests green.
- **improve-factory build of ADR-034/035 via `live:self`** (intent
  `live-self-3bf0f5b2`, $0.08) — commissioned the full design implementation.
  Decide cleared (the decide-json fix held under a large reference payload), and
  `judge-split` correctly rejected the first split for not being vertical slices.
  But the re-decide **collapsed to `satisfy`** — invalid for a `deliver-intent`
  root (no code tools), so it looped to a `step-loop:failed` block: no PR, nothing
  built, worktree at main's SHA. Filed as
  [issue](issues/deliver-intent-satisfy-coercion-block.md) — a real engine
  robustness gap (a code-tool-less root must never satisfy). Worktree torn down;
  primary `main` undisturbed.
- **Design-first self-build via `live:self`** (intent `live-self-8ac028ee`, $0.70,
  62% cache) — the factory designed its own issue/iteration OKF participation. It
  cleared the decide-json wall (dense intent + 5 attached references decided and
  split cleanly), then split into two `design-arch` ADRs. `a1` converged:
  **[ADR-034](adrs/ADR-034-issue-and-iteration-records-not-new-goal-types.md)** —
  `file-issue`/`author-iteration-record` do NOT earn goal-type status (granularity
  rule); mechanisms are a brokered `file_issue` tool + engine integration steps +
  improve-factory content. `a2` terminally blocked on an empty artifact → no PR;
  ADR-034 was salvaged to `main` and its sibling
  **[ADR-035](adrs/ADR-035-okf-conformance-and-routing-rules.md)** hand-built to
  complete the design. The empty-artifact block was filed as
  [issue](issues/design-arch-empty-artifact-block.md). Proves the decide-json fix
  live; surfaces a real partial-delivery robustness gap.
- **decide-json-robustness fixed** (`src/brains/llm.ts`). A large free-text root
  intent no longer blocks the tree at decision #1: the goal spec is rendered as
  readable labeled text in the decide/produce/judge prompt instead of an escaped
  JSON blob the model echoed back malformed, plus a meaning-preserving JSON-repair
  pass before any re-ask. Clears the named blocker on commissioning large
  factory-self-modification intents through `live:self`. The issue was implemented
  and deleted (ephemeral); 1482 tests green.
- **Docs reorganized to OKF.** Iterations became date-prefixed migration-style
  dirs with a catalog ([iterations/index.md](iterations/index.md)); an ephemeral
  [issues/](issues/index.md) backlog was stood up (21 issues seeded from the
  tiutni gap audit, the roadmap's future work, and the milestone-loop's unbuilt
  steps); `STATUS.md` → this log; `ROADMAP.md`, `gaps-from-tiutni.md`,
  `milestone-loop-SPEC.md`, and `prototype-build-notes.md` were folded into
  iterations/issues and deleted. See
  [corellia: docs OKF migration](iterations/2026-06-24-03-milestone-loop/index.md)
  context.

## 2026-06-24

- **Milestone loop steps 1–6 + ADR-033 landed on main.** `deliver-intent` gains a
  re-enterable split body (the four-guard halt); budget reframed as a non-steering
  safeguard; a signature-less split re-decide now terminates as non-convergence.
  Steps 7 (live proof) and 8 (slice-nesting) remain open —
  [step-7](issues/milestone-loop-step-7-prove-live.md),
  [step-8](issues/milestone-loop-step-8-slice-nesting.md). Detail:
  [iteration 13](iterations/2026-06-24-03-milestone-loop/index.md),
  [ADR-031](adrs/ADR-031-milestone-iteration.md),
  [ADR-032](adrs/ADR-032-acceptance-criteria-verify-on-read.md),
  [ADR-033](adrs/ADR-033-budget-is-a-non-steering-safeguard.md).
- **The `commission` front door shipped and was proven** end to end (a dogfood run
  also reproduced the milestone-loop block in ~$0.20 single-file form). Detail:
  [iteration 12](iterations/2026-06-24-02-commission-frontdoor/index.md).
- **Gap audit from driving tiutni** (an external greenfield product) through the
  factory. Captured as the [issues backlog](issues/index.md). Detail:
  [iteration 11](iterations/2026-06-24-01-gap-audit-tiutni/index.md).
- **AC-4 PROVEN** — the factory delivers to a FOREIGN repo (cats) and opens a
  clean PR autonomously ([PR #3](https://github.com/kmazanec/cats/pull/3), $0.13,
  no `.venv` leak, did not self-merge). 9 live runs, each buying one engine/harness
  fix. Detail: [iteration 10](iterations/2026-06-24-00-deliver-foreign/index.md).
- **AC-3 PROVEN — the strange loop is closed.** The factory built a feature on its
  OWN repo and opened a real PR ([PR #6](https://github.com/kmazanec/corellia/pull/6),
  $0.39). This was the named blocker on AC-3/AC-4 since iteration 06. Detail:
  [iteration 09](iterations/2026-06-23-00-comprehension-scoping/index.md).

## 2026-06-23

- **AC-2 PROVEN LIVE** — a scoped intent converged end-to-end on a real foreign
  repo (cats), $0.59. Comprehension scoping (ADR-029 Decisions 2+4) + soft budgets
  (ADR-030) + transport timeout + decide-skill injection + `head_sha` + comprehend
  hardening + native tracing. 1409 tests green. Detail:
  [iteration 09](iterations/2026-06-23-00-comprehension-scoping/index.md),
  [ADR-029](adrs/ADR-029-comprehension-recursion.md),
  [ADR-030](adrs/ADR-030-soft-budgets-until-proven.md).

## 2026-06-20

- **Recursion landed on main** (ADR-029 Decisions 1+3): `leafOnly` removed so
  comprehension obeys the split law; a structured integrate-merge composes child
  artifacts. Mechanism proven live; comprehension-over-fires finding deferred to
  iteration 09. Detail: [iteration 08](iterations/2026-06-12-21-recursion/index.md).

## 2026-06-12

- **Iteration 07 — Conventions** shipped: layered global + host conventions
  (ADR-028). 1335 tests. [Detail](iterations/2026-06-12-13-conventions/index.md).
- **Iteration 06 — Self-hosting** shipped: hosted front door + improvement loop;
  the loop closes (AC-2 1/5 — comprehension can't yet recurse → iter 08). 1345
  tests. [Detail](iterations/2026-06-12-01-loop/index.md).

## 2026-06-11

- **Iteration 05 — Taste** shipped: all 19 goal types, structured emission, intent
  dial, golden capture, learning retries. 1076 tests.
  [Detail](iterations/2026-06-11-17-taste/index.md).
- **Iteration 04 — Eyes** shipped (PR #4): brownfield comprehension + impact-aware
  splitting. 826 tests. [Detail](iterations/2026-06-11-14-eyes/index.md).

## 2026-06-10

- **Iteration 03 — Hands** shipped (PR #3): agentic leaf execution; live
  convergence at $0.07. 555 tests. [Detail](iterations/2026-06-10-21-hands/index.md).
- **Iteration 02 — Substrate** shipped (PR #2): Postgres, gates, listener,
  flywheel, live brain. [Detail](iterations/2026-06-10-10-substrate/index.md).
- **Iteration 01 — Walking skeleton** shipped (PR #1): engine, evals, budgets,
  event log. [Detail](iterations/2026-06-10-01-walking-skeleton/index.md).
