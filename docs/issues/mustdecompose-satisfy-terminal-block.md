---
type: issue
title: "A mustDecompose root that returns satisfy is terminally blocked instead of re-decided once"
description: When a deliver-intent (mustDecompose) root returns satisfy on a FRESH decision — defying the prompt that omits the satisfy shape and says 'do NOT return satisfy' — the engine coerces it to a hard block with no recovery, dead-ending the whole intent on one bad 8-token decision.
tags: [engine, decide, mustDecompose, deliver-intent, retry, brain-discipline]
timestamp: 2026-06-26
status: fixed
kind: bug
severity: high
---

# A mustDecompose root that returns satisfy is terminally blocked instead of re-decided once

> **Fixed (engine guard refinement), pending live re-proof.** The cannot-satisfy
> guard (`src/engine/engine.ts`) now **re-decides once** with a sharp corrective
> (`BrainContext.decideCorrection`, injected into the decide prompt) when a
> `mustDecompose` type returns `satisfy`; only a *repeated* satisfy terminal-blocks.
> The guard was also **moved before the SPLIT EVAL** so a corrected split flows
> through normal validation + dispatch. Tests:
> `tests/engine/engine.test.ts` (`cannot-satisfy guard` — satisfy-twice blocks;
> satisfy-then-split proceeds). Re-prove by re-commissioning slice C.

## Problem
A `mustDecompose` type (canonically `deliver-intent`) has no producing tool and
must `split` or `block` — never `satisfy`. The decide prompt already enforces this:
under `ctx.mustDecompose` it **omits the `{"kind":"satisfy"}` shape** and states "Do
NOT return satisfy" (`src/brains/llm.ts:978`). The engine then has a backstop
(`engine.ts:1024`): a `satisfy` from a `mustDecompose` type is coerced into a block.

That backstop was designed for ONE situation — "the brain took the easy exit **after
its split was judge-rejected**" (see the comment at `engine.ts:1016`). But it fires on
**any** `satisfy`, including a *fresh first decision* with no prior split. In that case
there is nothing to recover from and no retry: the root **dead-ends terminally** on a
single bad decision. One defiant 8-token completion sinks the entire intent.

The deeper point: the prompt instruction is the *primary* mechanism and it FAILED
here (the model returned satisfy despite the shape being absent and the instruction
explicit). The guard is the safety net — but a safety net that converts a recoverable
brain slip into a terminal block is too brittle. A `mustDecompose` root that slips
should be **re-decided once** with a sharp corrective ("you returned satisfy, which is
invalid for this type — split into typed children NOW"), not hard-blocked. The model
emitted satisfy in 8 completion tokens (no deliberation); a single corrective
re-decide would very likely recover.

## Evidence
Build run `live-self-2e2ece33` ($1.56 total, but the slice-C intent itself was one
cheap decide: **20.5K prompt / 8 completion tokens**), commissioning slice C (the
ADR-034 engine lifecycle steps). Event trace for the exact root
(`live-self-2e2ece33`): `goal-received` → `pattern-consulted: none` (no trusted
replay) → exactly **one** `decided` = `{"kind":"satisfy"}` → `emitted` BLOCKED:
*"Type 'deliver-intent' must decompose and cannot satisfy directly … The
decision-maker returned satisfy."* → `worktree-preserved` → `blocker-routed`. No
children were ever spawned; no split, no dependency edge. Guard:
`src/engine/engine.ts:1024-1034`; prompt: `src/brains/llm.ts:978`.

**This run did not test [ADR-037](../adrs/ADR-037-degraded-dependency-not-cascade-block.md).**
The root blocked at the first decision, before any split, so the dependency cascade
never formed. ADR-037 remains correct and committed but unproven live; this earlier
wall must be cleared first to re-reach it.

(Aside, separate issue: the live store `out/events.jsonl` accumulates every run's
events — 13 intents share it — which pollutes the rendered goal tree and the cost
summary. Not this issue's scope; noted for a per-run-store cleanup.)

## Proposed direction
(Rough, not committed.)
- **Re-decide once on a fresh mustDecompose satisfy.** When `decide` returns `satisfy`
  for a `mustDecompose` type, instead of immediately coercing to a block, **re-prompt
  the decision** with the prior (invalid) satisfy threaded as a prior-attempt
  correction: "your last decision was `satisfy`; that is structurally invalid for this
  type — it has no producing tool. Return a `split` into typed children (comprehension
  dives + implement leaves), or `block` with a brief if you genuinely cannot
  decompose." Bound it to a single retry; if it satisfies *again*, THEN terminal-block
  as today (now the model has had its corrective and refused — an honest dead-end).
- Keep the guard's terminal block as the *final* backstop (after the one retry, or
  after a judge-rejected split), not the *first* response to a fresh slip.
- Optionally strengthen the decode constraint so `satisfy` is not just omitted from the
  prompt but structurally rejected at parse for `mustDecompose` (the parser already
  has the type context via the schema name) — making the model's only parseable
  options split/block. Belt to the prompt's suspenders.

## Acceptance hint
A `deliver-intent` (mustDecompose) root that returns `satisfy` on its first decision is
**re-decided once** with a corrective nudge and proceeds to a `split` into typed
children, rather than terminally blocking on the single bad decision. Only a *repeated*
satisfy (after the corrective) blocks. Slice C (the ADR-034 engine lifecycle steps)
gets past its root decision and reaches its implement leaves — finally exercising
ADR-037's cascade fix.
