---
type: iteration
title: "Iteration 17 — Commission-run fixes: per-commission ceiling, real broker, refusal floor"
description: Three bootstrap-driven fixes surfaced by driving the visual-runtime-verification commission through the front door — the per-commission spend ceiling is enforced, commission:run wires a real broker/sandbox so leaves have tools, and a deterministic refusal floor stops the judge passing a non-delivery as success.
tags: [iteration, factory, commission, front-door, broker, ceiling, judge, verify, bootstrap, self-hosting]
timestamp: 2026-06-27
status: landed on main
---

# Iteration 17 — Commission-run fixes

## Source

Driving the `visual-runtime-verification` commission through the real front door
(`npm run commission:run`). The factory stalled three times; each stall was the
signal for a fix. Hand-built on `main` (interactive build/cleanup), proven by
re-running the same commission.

## What this delivers

Three independent fixes that let a code-writing commission actually run through
the commission front door and fail honestly when it cannot deliver.

### 1. Per-commission spend ceiling is enforced

Before: the engine honored `goal.spendCeilingUsd`, but the listener minted the
root goal without it, so a commission artifact's declared `ceilingUsd` was dead
metadata — every run capped at the $15 engine default. An oversight, not a design
choice (ADR-017 already calls the ceiling "operator-configurable").

After: `CommissionInput` carries optional `spendCeilingUsd`; the front door
(`runIntent`) threads it onto the root goal; `commission:run` maps the artifact's
`ceilingUsd` through. A commission now runs at its declared ceiling.

### 2. commission:run wires a real broker/sandbox

Before: `examples/run-commission.ts` built a bare `new Engine({registry, brain,
store, memory})` with no broker or sandbox, so every leaf had zero tools. The
first live run produced a flat `deliver-intent` node that returned PASS with a
text artifact explaining the leaf had no file access — a false success that built
nothing.

After: the runner uses `buildLiveEngine({store, sandbox})` exactly like
`examples/live-self.ts`, opening an isolated, gitignored worktree and giving
leaves real file/script tools through the broker. The re-run decomposed into a
real subtree (`map-repo` succeeded; leaves read and wrote files).

### 3. Deterministic refusal floor

Before: a leaf artifact that self-describes as a refusal to deliver ("I cannot
deliver", "would be fabrication", "I have no file access") could be read by the
LLM acceptance judge as a coherent artifact and PASS — turning total
non-delivery into a false success.

After: a refusal floor (`src/engine/attempt/delivery-refusal.ts`) runs right
after the deterministic gate, before emission-authority and the judge. A refusal
is non-delivery by construction, so it yields a deterministic FAIL that the
attempt loop treats like any failing check — it retries and, exhausted, surfaces
as a blocker, never a PASS. Preserves the ADR-032 deterministic-floor discipline:
the gate is judge-independent.

## Acceptance criteria

1. A commission declaring `ceilingUsd: 40` runs at a $40 root-goal ceiling, not
   the $15 default. (tests: `tests/listener/listener.test.ts` — ceiling threads
   onto the root goal when declared; stays undefined when omitted.)
2. `commission:run` on a code-writing commission gives leaves real file/script
   tools; the re-run opened a worktree and decomposed into a real subtree.
3. A text artifact that refuses to deliver FAILs deterministically before any
   judge runs. (tests: `tests/engine/attempt-delivery-refusal.test.ts`.)

## Outcome

The `visual-runtime-verification` re-run no longer false-passes: it decomposed,
`map-repo` succeeded, and it reported `✗` with blockers when `freeze-contract`
stalled in its step loop (signature `step-loop:failed`). The commission itself
did not deliver — that stall is captured as separate follow-on work
([freeze-contract-step-loop-stall](../../issues/freeze-contract-step-loop-stall.md)),
and the commission stays open.

Spend on the proving re-run: ~$0.23 (blocked early, well under the $40 ceiling).

## Validation

`npm run typecheck`, `npm run lint`, full `vitest` suite green.
