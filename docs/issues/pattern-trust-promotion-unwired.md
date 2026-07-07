---
type: issue
title: Split-memo trust promotion has no production caller — the flywheel never pays off
description: Memos are recorded and consulted as provisional hints, but pattern-trust promotion (provisional → trusted, human signoff, trusted short-circuit) is dead code in a running system.
tags: [engine, flywheel, split-memo, pattern-trust, human-gate]
timestamp: 2026-07-07
status: open
kind: bug
severity: medium
---

# Split-memo trust promotion has no production caller — the flywheel never pays off

## Problem
The structure flywheel is half-wired: recurring splits are recorded and re-read as
provisional hints, but `pattern-trust.ts` — the provisional→trusted promotion, the
one-time human signoff DESIGN.md names as an authority-gap act, and the
trusted-memo short-circuit (walk verbatim, skip fresh derivation) — is called only
by its own test. No running system can ever promote a memo, so every matching
subtree pays full fresh-derivation cost forever and the design's central
cost/reproducibility payoff ("runtime chaos that proves itself becomes
determinism") never fires. The `promoted-to-trusted, signed_off_by` provenance
event exists in prose only.

## Evidence
- capability-scout sweep (2026-07-07): "provisional→trusted promotion has no
  production caller (src/engine/pattern-trust.ts called only by its test); the
  trusted-memo short-circuit is dead in a running system."
- DESIGN.md "Memoized splits — hybrid promotion authority" (autonomous →
  provisional; human signoff → trusted; demotion deliberate).
- The projectPatternTrust projection already exists (src/eventlog/projections.ts).

## Proposed direction
Wire the existing pieces end to end: recurrence detection over the event log
proposes promotion candidates (the `propose-pattern` type already exists);
promotion-to-trusted becomes an operator act through the front door (a brief or a
CLI `corellia trust <memo>` appending the signoff event — never automatic, per the
authority gap); the decide path consults trust state and walks a trusted memo
verbatim, emitting an event that records the short-circuit. Demotion on golden
divergence can wait for the calibration harness; a manual demote command is enough
to start.

## Acceptance hint
In a test (and then a live run): the same spec-shape run twice yields a
recurrence-backed promotion candidate; a signoff act promotes it with
`signed_off_by` in the log; a third run walks the trusted memo verbatim and the
log shows the skipped fresh derivation.

---

> **Fixed (2026-07-07, branch `issue/pattern-trust`; pending live proof).** The
> split-memo flywheel is now wired end to end from the daemon through an operator
> CLI.
>
> **Delta from the issue's framing — the gap was wider than "promotion has no
> caller."** The issue assumed memos were already "recorded and consulted as
> provisional hints" in a running system, with only the promotion tip dead. In
> fact the *entire* flywheel was dead in production: `buildLiveEngine` never
> constructed a `PatternStore`, so `Engine`'s `patterns` was always `undefined`
> and the consult / record / short-circuit paths all silently no-opped. No
> production code anywhere (`src/`, `examples/`, `scripts/`) built a pattern store
> — only tests did. The engine-level machinery itself was already complete and
> tested (the trusted-memo verbatim walk, the `pattern-consulted` short-circuit
> event, the provisional `patternHint`, the outcome record — all in
> `src/engine/decision/phase.ts`, `split-dispatch.ts`, and `flywheel.test.ts`).
> So the honest wiring was: build the store in production, then add the operator
> promotion/candidate surface.
>
> 1. **Production wiring (the load-bearing fix).** `buildPatternStore(store)`
>    (`src/daemon/config.ts`) builds the flywheel's store on the daemon's own
>    substrate — `PgPatternStore` when `DATABASE_URL` is set (a shared table the
>    CLI and daemon both read/write), else an in-memory store **rehydrated from
>    the JSONL event log** via the new `projectPatternMemos` projection
>    (`src/eventlog/projections.ts`, joining `decided` + `pattern-recorded` +
>    `pattern-trust-signed` on `goalId`). The daemon builds it in `start()` and
>    threads it into `buildLiveEngine({ …, patterns })`, so recurring splits now
>    actually memoize in a running system. Both substrates converge the CLI and
>    daemon on the same durable state (Pg rows, or the shared append-only log).
>
> 2. **Promotion path — the authority gap, as an operator act.**
>    `corellia trust "<shape>" --by <name>` and `corellia distrust "<shape>"
>    --by <name>` (`scripts/corellia.ts` → `src/eventlog/patterns-cli.ts`) call
>    the existing `promotePatternTrust`, which appends the `pattern-trust-signed`
>    event (with `signer` provenance) *before* mutating the store. `--by` is
>    mandatory — an anonymous promotion is refused (exit 2). Nothing automatic
>    promotes; no eval, recurrence count, or outcome stat can. Demotion mirrors
>    it (trusted → provisional), for deliberate review after golden divergence.
>
> 3. **Consult path — already built, now actually reached.** With a real store
>    threaded in, the decide path walks a trusted memo verbatim (skipping fresh
>    derivation) and records the short-circuit as the `pattern-consulted`
>    (`status: 'trusted'`) event for replay/provenance — the pre-existing
>    `phase.ts` machinery, dead until now for lack of a store. A provisional memo
>    stays a suggestion the split eval still judges.
>
> 4. **Candidate surfacing.** `corellia patterns` lists every memo with its trust
>    plane and recurrence/outcome stats (uses / ok / fail), sorted by exercise, so
>    an operator can see what is worth trusting. `promotionCandidates()` exposes
>    the provisional-and-recurred shortlist as a reusable helper.
>
> **Deviation from the sketch:** the issue proposed recurrence detection driving
> `propose-pattern` to auto-create provisional memos. That already happens
> implicitly — the engine records a provisional memo on first split
> (`recordSplitPattern`), so a separate `propose-pattern` caller is not needed for
> the flywheel to turn; it remains available for log-driven abstraction of shapes
> that were never split directly. Recurrence *surfacing* is delivered via
> `corellia patterns` rather than an automated candidate feed.
>
> Mechanism: `src/daemon/config.ts` (`buildPatternStore`), `src/daemon/daemon.ts`
> (async `start()` wiring + SIGTERM close), `src/daemon/live-engine.ts`
> (`patterns` option threaded to the engine), `src/eventlog/projections.ts`
> (`projectPatternMemos`), `src/substrate/memory-pattern-store.ts`
> (`InMemoryPatternStore.fromMemos`), `src/eventlog/patterns-cli.ts` +
> `scripts/corellia.ts` (the operator commands). Proven at the ownership
> boundaries: `tests/eventlog/patterns-cli.test.ts` (promotion event + provenance,
> anonymous-refusal, unknown-shape, demotion, list, candidates),
> `tests/eventlog/projections.test.ts` (`projectPatternMemos` reconstruct +
> rehydrate round-trip), `tests/daemon/config.test.ts` (JSONL rehydration; the
> full operator flow — run records a split, CLI `trust` appends to the shared log,
> a restarted daemon rehydrates it as `trusted`). The engine-level verbatim-walk
> and record are already covered by `tests/engine/flywheel.test.ts`. A live run
> — same spec-shape twice, an operator `corellia trust`, a third run walking the
> memo verbatim — is the confirming proof.
