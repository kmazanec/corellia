---
type: issue
title: Event-log conformance checker — extend the constitution from structure to conduct
description: The constitution lints goal-type definitions at PR time, but nothing replays a real run's event log to assert the runtime invariants held (deterministic-before-judge, judges never wrote, budget monotonicity).
tags: [eventlog, constitution, eval, replay, projections]
timestamp: 2026-07-07
status: open
kind: idea
severity: medium
---

# Event-log conformance checker — extend the constitution from structure to conduct

## Problem
`src/library/constitution.ts` guards the library's *shape* (grant ceilings,
judge-no-write, on_timeout presence) at lint time. Whether a *run* actually obeyed
the invariants — every judge verdict preceded by its deterministic checks, no
write event attributable to a judge-kind goal, spend monotone and under ceiling,
every blocked touchpoint carrying a deadline, park always releasing scope — is
asserted nowhere except one scripted e2e tree. The event log contains everything
needed to check conduct after the fact; the factory just never reads it back for
that purpose. As live runs multiply, a conformance pass over each log is the
cheapest possible audit: pure projection code, no model calls.

## Evidence
- eval-scout sweep (2026-07-07): constitution is structural only
  (src/library/constitution.ts); ordering asserted once in
  tests/e2e/greeting.test.ts against a scripted tree.
- DESIGN.md "The event log — the substrate under everything": every other view is
  a projection; a conformance verdict is just one more projection.

## Proposed direction
A `checkConformance(events)` projection returning typed violations, plus a
`corellia conform <log>` CLI and a vitest that runs it over the fixture/e2e logs.
Start with four or five cheap invariants (deterministic-before-judge per goal;
no judge-authored writes; monotone spend ≤ ceiling; briefs carry deadlines;
worktree events well-nested) and grow by evidence. Run it opportunistically over
every live run's log; violations file issues, not fixes.

## Acceptance hint
`corellia conform out/<run>/events.jsonl` prints PASS or a typed violation list;
a deliberately corrupted log (judge write injected, gate reordered) is caught in
a unit test.

---

> **Fixed (2026-07-07, branch `issue/conformance`; status left open pending live
> proof over a real run's log).** A `checkConformance(events, opts)` projection
> (`src/eventlog/conformance.ts`, orchestration index over
> `src/eventlog/conformance/*.ts` — one module per invariant) returns a typed
> `ConformanceViolation[]`, and `corellia conform <log>` prints PASS or the typed
> violations and exits nonzero on any violation
> (`src/eventlog/conform-cli.ts`, wired into `scripts/corellia.ts` following the
> `label` pattern). Pure projection, no model calls — the conduct dual of the
> structural constitution lint, exactly as sketched.
>
> **Invariants shipped (all five, each mapped honestly onto the real event
> vocabulary):**
> - **deterministic-before-judge** — per goal, the first `deterministic-checked`
>   must precede the first `judge-verdict`. A goal with a verdict but no per-goal
>   gate is NOT flagged (a split judged at the parent legitimately has no per-goal
>   deterministic event; absence ≠ reordering). Only a gate that ran AFTER the
>   verdict is flagged.
> - **no-judge-authored-writes** — a goal whose `goal-received.goal.type` resolves
>   to judge-kind must have no write-attributable event under its goalId. Write =
>   the structural side-effect events (`files-touched`, `worktree-collected`,
>   `branch-pushed`, `pr-opened`, `knowledge-written`, `memory-written`);
>   `tool-call` is deliberately excluded (its `tool` field is a raw tool name, not
>   a governed grant — a judge reading a file must not trip it). Kind comes from
>   the run's registry (the CLI wires `starterTypes()`); with no registry it falls
>   back to the `judge-*`/`critique-*` naming convention and the violation detail
>   says so.
> - **spend-monotone** and **spend-under-ceiling** — cumulative `spentUsd`
>   (carried by `round-started` and `ceiling-reached`) must never decrease and
>   never exceed the declared ceiling. `ceiling-reached.ceilingUsd` is the only
>   event carrying the declared ceiling, so the ≤-ceiling check runs only when a
>   `ceiling-reached` exists (skipped honestly otherwise); monotonicity always
>   runs.
> - **brief-carries-deadline** / **park-carries-ttl** — every `blocked` brief
>   carries a positive `deadlineMs`; every `parked` carries a positive `ttlMs`
>   (runtime dual of the type-level schema requirement — the value is a usable
>   positive duration, not a zero sentinel).
> - **worktree-well-nested** — by `treeId`: created before used
>   (collected/preserved/pushed/pr-opened), no use-after-terminal, no re-create of
>   a live id.
>
> **Judgment calls / honest deviations:**
> - The "park always releasing scope" invariant in the sketch became
>   **park-carries-ttl**: the log expresses the park's TTL (`parked.ttlMs`) but
>   NOT a per-park scope-release event, so the scope-release half is not checkable
>   from the stream and is not claimed. What IS checkable (the TTL fail-safe) is
>   checked.
> - **no-judge-authored-writes is honest-but-mostly-latent today:** a judge does
>   not get its own `goal-received` in the current engine (a `judge-verdict` is
>   emitted against the *judged* goal, carrying `judgeType`), so no judge-kind goal
>   currently owns writes to flag. The check is written for the conduct the
>   invariant forbids and fires the moment a run DOES spawn a judge-kind type as a
>   producing goal — real value as a guardrail, latent on today's clean streams.
>   Recorded rather than dropped because it is the runtime dual of the
>   constitution's judge-no-write lint.
> - **worktree-reaped is excluded** from the lifecycle check: it carries no
>   `treeId` (it works from `git worktree list`, not a live goal — events.ts
>   comment), so it cannot join the treeId-keyed nesting check. Stated at the
>   check rather than guessed.
> - **`tool-call` excluded from write attribution** (above) — chosen over a looser
>   check that would false-positive on judge reads.
>
> **Tests** (`tests/eventlog/conformance.test.ts`, 20 cases): a clean synthetic
> log passes; one deliberately corrupted log per invariant produces exactly that
> invariant's violation (judge write injected, gate reordered, spend dropped,
> spend over ceiling, brief without deadline, park without ttl, worktree
> use-before-create and use-after-remove); a multi-corruption log reports each
> invariant independently; the CLI prints PASS/violations with the right exit
> codes; and — the extra assertion the issue asks for — the **greeting e2e's real
> event stream** (run through the `Engine` in-test) is asserted conformant.
>
> **Gate:** `npx tsc --noEmit` clean; `npm run lint` clean (`library lint: ok`,
> `docs lint: ok`); `npm run code-shape` clean after the per-invariant
> decomposition; targeted vitest green (20/20 conformance, 200 pass / 3 skipped
> across `tests/eventlog/` + greeting e2e).
