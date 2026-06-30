---
type: adr
title: "ADR-042: Runtime/visual verification extends the acceptance-criteria floor with declared captures"
description: A third AcceptanceCheck arm — { capture } — lets a criterion verify rendered documents, running UIs, and live endpoints by capturing runtime output, with the same deterministic floor (capture must succeed) and the same ship gate (deterministic AND judge) as script/file criteria. Captures are declared up front; the model selects by name, never supplies addresses, paths, or commands. Safety is machine-checked.
tags: [adr, verification, visual, runtime, capture, acceptance-criteria, safety, additive]
timestamp: 2026-06-29T10:00:00-05:00
---

# ADR-042: Runtime/visual verification extends the acceptance-criteria floor with declared captures

**Status:** Accepted · **Date:** 2026-06-29 · **Stretch:** no · **Contract:** yes
**Supersedes:** none · **Superseded by:** none · **Amends:** ADR-032 · **Relates to:** ADR-016, ADR-031, ADR-013

## Context

The factory's verification rung is the declared script runner: a criterion names
a script (exit code) or a file/anchor assertion, and the deterministic floor
(`criteriaWellFormed`, `acceptance-criteria.ts:93`) rejects anything that is not
a sandbox-runnable predicate. This catches what a test, a linter, or a
file-existence check can express. It cannot catch what only a human eyeball
catches today: whether a rendered document puts a value in the right place
(a transposed AcroForm field silently puts money on the wrong line — no unit
test catches it), whether a running UI shows the right thing, or whether a live
endpoint behaves correctly when driven. These properties are invisible to every
script the factory can run.

The gap is not "the factory lacks a browser." It is structural: the
acceptance-criteria mechanism has no way to express a criterion whose
deterministic floor is "the runtime output was actually captured" and whose
judgement gate is "the captured output shows the right thing." A script check
reduces to a boolean; a visual check reduces to "capture succeeded" (boolean,
deterministic) AND "the capture shows X" (judgement, model). The first half has
no home in the current `AcceptanceCheck` union; the second half has a home —
`judge-acceptance` is already in the ship gate (ADR-031 §4) — but nothing feeds
it captured output.

Two properties make this trustworthy, and both are already load-bearing in the
existing architecture:

- **The deterministic floor cannot be bypassed.** ADR-032 §2 established that
  `criteriaWellFormed` rejects a criterion whose only "check" is a prose rubric
  line a judge would have to read. A runtime/visual criterion needs the same
  floor: it cannot pass unless the capture itself succeeded and produced output.
  A broken capture (the app did not start, the render produced an empty image,
  the endpoint was unreachable) must fail deterministically, before any judge
  runs — the same way a missing file fails `fileContains` today.

- **Capturing runtime output is at least as safely bounded as running a declared
  script.** ADR-016 established that the model chooses *which* declared script
  runs, never *what* runs — script names from a declared set, never shell text.
  A capture mechanism must follow the same discipline: the model selects among
  captures declared up front; it never supplies a free-form address, path, or
  command. The safety boundary (local/declared targets only, no ambient
  secrets, time-bounded) is enforced by the factory's machine-checked rules,
  not left to convention.

This must be **additive**: a goal that uses none of the new runtime/visual
verification must behave exactly as it does today.

## Options considered

### A. Extend `AcceptanceCheck` with a `{ capture }` arm; declared captures parallel to declared scripts — chosen

The `AcceptanceCheck` union (`acceptance-criteria.ts:20`) gains a third arm,
`{ capture: string }`, naming a capture declared up front. Captures live in a
`declaredCaptures` map on `SandboxConfig` (`assembly.ts:66`), exactly parallel
to `declaredScripts` (`assembly.ts:70`): a name → capture-definition map
authored at config time by the operator, never composed at runtime by the model.
`criteriaWellFormed` validates the capture name exists in the declared set; a
criterion naming an undeclared capture fails author-time, the same way a prose
rubric line fails today. `criterionToCheck` maps `{ capture }` to a
`captureSucceeded` deterministic check that runs the capture and passes only if
it produced non-empty output. `judge-acceptance` (already in the ship gate,
ADR-031 §4) receives the captured output and judges it against the criterion's
claim; the deterministic floor runs first, so the judge can never pass a
criterion whose capture failed.

### B. A new `verify-runtime` goal type with its own eval shape — rejected

