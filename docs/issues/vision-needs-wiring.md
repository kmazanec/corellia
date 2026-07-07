---
type: issue
title: Screenshot-judge call site never sets needs.vision
description: The model catalog resolves needs.vision, but the ADR-042 screenshot-judge call site doesn't declare it, so visual verification can land on a non-vision model.
tags: [brain, model-catalog, vision, critique-ui, judge]
timestamp: 2026-07-07
status: open
kind: bug
severity: low
---

# Screenshot-judge call site never sets needs.vision

## Problem
ADR-044's capability-tagged catalog resolves `needs.vision` correctly, but the
ADR-042 visual-verification call site — the judge that looks at captured
screenshots — never sets it. The seam was recorded in ADR-044 as known-unwired.
Until it is set, a screenshot judgment can resolve to a text-only model, which
either errors or (worse) judges images it cannot see.

## Evidence
- ADR-044 records the gap explicitly; iteration 21 "still open" list
  (docs/iterations/2026-07-06-19-cloud-ready-wave/index.md) names "vision wiring
  gap: catalog resolves needs.vision but the ADR-042 screenshot-judge call site
  doesn't set it."

## Proposed direction
Set `needs: {vision: true}` on the brain request wherever screenshot inputs are
attached to a judge call, and add a test asserting a vision-needing judge request
resolves only to vision-capable catalog entries.

## Acceptance hint
The screenshot-judge path declares vision in its needs; a unit test proves the
resolved model for that call site is vision-capable, and a non-vision catalog
band is skipped past rather than selected.

---

> **Fixed (2026-07-07, branch `issue/small-fixes`; pending live proof).** The
> acceptance-judge call site (`src/engine/milestone/round-assessment.ts`) now sets
> `needs.vision` when the round's criteria hand the judge an image. A new predicate
> `criteriaNeedVision` (`src/library/capture-vision.ts`) returns true when any
> `{ capture }` criterion names a declared, IMAGE-producing capture —
> `render-document` or `screenshot-ui` — and false for a `drive-endpoint`
> text-body capture or a pure script/file criterion. When true, `judgeCtx.needs =
> { vision: true }`, which the ADR-044 catalog resolves only to a vision-capable
> model (falling up a band if the demanded band has no vision model). Absent an
> image-producing capture the judge resolves with empty needs, exactly as before —
> additive and byte-identical for every goal that uses no runtime/visual criteria.
>
> **Judgment call — where "needs vision" is decided.** The vision flag keys off the
> declared capture KIND, not the presence of a screenshot generically: only
> image-producing captures force vision. `drive-endpoint` produces a text response
> body any model can read, so it does not demand a vision model (and does not
> throw when no vision model bands where the tier demands). This keeps the need as
> tight as the judge input actually requires.
>
> **Judgment call — the acceptance judge only.** The seam wired is
> `judge-acceptance` (the ADR-042 ship-gate judge that receives captured output),
> not `judge-integration`; ADR-042 §5 is explicit that captured output flows to the
> acceptance judge. The integration judge does not receive captures, so it is left
> untouched.
>
> Unit-proven at two seams: the predicate itself
> (`tests/library/capture-vision.test.ts` — image vs text-body vs script/file,
> undeclared-capture, no-captures) and the call site
> (`tests/engine/milestone-round-assessment.test.ts` — an image-capture criterion
> sets `needs.vision`, and `resolveModel` for that ctx returns a vision-capable
> catalog entry; pure script/file criteria leave `needs` unset). A live run whose
> criteria include a `screenshot-ui` capture landing on a vision model is the
> confirming proof.
