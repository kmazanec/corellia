---
type: iteration
title: "Iteration 13 — Building the milestone loop: stuck point + factory-first experiment"
description: The chicken-and-egg of building the loop that gives deliver-intent the ability to iterate — steps 1–6 hand-built + ADR-033 merged; the factory-first experiment stalled upstream on a decide-robustness gap.
tags: [iteration, milestone-loop, adr-031, adr-032, adr-033, deliver-intent, bootstrap, decide-robustness, chicken-and-egg]
timestamp: 2026-06-24
status: landed-on-main
---

# Iteration 13 — Building the milestone loop: stuck point + factory-first experiment

**Date:** 2026-06-24 (run record 2026-06-25) · **Status:** Landed on main (steps 1–6
+ ADR-033 merged; steps 7–8 unbuilt)

This iteration owns the milestone-loop spec. The full build-ready spec — exact files,
contract shapes, engine surgery, constitution clause, deterministic floor, guardrails,
and the smallest-first build sequence — lives alongside this index:

→ **[spec.md](./spec.md)** — Milestone loop: deliver-intent iterates to an MVP
(ADR-031 / ADR-032; the original `docs/milestone-loop-SPEC.md`).

**Steps 7 (live proof of the flat root-loop via `live:self`) and 8 (depth-capped
slice-nesting) are unbuilt — filed as issues.**

## The chicken-and-egg stuck point (recorded per bootstrap discipline)

The milestone loop (ADR-031/032) is the feature that gives `deliver-intent` the
ability to iterate (decide→split→integrate→assess→re-decide) instead of being
single-pass. But that means **the feature being built is the very capability whose
absence makes the build hard**: implementing the loop is large, multi-round,
integration-heavy engine surgery across `src/contract` + `src/engine` + `src/library`
(6 dependent, test-gated steps) — exactly the shape today's single-pass
`deliver-intent` blocks on (proven by the word-count repro in iteration 12, and by
tiutni Run 1). So "have the factory build its own looping ability" is genuinely
circular: the thing that would let it succeed is the thing under construction.

## What was hand-built (the fallback)

Steps 1–6 of `docs/milestone-loop-SPEC.md` (now [spec.md](./spec.md)) were hand-built
by a harness-orchestrated builder agent in an isolated worktree
(`build/milestone-loop`, off `main`): contract scaffolding + lint, the
behavior-preserving `runRound` extraction, the criteria/judge types + deterministic
floor, `commitRound`/`diffBodiesWithinScope`, `runMilestone` single-round, then the
four-guard loop. Suite green (1479 pass; the 2 pre-existing daemon-spawn failures
excepted). This branch is the FALLBACK — it is NOT yet merged.

(Note: ADR-033 — budget is a non-steering safeguard — and steps 1–6 were
subsequently merged to main; steps 7–8 remain unbuilt.)

## The discipline gap, named honestly

Hand-building *first* skipped the bootstrap loop's step 1 ("prefer the factory; let
it stall; the stall is the signal"). The correction (Keith's call): before accepting
the hand-built code, **commission the full feature through the real front door
(`live:self`) off `main` (which lacks the loop), and watch where it stalls.** The
factory builds against a codebase WITHOUT the loop, the hand-built branch stays
isolated so the experiment is uncontaminated, and we compare. The stall — or the
surprise — is the diagnostic that should have been produced first.

## Run record (2026-06-25, intent `live-self-93cbaae0`, $1.01, 73.9% cache)

The factory **blocked at the FIRST decide call on the root goal** — it never split,
never reached the multi-round integration wall we predicted. Event sequence:
`goal-received → risk-classified → pattern-consulted → decided(block)`. Blocker:

> Decision-maker could not produce a valid decision: Expected double-quoted
> property name in JSON at position 1546 (line 1 column 1547)

**Root cause (diagnosed from the event log + `src/brains/llm.ts`, not theorized).**
`brain.decide` embeds the full goal spec into the decide prompt
(`goalContext`, `llm.ts:781`: `Spec: ${JSON.stringify(goal.spec, null, 2)}`). Our
`CORELLIA_FEATURE` was a ~1583-char intent dense with `→` arrows, parentheses,
nested quotes, and code snippets. Asked to emit a JSON decision while that giant
string sat in context, the model broke its own JSON well-formedness at ~position
1546 (≈ the embedded spec length) — and did so on BOTH the first call AND
`callJson`'s schema-constrained re-ask (`llm.ts:725-760`), so it blocked. The block
is the factory's law working correctly (a node that can't decide responsibly
blocks) — but the *cause* is a decide-robustness gap, not a reasoning failure.

**The honest finding: this experiment did NOT test "can the factory build the
loop."** It stalled UPSTREAM of that question, on a transport/prompt-shape bug. The
diagnostic is real but different from the one predicted:

→ **GAP (decide-robustness): a large, complex root intent makes `brain.decide`
emit malformed JSON and the tree blocks at decision #1.** This is the same CLASS as
prior live:self transport bugs (model/transport issues masquerading as logic).
Likely fixes to consider (NOT yet built): (a) don't inline the full free-text spec
into the decide prompt — summarize/reference it, or point the model at the spec
file via comprehension rather than echoing it; (b) a JSON-repair pass before
declaring a parse failure; (c) more re-ask attempts with a shrinking/escaped spec.
This belongs in its own iteration — it is orthogonal to the milestone loop.

## Hygiene

Strange-loop isolation HELD. Primary checkout clean after the run (the "NO —
investigate" warning was the untracked `media/video.zip`, flagged at start too);
hand-built `build/milestone-loop` untouched; the orphaned blocked
`.corellia/worktrees/live-self-93cbaae0-*` worktree + its `tree/*` branch were
torn down by hand (a blocked run does not auto-collect its worktree). Note: the
`live:self` tree renderer shows ALL goals in `out/events.jsonl` (an accumulating
JSONL store), so prior-run goals (ADR-029, format-duration, format_usd) appeared in
the tree output — they are NOT part of this run; only the last `deliver-intent` is.

## Status of the milestone loop

Steps 1–6 (suite green) and ADR-033 are merged to main; steps 7 (live proof of the
flat root-loop) and 8 (depth-capped slice-nesting) are NOT built — filed as issues.
The factory-first attempt did not reach a verdict on the loop itself; it surfaced a
separate, real upstream decide-robustness gap instead.
