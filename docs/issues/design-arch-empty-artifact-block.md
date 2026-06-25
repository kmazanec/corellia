---
type: issue
title: "design-arch leaf emits an empty artifact and terminally blocks at the highest tier"
description: A design-arch leaf produced empty text repeatedly, failed the deterministic artifact-present gate at the top tier with no actionable repair, and terminally blocked the whole delivery instead of surfacing why it could not produce.
tags: [engine, brain, design-arch, robustness, partial-delivery]
timestamp: 2026-06-25
status: open
kind: bug
severity: medium
---

# design-arch leaf emits an empty artifact and terminally blocks at the highest tier

## Problem
A `design-arch` leaf can loop to a terminal block by repeatedly emitting an
**empty** artifact. The deterministic gate correctly rejects it
(`artifact-present: Artifact has kind "text" but the text body is empty`;
`arch:sections: Artifact text is empty`), the tier ladder escalates, and at the
highest tier the engine declares "failed at the highest tier with no actionable
repair — it cannot converge" and **blocks**. Two problems compound:

1. **The leaf produced nothing and could not say why.** An empty artifact is not a
   normal failure mode — the producer either truncated, mis-parsed its own output,
   or silently dropped content. The block message is generic ("no actionable
   repair"); it does not surface the actual cause, so the operator cannot tell a
   token-starvation from a parse-drop from a genuine can't-design.
2. **One blocked sibling sank an otherwise-good delivery.** The sibling `a1`
   produced a complete, judge-passed ADR (ADR-034). Because `a2` blocked
   terminally, the root `deliver-intent` blocked and **no PR was opened** — the
   good ADR had to be salvaged by hand from the orphaned worktree. This is the
   same class as [partial-delivery-on-blocked-dependency](partial-delivery-on-blocked-dependency.md):
   a degraded delivery (ship the passing sibling, report the blocked one) would
   have been far better than an all-or-nothing block.

## Evidence
Design-first `live:self` run, intent `live-self-8ac028ee` (2026-06-25, $0.70).
Event sequence for `a2`: `decided → deterministic-checked(pass=false, empty
artifact, gating) → ... → blocked`. The block brief: *"Goal 'ADR: OKF doc
conformance and finding-routing as factory-enforced rules' failed at the highest
tier with no actionable repair — it cannot converge."* The root then carried the
blocker and opened no PR despite `a1` passing `critique-doc` and the root passing
`judge-integration`. Producer path: `produce()` in `src/brains/llm.ts` (returns
`{ kind: 'text', text }`); the empty-text case is what the gate catches.

## Proposed direction
(Rough, not committed — two separable fixes.)
- **Empty-artifact diagnosis:** when `produce()` returns empty text, treat it as a
  distinct, diagnosable failure — capture the raw completion (was it truncated? a
  refusal? all-fenced-blocks-that-parsed-to-nothing?) into the block brief / event,
  so the block says *why* it is empty, not just "no actionable repair." Consider a
  targeted re-ask ("you returned no content; emit the full document body") before
  escalating, analogous to the decide/judge re-ask.
- **Degraded delivery:** let a `deliver-intent` ship the passing siblings and
  report the blocked one rather than blocking the whole tree (the partial-delivery
  gap). At minimum, a blocked leaf whose siblings passed should not strand their
  verified output in an un-collected worktree.

## Acceptance hint
A `design-arch` (or any make) leaf that emits empty text surfaces a specific,
actionable reason in its block (truncation / refusal / parse-drop), not a generic
"no actionable repair"; AND a tree where one sibling blocks but others pass does
not strand the passing siblings' verified artifacts (degraded delivery or, at
least, collected output + a clear partial-delivery report).