A separate goal type that runs a capture and judges it, parallel to the
acceptance-criteria mechanism. Rejected: it duplicates the criteria + judge +
deterministic-floor machinery. The eval shape is the same — deterministic floor
then judge — so a second goal type fragments the done-condition without adding
a new eval shape. The milestone loop already has a ship gate; a second
verification path where one suffices multiplies the surfaces that must be kept
honest. The granularity rule (GOAL-TYPES.md: a type exists iff its harness
differs materially) is not met: the harness is the existing acceptance-criteria
harness with one more check kind.

### C. A brokered `capture_output` tool the model calls during the step loop — rejected

The model drives capture as a tool call, supplying the target/path/command. This
is the conventional approach ("give the model a browser tool"). It is wrong for
the same reason shell-text execution was rejected in ADR-016: the model would
supply free-form addresses, paths, and commands, which is exactly the class of
input the declared-script discipline exists to close. A tool call is
model-driven; the declaration discipline requires config-time declaration. The
model must select among declared captures, never compose what runs. Putting the
model in control of *when and what* to capture also breaks the deterministic
floor: a capture that the model chose not to run would have no boolean, and the
ship gate would degenerate to judge-only — the failure mode ADR-032 §2 exists to
prevent.

## Decision

**1. `AcceptanceCheck` gains a `{ capture: string }` arm.** The union becomes
three-valued:

```ts
export type AcceptanceCheck =
  | { script: string }
  | { file: string; anchor?: string }
  | { capture: string };
```

A `{ capture }` check names a capture by its declared name — a string key into
the `declaredCaptures` map, never a path, URL, or command. The model selects
among declared captures when authoring criteria; it cannot introduce a capture
the operator did not declare.

**2. Captures are declared up front in `SandboxConfig.declaredCaptures`, parallel
to `declaredScripts`.** A new field on `SandboxConfig` (`assembly.ts:66`):

```ts
declaredCaptures?: Record<string, CaptureDef>;
```

A `CaptureDef` is one of three kinds, each with a fixed set of declared
parameters — no model-supplied free-form values:

- **`render-document`** — render a worktree file (PDF, HTML) to an image. Names
  `file` (relative to the worktree root, must be in-scope) and `renderScript`
  (a declared script name from `declaredScripts` that reads the file and writes
  an image). The image is the captured output.
- **`screenshot-ui`** — start a server, wait for readiness, navigate, capture a
  screenshot. Names `startScript` (a declared script that starts the server),
  `port` (localhost port), `route` (path to navigate to), and `timeoutMs`. The
  screenshot is the captured output.
- **`drive-endpoint`** — start a server, wait for readiness, issue an HTTP
  request, capture the response. Names `startScript`, `port`, `method`, `path`,
  and `timeoutMs`. The response body is the captured output.

In all three, every parameter is declared at config time. The start script and
render script are declared-script *names* (reusing the ADR-016 discipline), never
shell text. The model's only degree of freedom is selecting a capture by name
when authoring a criterion.

**3. `criteriaWellFormed` is extended to reject undeclared capture names.** The
deterministic floor (ADR-032 §2) now covers a third check kind: a criterion whose
`check` is `{ capture }` must name a capture present in `declaredCaptures`. A
criterion naming an undeclared capture fails author-time — the same gate that
rejects a prose rubric line. `isRunnableCheck` (`acceptance-criteria.ts:68`) is
extended to accept `{ capture: string }` with a non-empty name and no stray keys.

**4. `criterionToCheck` maps `{ capture }` to a `captureSucceeded` deterministic
check.** A new `DeterministicCheck` in `checks.ts`, sibling to `runScriptCheck`
and `fileContains`:

```ts
export function captureSucceeded(captureName: string): DeterministicCheck
```

It reads `CheckContext.runCapture(name)`, runs the capture, and passes **only
if** the capture produced non-empty output (a non-zero-length image file or
response body). It fails deterministically if: the capture name is not in the
declared map, the file does not exist, the server did not start, the port was
not reachable within the timeout, the render produced an empty image, or the
endpoint returned an error status. This is the deterministic floor for a
runtime/visual criterion: **a criterion of this kind cannot pass unless the
capture itself succeeded and produced output.**

