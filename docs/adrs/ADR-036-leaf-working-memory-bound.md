---
type: adr
title: "ADR-036: a leaf's working memory is bounded — a curated scratchpad plus an engine eviction backstop"
description: A leaf's step-loop transcript is append-only and re-sent in full each step, so broad reading balloons context to truncation; bound it with a model-curated scratchpad (capability) and an engine-managed read-eviction backstop (robustness).
tags: [adr, engine, step-loop, working-memory, context, scratchpad, eviction, truncation]
timestamp: 2026-06-25T20:00:00-05:00
---

# ADR-036: a leaf's working memory is bounded — a curated scratchpad plus an engine eviction backstop

**Status:** Accepted · **Date:** 2026-06-25 · **Stretch:** no · **Contract:** yes
**Supersedes:** none · **Superseded by:** none

## Context

A leaf executes through `runStepLoop` (`src/engine/engine.ts`): each step the
engine calls `brain.step(goal, transcript, tools, ctx)`, the model returns tool
calls, the engine runs them through the broker, and **appends each tool result —
the full `result.output`, i.e. the entire file contents — to the transcript as a
`role: 'tool'` message** (`StepMessage`, `src/contract/brain.ts:98`). The whole
transcript is re-serialized and re-sent on **every** subsequent step.

So a leaf's working memory is a **monotonically-growing, append-only log that holds
the verbatim text of every file it has ever read**, re-sent in full each step. The
only thing that ever shrinks it is the duplicate-read guard (F-64 / ADR-017), which
merely prevents *re-reading* the same file — it never drops a file once read.
Reading is a permanent context tax.

This works for a small task and breaks for any task that must read broadly before
writing. Build run #8 (`live-self-cb6abfc2`, slice C — the ADR-034 engine
integration steps): the leaf read ~50 files; its prompt grew 2.8K → 50K → 107K →
**117K tokens** across 11 steps; at that size its tool-call response was **truncated
by the output-token limit**, `JSON.parse(wc.function.arguments)` threw
`Unexpected end of JSON input`, the step failed, repeated, and the
isomorphic-failure detector blocked it with **0 writes** (the former
implement-read-paralysis issue, resolved by this ADR; narrative in
[iteration 14](../iterations/2026-06-25-21-cascade-and-decide-fixes/index.md)). Runs
#7 and #8 both failed this way on the one mechanism the factory could not build.

**The factory's design has no leaf working-memory bound.** It governs *cross-goal*
memory richly — eval-gated promotion, decay, eviction, consolidation (DESIGN.md
"Foundation decisions") — and ADR-028 even guards against an unbounded host file
blowing the context budget. But nothing governs a leaf's own **intra-execution**
transcript. The design assumed a leaf's read history stays small and never bounded
it. That is the gap this ADR closes.

Truncation *handling* (reading `finish_reason: length`, re-prompting) treats the
symptom. The root cause is that the leaf is structurally doomed to balloon: it has
no mechanism to read a large surface without paying the full token cost, forever.

## Decision

A leaf's working memory is **bounded**, by two complementary mechanisms:

