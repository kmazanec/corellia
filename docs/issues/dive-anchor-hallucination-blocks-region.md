---
type: issue
title: "a deep-dive that hallucinates a line-anchor fails the dive-anchor check terminally and cascade-starves its dependent builder"
description: A deep-dive-region's RegionFacts cite path:line anchors the model invents (e.g. engine.ts:4687 in a 4686-line file); the dive-anchor deterministic check correctly rejects them, but with no repair path the dive escalates to the high tier, fails again, and emits a null artifact — so the ADR-040 handoff injects no facts for that region and the dependent build leaf re-surveys it and blocks.
tags: [engine, comprehend, knowledge, dive-anchor, verify-on-read, region-facts, deliver-intent, model-quality]
timestamp: 2026-06-26
status: partially-fixed
kind: bug
severity: high
---

# a deep-dive that hallucinates a line-anchor fails the dive-anchor check terminally and cascade-starves its dependent builder

> **Update (2026-07-06) — structural-floor half fixed (pending live proof).** A
> build leaf whose primary-region dive produced nothing is no longer hard-blocked
> by the ADR-037 cascade: it proceeds on a **mechanically-derived structural floor**
> for that region instead of re-surveying from scratch and blocking.
>
> - When a dependency that produced a null artifact is a comprehension **dive**
>   (`kind: 'learn'` with a scope), its region is *floorable*: the engine
>   synthesizes a structural floor — the region's file list (path + line/byte
>   sizes) and a regex-grade export-symbol index (no LLM call) — and injects it as
>   **provisional** memories clearly labeled as a floor ("dive produced no facts;
>   raw structure pointers — read before trusting"). The null dive is carried
>   forward as a finding and a `dependency-degraded` event, not silently swallowed.
> - A null-producing **`make`** dependency (behavior the dependent consumes) still
>   hard-blocks, unchanged — ADR-037's protection is intact; only floorable
>   comprehension gaps are downgraded from block to floor.
> - The file list is capped (default 300 entries) with an **explicit** truncation
>   note in the memory text — no silent cap (DESIGN "Memory": provisional,
>   mechanically-derived, labeled as such).
> - New modules: `src/engine/structural-floor.ts` (pure floor synthesis),
>   `src/engine/region-scanner.ts` (fs-backed scan, injectable), and
>   `src/engine/dive-floor-handoff.ts` (the classify-and-inject seam), wired through
>   `runSplitChildren` → `runOneSplitChild`. No ADR: it slots into the existing
>   ADR-037/ADR-040 handoff without a new architectural decision.
>
> **Still open:** the **model-capability** half — escalation rolling into the same
> hallucination wall — is tracked in
> [model-capability-signal](model-capability-signal.md) and covered by the
> capability-tagged model catalog landing separately in this same wave (ADR-044),
> which lets tier selection pick a model by demonstrated reliability instead of a
> fixed low→mid→high ladder. Live proof (a `live:self` run where a null `src/engine`
> dive yields a floored builder that converges instead of blocking) is still to be
> captured.

> **Partially fixed (2026-06-26).** The repair-rung half is done: `diveAnchorCheck`
> now returns a `prescription` on a bad anchor (the contract's `DeterministicCheck.run`
> gained an optional `prescription` field), so the engine routes the failure through
> the repair rung (ADR-006, repair-within-attempt) — handing the model the exact bad
> anchors with the instruction to re-ground them by symbol search or drop the unfounded
> fact — instead of escalating the tier into the same hallucination. If the repair
> still reproduces the bad anchor, the isomorphic-failure check blocks honestly (one
> repair attempt, not an infinite loop). **Still open:** the *structural floor* for a
> build leaf whose primary-region dive nonetheless produced nothing (so it re-surveys
> and blocks), and the model-capability signal so escalation doesn't roll into the same
> wall. The control-token contributor was already fixed separately (`ba4a9d1`).

## Problem

A `deep-dive-region` emits `RegionFacts` whose `DiveFact`s carry `path:line`
anchors. The deterministic `dive-anchor` check (verify-on-read, ADR-019) validates
each anchor against the real file at HEAD and **rejects an anchor past end-of-file
or pointing at the wrong content** — which is correct. But there is no repair rung
that re-grounds a hallucinated anchor: a failed check escalates the dive to the
high tier, the high tier hallucinates *again*, and the dive exhausts its tiers and
emits a **null artifact**.

That null artifact is the head of a cascade the rest of the pipeline is now built
to survive but cannot usefully proceed without:

- The ADR-040 dive→build handoff injects facts only from dives that produced an
  artifact. A null dive contributes **zero** memories for its region.
- The dependent build leaf therefore starts **without** the comprehension for the
  one region it must change, re-surveys it from scratch, and (in run 14) blocked on
  the ADR-037 degraded-dependency path citing the null dive.

So a *model-quality* failure (invented line numbers) on **one** dive — the
`src/engine` dive, the most load-bearing one for this feature — sank the build,
even though the persona slimming and the handoff both worked as designed.

## Evidence

Run `live-self-a6963719` (slice C, run 14, ~21 min, 3 milestone rounds before a
manual stop on a doomed loop). Event trace from `out/slicec-run14/events.jsonl`:

- `dive-src-engine` and `dive-docs-issues` both emitted **`artifact: null`** with a
  single blocker each.
- The dive-anchor check rejected six bad anchors:
  `src/engine/engine.ts:4687` (file has 4686 lines), two anchors into 37-line files,
  and `src/engine/budget.ts:106` (file has 70 lines) — each seen twice (mid then,
  after `tier-escalated: mid→high`, again on high).
- `a1` (the `implement` leaf) **did** receive **46 injected memories** from the
  *successful* dives (the handoff fired), but none for `src/engine` — so it read
  **130 files / 66 searches / 55 steps / 37 evictions** and emitted `artifact: null`
  with the ADR-037 blocker: *"a dependency failed without producing any usable
  artifact: Goal 'Deep-dive region src/engine' failed at the highest tier."*

Note the separate, already-fixed contributor: **1** of the failures was a
`<｜DSML｜>` control-token contamination on the structured-emit tool-call args path
(`Unexpected token '<', "<｜DSML｜too"...`), fixed in `ba4a9d1` (strip control tokens
from tool-call arguments, not only message content). The **dominant** failure mode
here is the hallucinated anchors, which that fix does not touch.

## Proposed direction

(Rough, not committed.)

- **A dive-anchor repair rung.** When the dive-anchor check rejects an anchor,
  feed the specific finding back (`engine.ts:4687 — file has only 4686 lines`) as a
  repair hint and let the dive re-emit with corrected anchors *within the same
  attempt* (ADR-006 repair-within-attempt), rather than escalating tier and
  re-rolling the same hallucination. This mirrors `error-signature-repair-hints`.
- **Tolerate a slightly-off anchor instead of hard-rejecting.** A claim whose
  anchor is near-miss (off-by-a-few, or the symbol moved) is still a useful pointer.
  Consider grounding the anchor by searching for the cited symbol/text rather than
  trusting the literal line, and downgrading (not discarding) a fact whose anchor
  cannot be re-grounded — a `provisional` pointer beats no pointer.
- **Do not let one null dive fully starve its dependent.** The ADR-040 handoff and
  ADR-037 degraded path both exist; the gap is that a *build* leaf with no facts for
  its primary region has no floor. Consider letting the builder proceed with the
  region's raw structure (file list + symbols) when its dive produced nothing,
  rather than re-deriving everything and then blocking.
- **Model-capability signal** ([model-capability-signal](model-capability-signal.md)):
  the high tier (GLM-5.2) hallucinated anchors *more* reliably than the mid tier on
  this run; escalation to a model that fails the same way is wasted budget. A signal
  that picks the tier by demonstrated reliability for anchored comprehension would
  avoid the escalation-into-the-same-wall.

## Acceptance hint

A deep-dive whose first emit cites a hallucinated anchor is re-grounded (repaired
in-attempt or its anchor re-searched) and emits a usable `RegionFacts` rather than
escalating tiers into the same hallucination and emitting null; and a build leaf
whose primary-region dive nonetheless produced nothing is not left to re-survey the
whole region and block — it proceeds on a structural floor.
