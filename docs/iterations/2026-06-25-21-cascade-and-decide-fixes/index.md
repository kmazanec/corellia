---
type: iteration
title: "Iteration 14 — Cascade + decide-robustness fixes from driving slice C (ADR-037 + mustDecompose re-decide)"
description: Two engine fixes surfaced by re-commissioning slice C (the ADR-034 lifecycle steps) through live:self — a degraded dependency no longer cascade-blocks (ADR-037), and a mustDecompose root that returns satisfy re-decides once instead of terminal-blocking. Each cleared a wall and exposed the next; the run reached a correct slice-C decomposition but stalled on author-acceptance-criteria dying at its first step.
tags: [iteration, engine, adr-037, dependency-cascade, mustDecompose, decide-robustness, deliver-intent, bootstrap, slice-c, step-loop]
timestamp: 2026-06-25
status: landed-on-main
---

# Iteration 14 — Cascade + decide-robustness fixes from driving slice C

**Date:** 2026-06-25 · **Status:** Landed on main (both engine fixes merged; slice C
itself still unbuilt — the live run hit a further wall, recorded below)

This iteration is a **bootstrap diagnostic loop**: re-commissioning slice C (the
ADR-034 engine lifecycle steps — iteration-record creation + issue deletion on
delivery) through `live:self` as a canary, fixing each engine gap the run exposes,
and re-running. Each fix cleared one wall and surfaced the next. The fixes landed on
`main`; slice C is not yet built.

## What landed on main

### 1. ADR-037 — a degraded dependency proceeds on its partial (the run-#9 cascade fix)
The dependency cascade (`src/engine/engine.ts`) gated on "does this dependency carry a
blocker"; it now gates on the dependency's **artifact**. A dependency that blocked but
produced a usable partial artifact no longer hard-blocks its dependents — they proceed
on the partial, the blocker is carried forward as a finding, and a
`dependency-degraded` event records the decision. Only a dependency that produced
**nothing** (`artifact === null`) still hard-blocks. Closes the cascade half of the
former comprehension-oversplit-cascade issue and the upstream half of
partial-delivery-on-blocked-dependency. See
[ADR-037](../../adrs/ADR-037-degraded-dependency-not-cascade-block.md). Commit
`5632226`; tests in `tests/engine/engine.test.ts` (degraded-proceeds + fatal-blocks).

### 2. mustDecompose satisfy re-decides once instead of terminal-blocking
A `deliver-intent` (mustDecompose) root that returned `satisfy` was terminally blocked
on the single bad decision, dead-ending the whole intent — even though the decide
prompt already omits the satisfy shape and forbids it, so a satisfy there is a brain
slip, not deliberation (observed `live-self-2e2ece33`: satisfy in 8 completion
tokens). The guard now **re-decides once** with a sharp corrective
(`BrainContext.decideCorrection`, injected into the decide prompt) and was **moved
before the SPLIT EVAL** so a corrected split flows through normal validation +
dispatch; only a *repeated* satisfy terminal-blocks. Commit `4b9698f`;
`src/contract/brain.ts` + `src/brains/llm.ts` + `src/engine/engine.ts`; tests in
`tests/engine/engine.test.ts` (`cannot-satisfy guard`).

## What the live runs proved (and the wall they hit)

Three `live:self` slice-C commissions drove this iteration:

- **`live-self-2e2ece33`** ($1.56, shared/polluted store) — root returned `satisfy` on
  its first decision; the mustDecompose guard terminal-blocked it before any split.
  Surfaced fix #2. (Also surfaced that `out/events.jsonl` is a shared store across
  runs — pollutes the tree view/cost; noted for a per-run-store cleanup, filed
  separately.)
- **`live-self-481afacb`** ($0.78, **isolated store** `out/slicec-adr037-run/`) — the
  re-run after both fixes. Outcomes:
  - ✅ **Root cleared.** It split first-try into a correct slice-C decomposition: 5
    `deep-dive-region` dives (`src/engine`, `docs/iterations`, `docs/issues`,
    `docs/log.md`, `tests/engine`) → `author-acceptance-criteria` → two `implement`
    leaves → `open-pr`, run through the milestone loop (2 rounds). The
    `2e2ece33` wall is gone. (The re-decide *correction path* didn't need to fire —
    the clean context split first-try — so fix #2 is proven at the root-clears level,
    not at the correction-fires level.)
  - ✅ **ADR-037 exercised, fatal branch correct.** The implement leaves blocked with
    *"dependency failed **without producing any usable artifact**"* (the ADR-037
    `artifact === null` wording) because their real dependency,
    `author-acceptance-criteria`, produced nothing. ADR-037 correctly hard-blocked
    rather than false-proceeding; no `dependency-degraded` events fired because no
    dependency blocked-with-partial. Behaving exactly as designed.
  - ❌ **New wall: `author-acceptance-criteria` dies at its first step.** In **both**
    rounds (`c1`, `a0`) the author leaf decided `satisfy`, then emitted
    `step-loop:failed` (isomorphic block) with **zero `step`, zero `tool-call`, zero
    `produced` events** — it failed on the very first step, twice, before any tool
    ran. Not a context balloon (ADR-036 held; all 5 dives succeeded bounded). This is
    the still-open half of the implement-read-paralysis class: a malformed/truncated
    *first* step the isomorphic detector cannot distinguish from a logic failure. The
    loop then halted on `judge-acceptance: no shippable verdict`.

Strange-loop hygiene held on every run: primary checkout stayed on `main`, undisturbed
(the post-check "dirty" warning is the untracked `media/video.zip`, not factory
output); orphaned worktrees were torn down.

## Follow-on (filed as issues)

- **`author-acceptance-criteria` (and any author leaf) dies at its first step with
  `step-loop:failed`** — a first-step transport/parse failure, isomorphic-blocked with
  0 steps. This is the live next wall for slice C; filed as a new issue
  (`author-leaf-first-step-failure`).
- **Per-run event-store isolation** — `out/events.jsonl` accumulates every run; filed
  for a cleanup so live traces and cost summaries are readable per run.

## Bootstrap note

Per the bootstrap loop in `CLAUDE.md`: each wall was recorded as an issue before
fixing, the fixes were hand-built on `main` the Corellia way (constitution-compliant,
tested, ADR where a durable decision was made), and re-proven through the factory. The
loop has not yet closed for slice C — it is one wall further along than it was, and the
remaining wall is recorded.