1. **A model-curated scratchpad (the capability).** The leaf gets a `note` tool
   (backed by a per-leaf scratch buffer, not the product worktree): after reading,
   the model distills what matters ("collectTree is called at engine.ts ~563 in the
   success branch of the run() finally; the two new steps go just before it") and
   the **raw read can then be evicted**. The model curates its own working set the
   way a developer keeps notes and closes files. The scratchpad is small, persists
   across steps, and is always in context; raw reads are transient.

2. **An engine read-eviction backstop (the robustness).** Independent of whether
   the model curates well, the engine **caps the transcript's token size**. When it
   crosses a threshold, the **oldest `role: 'tool'` read results are compressed to a
   stub** — `[read src/engine/engine.ts earlier — 812 lines; re-read if needed]` —
   keeping the most-recent reads verbatim and all `note` content. The model may
   re-read an evicted file on demand (the duplicate-read guard is released for an
   evicted path). The leaf therefore **cannot balloon to truncation regardless of
   model behavior**.

The two compose: the scratchpad reduces the *need* to retain raw reads; eviction
guarantees the *bound* even when the model doesn't curate. Belt and suspenders.

This is the leaf-local analogue of the factory's existing memory governance:
DESIGN.md already distills, decays, and evicts *cross-goal* memory; ADR-036 extends
the same "forget with an audit trail" principle to a leaf's *intra-execution*
working set. Eviction is evented (a `context-evicted` signal) so the trail is
honest, mirroring DESIGN.md's "forgetting with an audit trail."

## Alternatives Considered

### (A) Truncation handling only — read `finish_reason`, re-prompt on `length`

**Rejected as the whole answer (kept as a complementary safeguard).** Detecting
`finish_reason: length` and re-prompting/forcing an emit (the
implement-read-paralysis issue's first-cut direction) makes the *crash* recoverable
— but the leaf is still structurally doomed to balloon, so it would re-prompt into
the same wall repeatedly. Treats the symptom, not the cause. Worth doing as a
defensive layer (a truncated tool-call should never be a hard `JSON.parse` crash),
but it does not bound working memory.

### (B) Engine eviction/windowing only (no scratchpad)

**Rejected as insufficient alone.** Auto-evicting old reads bounds the size, but
without a place to *distill* what a read meant, the model loses the substance of
evicted files and must re-read — churning. Eviction is the safety net; it needs the
scratchpad to be the primary mechanism, not the only one. (Kept as half of the
decision.)

### (C) Model-curated scratchpad only (no eviction)

**Rejected as insufficient alone.** A scratchpad lets a *cooperative* model stay
small, but nothing forces it: a model that keeps reading without noting still
balloons. Robustness cannot depend on the model choosing well — the same reason the
hollow-emit gate (engine.ts) is deterministic rather than judge-only. (Kept as the
other half.)

### (D) Range-based `read_file` by default (windowed reads)

**Partially accepted as a cheap complement, not the architecture.** Much of the
bloat is reading whole large files (engine.ts is ~3700 lines) when a region is
needed; defaulting `read_file` to a bounded window with explicit "more" requests
attacks the single biggest source. But it does not bound the *accumulation* of many
windows, and it shifts navigation cost onto the model. A useful tuning, downstream
of the eviction bound — not a substitute for it.

### (E) Spawn a comprehension child for the leaf's local reading

**Rejected.** The comprehend family already produces compact knowledge artifacts
for *regions* (ADR-029), and a leaf consults coverage before fan-out. But making an
`implement` leaf spawn a sub-comprehension for its own local reads blurs the
leaf/comprehend boundary, adds a round-trip and a worktree, and is far heavier than
a scratchpad. The leaf should manage its own working set; cross-region knowledge is
the comprehend family's job.

## Rationale

Working memory is the leaf's scarcest resource and the design never costed it. The
fix mirrors how the factory already thinks about *all* its other memory: distill the
signal, evict the raw, keep an audit trail. A scratchpad is "distill"; eviction is
"forget with a trail." Pairing a capability (curate) with a deterministic backstop
(bound) is the same pattern as the hollow-emit gate (ADR-unnumbered, engine.ts) and
the constitution lints: never let robustness depend on the model behaving — give it
the better tool AND enforce the floor.

It is also the minimal change that makes the factory able to build hard, broad
slices at all: slice C is unbuildable today purely because reading the engine to
modify the engine overflows the leaf. Bounding working memory is the unlock.

## Tradeoffs & Risks

- **Eviction can drop a detail the model still needed**, forcing a re-read (a small
  cost, and the re-read is now allowed). Mitigated by keeping recent reads + all
  notes verbatim and evicting oldest-first; the scratchpad is where the durable
  substance lives, so eviction targets the redundant raw text.
- **A scratchpad the model uses badly** (notes that miss the point) degrades to the
  eviction-only case — bounded but churny. Acceptable: bounded-and-churny beats
  ballooned-and-dead. Skill guidance (`build.md`) teaches good note-taking.
- **The scratch buffer is per-leaf state**, not the worktree — it must never leak
  into the product diff (the hollow-emit/scope gates already guard the worktree;
  the scratchpad lives outside it).
- **A `context-evicted` event adds log volume.** Acceptable; it is the audit trail,
  and it is the signal that surfaces a leaf running hot.

## Consequences for the Build

- **A `note` tool + per-leaf scratch buffer** (engine-side, e.g. in `runStepLoop`'s
  state or a small `src/engine/scratchpad.ts`): `note(text)` appends to a buffer
  that is always injected near the top of the transcript; not a broker write to the
  worktree.
- **Transcript eviction in `runStepLoop`**: a token-size estimate over the
  transcript; when it crosses a threshold, replace the oldest `role: 'tool'`
  contents with a stub carrying the path + line count; emit a `context-evicted`
  event; release the duplicate-read guard for evicted paths so a re-read is allowed.
- **`finish_reason: length` handling** (the (A) safeguard): `translateStepResponse`
  / the transport reads the finish reason; a truncated tool-call is routed to the
  existing re-prompt path (and, post-eviction, the re-prompt has room) instead of a
  thrown `JSON.parse` → `kind:'failed'` → isomorphic block.
- **Skill guidance** in `src/library/skills/build.md` (and `_shared.md`): "read,
  then `note` what matters; you do not need to keep whole files in mind — re-read on
  demand." Teaches the curate habit the scratchpad enables.
- **No new goal type, no CommissionInput change.** This is engine + skill content,
  landable as factory-repo work. Closed the former implement-read-paralysis issue (its
  *ballooning* half; the first-step-truncation remainder was resolved by ADR-039 and
  [iteration 15](../iterations/2026-06-26-00-explore-then-emit-consolidation/index.md))
  and unblocks slice C (the ADR-034 engine integration steps).
