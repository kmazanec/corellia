---
id: F-63
title: "Improvement loop v1"
iteration: 06-loop
type: implement
intent: production
status: Not started
dependsOn: [F-61]
contracts: [ADR-027, ADR-025, ADR-003]
---

# Feature: Improvement loop v1

**ID:** F-63 · **Iteration:** 06-loop · **Status:** Not started

## What this delivers (before → after)
**Before:** `Report.blockers` and `blocked` events are recorded and read by no
one; `improve-factory` is a thin card with a deferred harness.
**After:** a completed run's blockers mint one `improve-factory` commission
that ends in a project-memory write or a factory-repo PR — under a standing
envelope that can never starve product work.

## Reading brief
- ADR-027 (decision + tradeoffs)
- ADR-025 (push_branch/open_pr tools — F-61's output, hard dep)
- `src/listener/listener.ts` — run-completion path; `Report.blockers` surface
- `src/library/types/improve.ts` — `improve-factory` goal-type card
- `src/contract/brief.ts` — `StandingEnvelope` shape (F-62 barrier)
- `src/contract/events.ts` — `FactoryEvent` union (`blocker-routed` member)
- `src/eventlog/projections.ts` — exhaustive switches (three consumers)
- `DESIGN.md` improvement-loop section (generality routing rationale)
- F-61 tool implementations (`push_branch`, `open_pr`)

## Dependencies (must exist before this starts)
F-61 (`push_branch` and `open_pr` tools) — this feature's harness uses them
to open factory-repo PRs for repo-agnostic improvements.

## Contracts touched
- Event log (source of truth: ADR-003, `src/contract/events.ts`) — adds
  `blocker-routed { at; goalId; blocker; commissionId }`; all three exhaustive
  projection switches extended.
- `StandingEnvelope` (source of truth: ADR-027, `src/contract/brief.ts`) —
  consumed as the admission gate on the daemon's config surface; improvement
  commissions run only against its headroom.
- `improve-factory` goal-type (source of truth: `src/library/types/improve.ts`)
  — grants renamed `factory-repo.*` → `repo.*` (barrier from F-61); deep
  harness content filled in (generality judgment, routing logic, PR discipline,
  "the architecture is locked" constraint).

## Acceptance criteria
1. A run completing with blockers mints exactly ONE `improve-factory`
   commission carrying the blocker texts and the run's event-log pointer; one
   `blocker-routed` event emitted per blocker; a blocker-free run mints
   nothing.
2. AC-21 end-to-end: the originating run continued past its blockers; no
   factory file changes mid-run.
3. The harness routes by generality (scripted both ways): a repo-specific
   lesson terminates in a memory write, no PR; a repo-agnostic fix terminates
   in a branch + PR on the factory repo via `push_branch`/`open_pr`.
4. Envelope admission: improvement commissions run only with envelope headroom
   AND an empty product queue; an exhausted envelope parks them (visible in
   `GET /status`); product intents are never delayed by improvement work.
5. Envelope decrements per improvement tree (budget + spend); top-up is
   operator config only; improvement runs never mint further improvement
   commissions (no runaway loop — pinned by test).

## Testing requirements
- Scripted end-to-end: mint → route → PR against a bare-repo fixture (real
  `push_branch`/`open_pr` stub transport, real event-log).
- Envelope admission units: headroom check, product-queue priority, park-on-
  exhausted.
- Harness assertions run against the REAL `improve-factory` skill file, not
  synthetic stand-ins (iteration-05 lesson).
- Runaway-loop guard: a scripted improvement run produces no further
  improvement commission.

## Manual setup required
Factory-repo `GITHUB_TOKEN` for live runs. None required for scripted tests
(injectable transport + bare-repo fixture).

## Build plan (approved)
- [ ] Chunk 1 — Mint-on-complete + `blocker-routed` events in the listener:
  extend run-completion path in `listener.ts` to inspect `report.blockers`;
  non-empty → mint one `improve-factory` commission + emit one
  `blocker-routed` event per blocker (the member and its projection switch
  arms are frozen barrier work — this chunk consumes them); satisfies AC 1, 2; tests:
  `tests/listener/mint-on-complete.test.ts`,
  `tests/eventlog/projections.test.ts`; contract touchpoint: `blocker-routed`
  event.
- [ ] Chunk 2 — `StandingEnvelope` admission mechanics: gated commission path
  checks envelope headroom and product-queue emptiness; exhausted envelope
  parks (surfaced in `FrontDoorStatus`); envelope decrements per improvement
  tree; satisfies AC 4, 5; tests: `tests/listener/envelope-admission.test.ts`;
  contract touchpoint: `StandingEnvelope`.
- [ ] Chunk 3 — `improve-factory` deep harness: reads event-log pointer;
  generality decision (repo-specific → memory write; repo-agnostic → factory-
  repo PR via `push_branch`/`open_pr`); PR discipline (prompts/skills/scripts/
  eval-sets/type-defs only — "architecture is locked" enforced); satisfies
  AC 3; tests: `tests/library/improve-factory-harness.test.ts` against the
  real skill file; contract touchpoint: `repo.branch`, `repo.pr` grants.
- [ ] Chunk 4 — End-to-end scripted suite vs bare-repo fixture: blocker run
  → mint → envelope gate → harness → PR; satisfies AC 1–5; tests:
  `tests/integration/improvement-loop.test.ts`.

### Test strategy
Scripted tests drive real listener code with a mock engine and a bare-repo
fixture for the PR path. Harness tests use the actual `improve-factory` skill
file (not a synthetic stand-in) to catch prompt-content regressions. The
runaway-loop guard is a targeted unit: a completed improvement tree must not
trigger a second mint.

### Contract touchpoints
`blocker-routed` is a frozen barrier event member. `StandingEnvelope` is the
admission contract shared with F-62's daemon config. Both require ADR-027
sign-off to change.

### Manual setup
None beyond env vars for operator-run live demos.

### Risks
- Harness quality is the product — prompt-content blind spot addressed by
  asserting against the real skill file (iteration-05 lesson).
- Runaway-loop guard: improvement runs must never set `report.blockers` in a
  way that re-triggers the mint path; pinned by test.
- Generality judgment at default tier (high): the ladder allows escalation if
  the model is uncertain; builder must wire the ladder on the `improve-factory`
  card.

## Implementation notes

### Generality-routing decision mechanism
The routing decision lives entirely inside the `improve-factory` skill harness
(not in the listener). The listener is purely a routing point — it mints one
commission per run carrying blocker texts and the `eventLogPointer` (the
originating goalId). The harness reads the event log via `event-log.read`,
diagnoses the root cause, and makes a binary decision:
- **Repo-specific lesson**: call `promote-memory` (project-memory write); emit
  no branch or PR. The `memory-written` event in the log is the completion proof.
- **Repo-agnostic fix**: call `push_branch` then `open_pr` on the factory repo.
  The `pr-opened` event is the completion proof. The architecture-locked constraint
  is enforced by the factory repo's CI constitution check (not by the harness itself).
When the model is uncertain, the tier ladder allows escalation (default `high`,
ladder `['high', 'high']` — same tier, but signals the loop is allowed to retry
with the strongest available model on the next attempt).

### Where envelope decrement happens
The `envelopeSpentUsd` counter lives on the `Listener` instance and is
incremented by `runImprovementIntent()` after each improvement tree completes
(whether or not the run succeeded). The decrement is nominal (1 unit per tree)
in v1 — actual USD cost tracking requires `Usage.costUsd` from the engine, which
is wired in a future iteration. The `spendCeilingUsd` comparison is the admission
gate in `hasEnvelopeHeadroom()`. Top-up is operator config only: the listener
never auto-increments the ceiling; operators must restart the daemon with a
higher `STANDING_SPEND_CEILING_USD` value.

### How the runaway-loop guard is enforced
The guard is structural, not heuristic: `isImprovementCommission(input)` checks
whether the originating commission id starts with the `improve-` prefix. The
`mintImprovementCommission()` function is only called when this check returns
`false`. An improvement commission that itself reports blockers when it completes
will NOT re-trigger the mint path because `runImprovementIntent()` calls
`runIntent()` with the improvement commission as input, and `runIntent()` checks
`isImprovementCommission(input)` before minting. This is pinned by
`tests/integration/improvement-loop.test.ts` (AC 5 — runaway-loop guard test).