**5. The ship gate is unchanged: deterministic floor AND judge.** ADR-031 §4
established that a round is DONE only when every deterministic criterion passes
AND `judge-acceptance` returns `pass`. A `{ capture }` criterion's deterministic
check is `captureSucceeded`; its judge input is the captured output (image or
response) alongside the criterion's claim. The judge renders a gating
`pass/fail` on whether the captured output meets the claim ("does the screenshot
show the value in the right place?"). The deterministic floor runs first, so the
judge can never pass a criterion whose capture failed — a broken capture fails
before the judge sees it, exactly as a missing file fails `fileContains` before
the judge runs. The judge gates quality; the floor gates existence. Neither
alone suffices: a capture that succeeded but shows the wrong thing fails the
judge; a capture that failed can never pass, even if the judge is confused.

**6. `CheckContext` gains `declaredCaptures` and `runCapture`.** The runtime
context an executing check reads (`goal-type.ts:30`) gains two optional fields,
parallel to `sandboxRoot` and `runScript`:

```ts
export interface CheckContext {
  sandboxRoot?: string;
  runScript?: (name: string) => Promise<ScriptResult>;
  declaredCaptures?: Record<string, CaptureDef>;
  runCapture?: (name: string) => Promise<CaptureResult>;
}
```

`CaptureResult` carries `ok`, `kind`, `outputRef` (path to the captured image
or response in the worktree), `detail`, and `durationMs`. Absent
`declaredCaptures`/`runCapture` (the default for any goal not using captures), a
`{ capture }` criterion fails with "no capture context" — the same fail-safe
posture `runScriptCheck` takes when `ctx.runScript` is absent (`checks.ts:182`).

**7. Safety is enforced by machine-checked rules, not prose.** The safety
boundary for captures is the same boundary ADR-016 set for declared scripts, and
it is enforced by the same code-level mechanisms:

- **Local/declared targets only.** `criteriaWellFormed`
  (`acceptance-criteria.ts:93`) rejects a `{ capture }` check whose name is not
  in `declaredCaptures` — a machine-checked `DeterministicCheck` that fails the
  artifact, not a documentation rule. The capture runner (wired in
  `openSandboxAssembly`, `assembly.ts:202`) reads capture definitions only from
  `CheckContext.declaredCaptures`; there is no code path that accepts a
  model-supplied address, path, or command. The `file` in a `render-document`
  capture is validated against the goal's scope by `isInScope` (`checks.ts:23`),
  the same predicate that gates `filesWithinScope`.
- **No ambient secrets.** Captures run under `scrubEnv()` (`assembly.ts:133`),
  the same scrubbed child-process environment as `run_script` and `run_command`.
  Every key matching `_KEY`, `_SECRET`, `_TOKEN`, `_PASSWORD`, or `_CREDENTIALS`
  is stripped; every `OPENROUTER_`, `POSTGRES_`, `AWS_`, `GOOGLE_`, `STRIPE_`
  prefix is stripped. The capture runner inherits this scrubbed env; no capture
  code path reads the raw process environment.
- **Time-bounded.** Each capture has a wall-clock timeout (defaulting to the
  same `DEFAULT_TIME_LIMIT_MS` as script runs, `script-runner.ts`). A capture
  that hangs — the server never becomes ready, the render never completes — is
  killed by `runCapturedProcess` and fails deterministically.
- **Worktree-pinned.** Captures run in the tree's worktree (ADR-016); the
  capture runner is bound to the worktree root as cwd, exactly like
  `createScriptRunner` (`assembly.ts:221`) and `createCommandRunner`
  (`assembly.ts:241`). A `render-document` capture can only render files in the
  worktree; a `screenshot-ui`/`drive-endpoint` capture starts its server in the
  worktree.
- **Loopback-only network.** A `screenshot-ui` or `drive-endpoint` capture
  reaches `localhost` on the declared port only. The capture runner's HTTP
  client connects to `127.0.0.1` (or `::1`); external egress is blocked by the
  same `networkCommandBlock` discipline (`script-runner.ts:161`) that governs
  `run_command`. A capture definition naming a non-loopback host is rejected at
  config validation, before any run.
- **Constitution lint.** The dangerous-grant ceiling (`constitution.ts:87`,
  `/merge|approve|deploy|spend/`) already forbids any grant that would let a
  type deploy or spend; a capture grant (`capture.run`, mapped in
  `GRANT_TOOL_MAP`) cannot match that pattern. A new lint rule in
  `constitution.ts` rejects a `capture.run` grant on any type whose `kind` is
  not `make` — captures produce side effects (starting servers, writing image
  files), placing them above the judge/learn/evolve ceiling. This is a
  machine-checked lint, the same enforcement mechanism that already rejects
  write grants on judge types (`constitution.ts:44`).

**8. This is additive.** A goal that uses no runtime/visual verification is
byte-identical to today:

- `AcceptanceCheck` gains an optional arm; `{ script }` and `{ file, anchor? }`
  are unchanged.
- `criteriaWellFormed` validates `{ capture }` only when present; criteria with
  only script/file checks are validated exactly as today.
- `criterionToCheck` maps `{ capture }` only when present; script/file criteria
  map to `runScriptCheck`/`fileContains` unchanged.
- `SandboxConfig.declaredCaptures` is optional; absent it, `CheckContext` omits
  `declaredCaptures` and `runCapture`, and a `{ capture }` criterion (which
  cannot arise without declared captures) fails with "no capture context."
- `captureSucceeded` is never invoked for a goal whose criteria have no
  `{ capture }` checks.
- `ACCEPTANCE_CRITERIA_SCHEMA` (`acceptance-schemas.ts`) gains a third `oneOf`
  branch; existing two-branch criteria validate unchanged.
- The milestone loop's `passingCount`, the no-progress halt (ADR-031 guard 2),
  and `judge-acceptance` are unchanged in structure; a `{ capture }` criterion
  contributes to `passingCount` exactly as a script/file criterion does.

## Rationale

The deterministic floor and the ship gate already exist (ADR-032, ADR-031); the
sandbox safety discipline already exists (ADR-016, `scrubEnv`,
`networkCommandBlock`); the declared-name pattern already exists
(`declaredScripts`). This decision is the smallest extension that makes
runtime/visual verification expressible within those existing structures: one
new `AcceptanceCheck` arm, one new `DeterministicCheck`, one new
`SandboxConfig` field, and the constitution lint that keeps the new capability
inside the make-kind ceiling. Every property that makes the existing criteria
trustworthy — the deterministic floor that rejects non-runnable checks, the
ship gate that requires deterministic AND judge, the sandbox that runs declared
names under a scrubbed env — extends to captures by construction, because
captures are a third kind of check in the same mechanism, not a parallel path.

The alternative the conventional wisdom would suggest — a model-driven browser
tool (Option C) — is rejected because it inverts the declaration discipline that
makes the sandbox safe. The model must select among declared captures, never
compose what runs; a tool call is model-driven, so it cannot be the capture
mechanism. This is the same tell as ADR-016's rejection of shell-text execution:
the model chooses *which* declared thing runs, never *what* runs.

## Tradeoffs & risks

- **A capture is the slowest check kind.** A `screenshot-ui` or `drive-endpoint`
  capture runs a full process lifecycle (start server → wait for readiness →
  navigate/request → capture → kill), bounded by the capture's wall-clock
  timeout. A round with N capture criteria adds N × timeout worst case to the
  per-round assessment. This fits within the per-round `wallClockMs` budget and
  the per-tree dollar ceiling (ADR-033): captures are bounded and rare — most
  criteria remain script/file checks. A goal with no capture criteria pays zero
  overhead.

- **The capture runner needs rendering and browser capabilities that are not
  zero-dependency.** A `render-document` capture needs a PDF/HTML-to-image
  renderer; a `screenshot-ui` capture needs a browser. These are declared
  scripts (operator-provided, reusing the `declaredScripts` discipline) or
  system tools, not factory dependencies — keeping ADR-001's zero-dep posture
  for the factory itself. The architecture is agnostic to the rendering
  technology; the capture definition names a declared script, and the script
  owns the rendering tool. This pushes the rendering dependency to the target
  repo's declared scripts, where it belongs.

- **Concurrent captures may contend on localhost ports.** ADR-016 already
  notes that concurrent leaves share one process environment (ports, tmp files).
  A `screenshot-ui` capture binding a declared port collides with a concurrent
  capture on the same port. The v1 mitigation is the same as for `run_script`
  collisions: the capture times out and fails deterministically, surfacing as an
  ordinary check failure. A future port-allocation pass can assign dynamic
  ports; the capture definition's `port` field is the seam.

- **The judge sees an image, not the source.** A `render-document` or
  `screenshot-ui` capture produces an image; the judge (a vision-capable model
  at `tier: 'high'`) judges the image against the criterion's claim. A judge
  that cannot read the image (uncalibrated, low-fidelity) will fail the
  criterion — which is the safe direction. The golden-set calibration path
  (ADR-024) is the cure for a misbehaving visual judge, not a special-case
  escape in the capture mechanism.

- **A capture definition is operator-authored config, carrying the operator's
  trust.** The operator declares captures in `SandboxConfig`, exactly as they
  declare scripts today. A malicious capture definition (e.g., a `startScript`
  that exfiltrates) runs with the operator's privileges — the same trust model
  as declared scripts (ADR-016: "operator owns all target repos; same trust as
  running `npm test` by hand"). The `scrubEnv` floor and the loopback-only
  network block contain the capture within the worktree; they do not defend
  against a malicious operator-authored script, which is the named v1 trust
  boundary.

## Consequences for the build

- **Contract:** `src/contract/goal-type.ts` — `CheckContext` gains
  `declaredCaptures?` and `runCapture?`; `AcceptanceCheck`
  (`src/library/acceptance-criteria.ts:20`) gains the `{ capture: string }` arm.
- **Contract:** `src/contract/tool.ts` — `GRANT_TOOL_MAP` gains a `capture.run`
  entry; `CaptureDef` and `CaptureResult` shapes live in `src/contract/` (the
  frozen barrier, ADR-002).
- **Contract:** `src/contract/events.ts` — one additive event member,
  `capture-ran`, carrying `goalId`, `captureName`, `kind`, `ok`, `outputRef`,
  `durationMs` (the same shape as `script-ran`, for the same observability
  reason). The exhaustive-switch discipline (ADR-003) applies.
- **Engine:** `src/engine/assembly.ts` — `SandboxConfig` gains
  `declaredCaptures?`; `openSandboxAssembly` wires the capture runner
  (scrubbed env, worktree-pinned, loopback-only, time-bounded) into
  `checkContextFor`.
- **Library:** `src/library/checks.ts` — `captureSucceeded` deterministic check;
  `src/library/acceptance-criteria.ts` — `isRunnableCheck` and
  `criteriaWellFormed` extended for `{ capture }`; `criterionToCheck` maps
  `{ capture }` → `captureSucceeded`.
- **Library:** `src/library/acceptance-schemas.ts` —
  `ACCEPTANCE_CRITERIA_SCHEMA` gains a third `oneOf` branch for
  `{ capture: string }`.
- **Library:** `src/library/constitution.ts` — new lint: a `capture.run` grant
  on a non-`make` type is a violation.
- **Library:** `src/library/script-runner.ts` — the capture runner reuses
  `runCapturedProcess` (wall-clock kill, output capture) and `scrubEnv`; the
  loopback-only HTTP client is a new, small, zero-dep `node:http` caller pinned
  to `127.0.0.1`/`::1`.
- **Judge:** `judge-acceptance` (`src/library/types/critique.ts:52`) receives
  the captured output (image path or response body) in its context when a
  criterion's check is `{ capture }`. No type-definition change — the judge
  already reads the criteria and the deterministic check results; the capture
  output is additional context threaded through the same path.
- **Additive invariant:** every code path that handles `{ script }` or
  `{ file, anchor? }` is unchanged; the `{ capture }` arm is a new branch in
  three switches (`isRunnableCheck`, `criteriaWellFormed`, `criterionToCheck`)
  and one schema. A goal with no `{ capture }` criteria exercises none of the
  new code.
- **Fixture:** a demonstration fixture under `fixtures/` produces a document
  in which a value must appear in the correct place, carries a `{ capture }`
  criterion asserting that placement, and demonstrates pass-on-correct /
  fail-on-defect with no human eyeball.

## Amendment to ADR-032

ADR-032 §1 defined the acceptance-criteria checklist as an ordered list where
each `check` is a repo-runnable predicate — a named script or a file/anchor
assertion. This ADR adds a third runnable predicate kind: a named capture. The
deterministic floor (ADR-032 §2 — `criteriaWellFormed` rejects non-runnable
checks) is extended to cover it: a `{ capture }` check must name a declared
capture, and its `captureSucceeded` deterministic check must pass (the capture
produced non-empty output) before the judge runs. The ship gate (ADR-032 §3 —
deterministic AND judge) is unchanged in structure; a `{ capture }` criterion
contributes to `passingCount` and to the judge's input exactly as a script/file
criterion does. The per-round commit and verify-on-read machinery (ADR-032 §4–6)
is untouched — captures are re-run each round like any other criterion.
