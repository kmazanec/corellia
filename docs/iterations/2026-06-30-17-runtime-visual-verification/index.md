---
type: iteration
title: "Iteration 19 — Runtime/visual verification rung (ADR-042) + judge-input bound + run observability"
description: The factory can now verify an acceptance criterion the script runner cannot — a rendered document, a running UI, or a driven endpoint — via a third {capture} AcceptanceCheck arm backed by declared captures, with the same deterministic floor and safety discipline as declared scripts. Also bounds the split-integration judge input that had crashed a multi-round delivery at the 8MB provider ceiling, and makes a live commission run observable (per-run event logs + a live watcher).
tags: [iteration, engine, verification, visual, runtime, capture, acceptance-criteria, safety, judge, observability, self-hosting]
timestamp: 2026-06-30
status: landed on main
---

# Iteration 19 — Runtime/visual verification rung

## Source

The starred gap from the verification gap-audit, commissioned as
`visual-runtime-verification`: the factory's only verification rung was the
declared script runner, so any acceptance criterion a script cannot reduce to an
exit code — does a rendered document place a value correctly, does a running UI
show the right thing, does a live endpoint behave when driven — silently went
unverified.

The commission was run through the factory's own front door (run 9b). It
decomposed the goal correctly and authored **ADR-042** before crashing at round
integration on a provider input-size limit. Per the bootstrap loop, the stuck
point was recorded, the crash was fixed, and the design was finished by hand on
main — the ADR salvaged from the preserved tree worktree, the implementation
built against it.

## What this delivers

### 1. Runtime/visual verification rung (ADR-042)
A third `AcceptanceCheck` arm, `{ capture }`, alongside `{ script }` and
`{ file, anchor? }`. A capture names a runtime output declared up front in
`SandboxConfig.declaredCaptures` (parallel to `declaredScripts`): the model
selects one by name when authoring a criterion; it never supplies an address,
path, or command. Three capture kinds — `render-document`, `screenshot-ui`,
`drive-endpoint` — each with a fixed set of declared parameters.

- **Deterministic floor.** `criterionToCheck` maps `{ capture }` to
  `captureSucceeded`: a criterion of this kind cannot pass unless the capture
  actually ran and produced non-empty output — the exact analogue of
  `fileContains` failing on a missing file, before any judge runs.
- **Well-formedness gate.** `criteriaWellFormed` now rejects a `{ capture }`
  criterion whose name is not in the declared set, at author-time, the same way a
  prose rubric line is rejected.
- **Safety, machine-checked.** The capture runner is worktree-pinned, runs render
  and start scripts through the scrubbed-env declared-script runner, is
  time-bounded, and reaches only `127.0.0.1` on a declared port — there is no code
  path to a non-loopback host or a model-supplied target. A new constitution lint
  confines the `capture.run` grant to make-kind types.
- **Observability.** A `capture-ran` event records each capture (name, kind, ok,
  duration, outputRef), the capture analogue of `script-ran`.
- **Additive.** A goal that declares no captures gets no capture context and
  behaves exactly as before; every `{ script }` / `{ file }` path is unchanged.

### 2. Done-condition fixture
`fixtures/runtime-capture/` demonstrates the rung end-to-end with no human
looking: a document whose amount must land on the total line, and the SAME
`{ capture }` criterion PASSES on the correct document and FAILS on a
deliberately transposed one — the kind of error no unit test catches. Driven by
`tests/library/runtime-capture-fixture.test.ts` against the real capture runner.

### 3. Judge-input bound (the crash that stopped run 9b)
The split-integration judge inlined every file of the merged child artifact with
no size bound, so across milestone rounds the input grew past the provider's 8 MB
text-input ceiling and a non-retryable 400 crashed the whole delivery.
`summarizeJudgeSubject` bounds the judge's subject section to a byte budget (every
file path still listed; content included greedily then reduced to excerpts), and
`judgeSplitIntegration` degrades a terminal provider error to a blocker instead
of throwing through the milestone loop.

### 4. Run observability
A commission run appended its event log to a shared per-id `events.jsonl`, so
successive runs concatenated and every projection read mixed history. The runner
now writes one `events-<stamp>.jsonl` per run, and `commission:watch` tails the
newest one — live goal tree, tree-wide spend, and a rolling activity feed — so a
long run is watchable instead of a black box.

## Verification

- Full suite green (the known `push-branch` real-git flake aside), typecheck and
  lint clean.
- The done-condition fixture proves pass-on-correct / fail-on-defect through the
  real capture runner.

## Closed issues

- `visual-runtime-verification` — implemented as ADR-042 + the rung + the fixture.
- `judge-integration-input-size-blowout` — fixed by the judge-input bound + degrade.
