---
type: issue
title: "Judge passed a refusal-to-deliver as a valid artifact; report came back PASS"
description: A leaf that explicitly refused to deliver ("I cannot produce this, I have no file access") was judged a PASS and the root report returned PASS / no blockers — a false-success verification hole that masks total non-delivery.
tags: [engine, judge, verify, false-pass, robustness, acceptance]
timestamp: 2026-06-27
status: open
kind: bug
severity: high
---

# Judge passed a refusal-to-deliver as a valid artifact; report came back PASS

## Problem
A leaf produced an artifact whose entire content is a reasoned explanation that
it **cannot** deliver the goal. `judge-acceptance` (and/or the satisfy-path
judge) returned **pass** on it, and the root `deliver-intent` report came back
**PASS / no blockers**. A refusal-to-deliver is the clearest possible non-
delivery, yet it was scored as success. This is a false-pass: the most dangerous
verification outcome, because it reports "done" when nothing happened.

The deeper issue: the judge appears to have rewarded a well-argued *meta*
artifact ("here is why I can't, and what would unblock me") instead of checking
the artifact against the acceptance criteria (does the `runtime` AcceptanceCheck
variant exist? does the fixture pass/fail? was the ADR written?). A blocked goal
should surface as a **blocker**, not a PASS.

## Evidence
`visual-runtime-verification` first live run (2026-06-27). The artifact text
opens: "The current artifact is correct, and I cannot improve it into a
deliverable without the one thing it identifies as missing: read access to the
real codebase." Trace stats: `deliver-intent: 1 attempt, 1 pass, 3 failures, 1
repair`. Report: PASS, no blockers. Nothing was built; the repo was untouched.
(The leaf had no tools — see
[commission-runner-wires-no-broker](commission-runner-wires-no-broker.md) — but
that explains the refusal, not why the judge passed it.)

## Proposed direction
The acceptance judge must distinguish "the artifact satisfies the criteria" from
"the artifact is a coherent statement about the work." A produced artifact that
self-describes as non-delivery, or that contains no evidence of the declared
acceptance criteria being met, must FAIL or route to a blocker — never PASS.
Consider: (a) a deterministic floor check that a code/file deliverable actually
produced files when the spec demands files (tie to ADR-032's deterministic-floor
discipline); (b) a judge guard that treats first-person refusal/blocked language
as a non-pass signal; (c) making "produced no in-scope changes" a hard
non-delivery for `deliver-intent` whose spec requires code.

## Acceptance hint
A leaf artifact that refuses to deliver, or that produces no in-scope file
changes when the spec requires code, results in a FAIL/blocker — not a PASS.
A regression test pins this: feed the acceptance judge a refusal artifact
against a code-delivery spec and assert non-pass.
