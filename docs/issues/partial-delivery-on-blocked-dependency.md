---
type: issue
title: "A5. A blocked dependency silently kills its dependents with no degraded path"
description: Dependency edges are hard gates with no ship-what's-green partial-delivery mode, so a few blocked modules sink an otherwise-good tree.
tags: [in-run-stall, engine, partial-delivery, collect]
timestamp: 2026-06-25
status: open
kind: idea
severity: medium
---

# A5. A blocked dependency silently kills its dependents with no degraded path

> **Upstream half fixed by [ADR-037](../adrs/ADR-037-degraded-dependency-not-cascade-block.md).**
> A dependency that blocked but produced a usable partial artifact no longer
> hard-blocks its dependents — they proceed on the partial (the run-#9 cascade
> source). What **remains open** is the *downstream* half (the original tiutni
> Run-1 evidence): when children genuinely block and produce nothing, the root
> still has no "collect the green subtree and open a PR for it" ship-what's-green
> mode. That root-level collect behavior is this issue's remaining scope; ADR-037
> only stopped manufacturing blocked dependents from partials. Severity dropped to
> the remaining downstream concern.

## Problem
Dependency edges are hard gates; there is no "ship what's green, report the rest"
partial-delivery mode. A blocked dependency takes down its dependents and the root,
even when most modules are perfect.

## Evidence
Run 1 (tiutni): filler failed → orchestrator `"Blocked because a dependency failed"`
→ root blocked, even though 3 of 5 modules were perfect. The operator hand-fished
the good modules out of the worktree. Source: the gap-audit iteration (docs/iterations/2026-06-24-01-gap-audit-tiutni/index.md).

**Build run #6 (`live-self-a2397f0f`, 2026-06-25) — first read was a MISDIAGNOSIS,
corrected here.** Initial claim: "the engine reset away slice A's passing lint
commits." On verification that was WRONG: (1) the engine `preserveTree`'d on the
block (it never resets — `preserveTree` only emits an event); the `reset: moving to
HEAD` reflog entry was the operator's own teardown command, not the engine. (2) The
real cause: slice A ("docs lint") **never wrote any code** — its tool calls were
`{open_pr: 2}`, `write_file: 0`, and it emitted a 70-char text artifact. Its ✓ in
the tree was a hollow improve-factory/ship wrapper passing, NOT the lint being
built. Slice B wrote 2 files then blocked (`step-loop:failed`); slice C never ran.
So almost nothing real was built — there was no passing work to lose. The genuine
gap run #6 shows is the **empty/no-real-work emit** (a slice "passes" and tries to
ship without doing the work — same class as
[design-arch-empty-artifact-block](design-arch-empty-artifact-block.md)), NOT a
collect/reset bug. The partial-delivery concern (below) stands on the tiutni Run-1
evidence; run #6 does not add to it.

## Proposed direction
**Partial-delivery / ship-what's-green**: when some children succeed and others
block, emit a report that (a) collects the green subtree, (b) lists the blocked
modules + why, so the operator merges the 80% immediately. On a root block the
engine already `preserveTree`s the worktree (the round commits survive on the
branch) — so the recovery primitive exists; what's missing is electing to COLLECT
the verified portion (open a PR for it) rather than treating any blocked child as
all-or-nothing.

## Acceptance hint
A tree with a mix of green and blocked children emits a report that collects the
green subtree and enumerates the blocked modules with reasons — the operator can
merge the good part directly, instead of an all-or-nothing root block.
