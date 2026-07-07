---
type: issue
title: Golden candidates never receive outcome labels — calibration data is being lost
description: ADR-024 captures a golden-candidate event at every judge verdict, but nothing wires exogenous outcomes (PR merged/rejected, criteria later proven wrong) back to the candidates, so the calibration set can never be labeled.
tags: [engine, eventlog, golden, calibration, judge]
timestamp: 2026-07-07
status: open
kind: bug
severity: high
---

# Golden candidates never receive outcome labels — calibration data is being lost

## Problem
`appendGoldenCandidate` (src/engine/judge-support.ts) records a candidate at every
judge verdict on non-scripted runs — artifact digest, rubric digest, verdict, tier,
model. ADR-024's premise is that outcome labels "arrive later from exogenous
signals (merge/rejection)". Nothing delivers them: no event type carries a label,
no path correlates a PR merge/rejection or a human verdict back to the candidates
of the tree that produced it. Unlabeled candidates can never become a golden set,
so the exact "unrecoverable cost" ADR-024 warns about — runs happening today whose
ground truth evaporates — is being paid silently on every live run.

## Evidence
- Capture side exists: `appendGoldenCandidate` in src/engine/judge-support.ts, the
  `goldenCandidates` projection at src/eventlog/projections.ts:794, and
  tests/engine/golden-capture.test.ts.
- Label side absent: grep for label/outcome ingestion over src/ and scripts/ finds
  no writer; docs/adrs/ADR-024-golden-capture-as-events.md defers the ceremony but
  the label *ingestion* path was never split out as its own work item.

## Proposed direction
A small, append-only labeling path, exogenous by construction (never another
eval): a `golden-label` event `{candidateRef | treeId, outcome, source, note?}`
appended (a) by a CLI (`corellia label <tree> merged|rejected|...`) for human
verdicts, and (b) later by whatever observes PR merge/rejection (the listener's
merge channel, when it exists). The projection joins labels to candidates by tree
and goal. Keep promotion-to-golden-set a separate deliberate ceremony — this issue
is only about not losing the labels.

## Acceptance hint
After a live run ends in a merged (or rejected) PR, one command (or one observed
event) attaches that outcome to the run's captured candidates, and the
`goldenCandidates` projection shows labeled pairs ready for curation.

---

> **Fixed (2026-07-07, branch `issue/golden-calibration`; pending live proof /
> operator use).** The append-only label ingestion path is built exactly as the
> proposed direction sketched: labels are exogenous by construction — a new event
> type, a CLI writer, and a projection join — never produced by any eval.
>
> **Mechanism.**
> - **Event:** a `golden-label` member `{ goalId, outcome, source, note? }` added
>   to the `FactoryEvent` union (`src/contract/events.ts`) and validated in the
>   parser (`src/contract/event-parser.ts`, `LABEL_OUTCOMES`). `outcome` is one of
>   `merged | rejected | confirmed | refuted`; `source` records who/what delivered
>   it (an operator, a future PR-merge listener). Rendered in the log viewer
>   (`src/eventlog/render.ts`).
> - **CLI:** `corellia label <tree> <outcome> [--note ...] [--source ...] [<path>]`
>   appends one `golden-label` to the store the daemon writes
>   (`src/eventlog/label-cli.ts`, dispatched from `scripts/corellia.ts`). The tree
>   ref is the `goalId` every `golden-candidate` already carries.
> - **Projection join:** `goldenCandidates` (`src/eventlog/projections.ts`) now
>   joins each candidate to its tree's `golden-label` by `goalId` (last label
>   wins, so a re-label corrects), exposing `candidate.label`. A companion
>   `labeledGoldenCandidates` returns only the labeled pairs — the curation-ready
>   set.
>
> **Deviation from the sketch:** labels are keyed by `goalId` (the tree/candidate
> reference the log already uses everywhere) rather than a synthetic
> `candidateRef` — a tree's candidates and its outcome share one join key, so one
> `label <tree>` command labels every candidate that tree produced, which is the
> unit an operator actually knows about at merge time. The PR-merge listener path
> is left as the future `source` (the event and projection already accept it); only
> the human-verdict CLI writer is built now.
>
> **Tests** (`npx vitest run` green): `tests/eventlog/projections.test.ts` (label
> join by goalId, unlabeled trees, re-label override, `labeledGoldenCandidates`
> filtering); `tests/eventlog/label-cli.test.ts` (arg parse, event append with a
> deterministic clock, note omission, malformed exit code);
> `tests/eval/golden-calibration.test.ts` end-to-end (candidate + parsed label →
> projection join → curate → replay). `npx tsc --noEmit` and `npm run lint` clean.
> A live run whose PR an operator merges/rejects, then `corellia label`, is the
> confirming proof.
